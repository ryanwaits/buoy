/**
 * One heading section, one export, a thin record.
 *
 * Code lists the words. Jev says what each word is doing (an API claim, or a
 * value, a comment, example data). Code writes a proof only when that answer
 * is extreme and the word is absent from the record. The description question
 * is the behaviour buoy.
 */

import { createHash } from 'node:crypto';
import { displayName, type OpenPkgExport, type OpenPkgSpec, unpacked } from './lookout/evidence';
import type { Classifier, Question } from './sonar';
import type { JudgedClaim } from './types';

type Schema = {
  properties?: Record<string, Schema>;
  required?: string[];
  anyOf?: Schema[];
  oneOf?: Schema[];
  $ref?: string;
};
type SigParam = {
  name: string;
  required?: boolean;
  rest?: boolean;
  'x-ts-destructured'?: boolean;
  schema?: Schema;
};
type Signature = { parameters?: SigParam[]; oneOf?: string[][]; braces?: boolean };

export type Fact = {
  name: string;
  description?: string;
  deprecated: boolean;
  replacement?: string;
  /** Names a caller may write. Empty when the shape could not be seen. */
  allowed: string[];
  required: string[];
  oneOf: string[][];
  /** True when the parameters are the keys of one object, so a call's keys can be checked. */
  braces: boolean;
  members: string[];
};

type Section = {
  heading: string;
  start: number;
  text: string;
  older: boolean;
  prose: boolean;
};

const OLDER = /\b(before|previously|older version)\b|\bAI SDK \d/i;

export function splitSections(content: string): Section[] {
  const lines = content.split('\n');
  const heads: { line: number; level: number; text: string }[] = [];
  lines.forEach((line, i) => {
    const m = /^(#{1,6})\s+(.+)$/.exec(line);
    if (m) heads.push({ line: i + 1, level: m[1].length, text: m[2].trim() });
  });
  const slices = heads.length
    ? heads.map((head, i) => {
        const next = heads[i + 1];
        return { heading: head.text, start: head.line, end: next?.line ?? lines.length + 1 };
      })
    : [{ heading: '', start: 1, end: lines.length + 1 }];
  return slices.map((slice) => {
    const text = lines.slice(slice.start - 1, slice.end - 1).join('\n');
    const titles = [
      slice.heading,
      ...[...text.matchAll(/```[^\n]*\btitle=(?:"([^"]+)"|'([^']+)')/g)].map((m) => m[1] || m[2]),
    ];
    return {
      heading: slice.heading,
      start: slice.start,
      text,
      older: titles.some((t) => OLDER.test(t)),
      prose: proseOf(text).length > 0,
    };
  });
}

function proseOf(text: string): string {
  let fence = false;
  const out: string[] = [];
  for (const line of text.split('\n')) {
    if (/^```/.test(line)) {
      fence = !fence;
      continue;
    }
    if (!fence && /[A-Za-z]/.test(line) && line.trim().length > 20) out.push(line.trim());
  }
  return out.join('\n');
}

/** A fence, or a single prose line. Words are judged only against exports named in the same window. */
export function windowsOf(section: Section): { start: number; text: string }[] {
  const lines = section.text.split('\n');
  const out: { start: number; text: string }[] = [];
  let fence: string[] | null = null;
  let fenceAt = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const abs = section.start + i;
    if (/^```/.test(line)) {
      if (fence) {
        if (fence.length) out.push({ start: fenceAt, text: fence.join('\n') });
        fence = null;
      } else {
        fence = [];
        fenceAt = abs + 1;
      }
      continue;
    }
    if (fence) {
      fence.push(line);
      continue;
    }
    if (/^#{1,6}\s/.test(line)) continue;
    if (/[A-Za-z_$]/.test(line)) out.push({ start: abs, text: line });
  }
  const leftover = fence;
  if (leftover?.length) out.push({ start: fenceAt, text: leftover.join('\n') });
  return out;
}

function inFence(text: string, line: number): boolean {
  let fence = false;
  const lines = text.split('\n');
  for (let i = 0; i < line && i < lines.length; i++) {
    if (/^```/.test(lines[i])) fence = !fence;
  }
  return fence && !/^```/.test(lines[line - 1] ?? '');
}

type Index = Map<string, Fact>;

export function factsOf(spec: OpenPkgSpec): Index {
  const index: Index = new Map();
  const add = (entry: OpenPkgExport): void => {
    const fact = factOf(spec, entry);
    index.set(entry.name, fact);
    if (entry.localName) index.set(entry.localName, fact);
  };
  for (const entry of spec.exports) add(entry);
  for (const type of spec.types ?? []) {
    if (!index.has(type.name)) add(type as OpenPkgExport);
  }
  return index;
}

/** Keys of an options object, including one named type such as `ServerConfig`. */
function optionKeys(spec: OpenPkgSpec, schema: Schema | undefined, depth = 0): string[] {
  if (!schema || depth > 3) return [];
  if (schema.properties)
    return Object.keys(schema.properties).filter((key) => !key.startsWith('_'));
  const ref = schema.$ref?.split('/').pop();
  if (!ref) return [];
  const type =
    spec.types?.find((item) => item.id === ref || item.name === ref) ??
    spec.exports.find((item) => item.name === ref);
  if (!type) return [];
  const members = (type.members ?? [])
    .map((member) => member.name)
    .filter((name) => name && !name.startsWith('_'));
  if (members.length) return members;
  return optionKeys(spec, type.schema as Schema | undefined, depth + 1);
}

function factOf(spec: OpenPkgSpec, entry: OpenPkgExport): Fact {
  const sigs = (entry.signatures ?? []).map((sig) => unpacked(sig as Signature, spec) as Signature);
  const shaped = sigs.filter((sig) => sig.braces);
  const use = shaped.length ? shaped : sigs;
  const allowed = new Set<string>();
  for (const sig of use) {
    for (const param of sig.parameters ?? []) {
      allowed.add(param.name);
      for (const key of optionKeys(spec, param.schema)) allowed.add(key);
    }
  }
  const withParams = use.filter((sig) => (sig.parameters ?? []).length > 0);
  const required = [...allowed].filter((name) =>
    withParams.every((sig) =>
      sig.parameters?.some(
        (param) => param.name === name && param.required !== false && !param.rest,
      ),
    ),
  );
  const oneOf = shaped.find((sig) => sig.oneOf?.length)?.oneOf ?? [];
  const members = (entry.members ?? [])
    .filter((member) => member.name && !member.name.startsWith('_') && !member.name.startsWith('#'))
    .filter((member) => !member.flags?.private)
    .map((member) => member.name);
  const note = entry.tags
    ?.find((tag) => tag.name === 'deprecated')
    ?.text?.split(/(?<=[.!?])\s|\n/)[0]
    ?.trim();
  return {
    name: displayName(entry),
    ...(entry.description ? { description: entry.description } : {}),
    deprecated: Boolean(entry.deprecated || note),
    ...(note ? { replacement: note } : {}),
    allowed: [...allowed],
    required,
    oneOf,
    braces: shaped.length > 0,
    members,
  };
}

type Hit = { line: number; exportName: string; issue: string; type: string; text: string };

const SKIP = new Set([
  'const',
  'let',
  'var',
  'return',
  'function',
  'import',
  'from',
  'export',
  'new',
  'true',
  'false',
  'null',
  'undefined',
  'await',
  'async',
  'if',
  'else',
  'for',
  'of',
  'in',
  'type',
  'interface',
  'class',
  'this',
  'string',
  'number',
  'boolean',
]);

/** Words in the section. Not a parse: anything that is not a letter breaks a word. */
export function wordsOf(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of text.match(/[A-Za-z_$][\w$]*/g) ?? []) {
    if (word.length < 2 || SKIP.has(word) || seen.has(word)) continue;
    seen.add(word);
    out.push(word);
  }
  return out;
}

export function checkSection(
  section: Section,
  index: Index,
): { hits: Hit[]; mentioned: Fact[]; words: string[] } {
  if (section.older) return { hits: [], mentioned: [], words: [] };
  const words = wordsOf(section.text);
  const hits: Hit[] = [];
  const mentioned = new Set<Fact>();
  for (const [name, fact] of index) {
    if (!mentionedIn(section.text, name)) continue;
    mentioned.add(fact);
    if (fact.deprecated && !/deprecat/i.test(section.text)) {
      hits.push({
        line: section.start + lineOf(section.text, section.text.search(boundary(name))) - 1,
        exportName: fact.name,
        type: 'deprecated-export',
        text: name,
        issue: `'${fact.name}' is deprecated${fact.replacement ? ` in favour of '${fact.replacement}'` : ''}, and this still teaches it as current`,
      });
    }
  }
  return { hits, mentioned: [...mentioned], words };
}

const CLAIM_MIN = 0.85;

/**
 * One noul per fact. No second guess (intent) to veto it.
 * option / member: the word is claimed as API and the record lacks it.
 * omits: a call leaves out a required name. High means missing.
 */
export function roleProofs(
  fact: Fact,
  section: Section,
  options: Record<string, number>,
  members: Record<string, number>,
  omits: Record<string, number>,
): Hit[] {
  const hits: Hit[] = [];
  const known = new Set([
    fact.name,
    ...fact.allowed,
    ...fact.members,
    ...fact.required,
    ...fact.oneOf.flat(),
  ]);
  const absent = (word: string, score: number): void => {
    if (score < CLAIM_MIN || known.has(word)) return;
    hits.push({
      line: section.start + lineOf(section.text, section.text.search(boundary(word))) - 1,
      exportName: fact.name,
      type: 'absent-name',
      text: word,
      issue: `'${word}' is not part of '${fact.name}'`,
    });
  };
  for (const [word, score] of Object.entries(options)) absent(word, score);
  for (const [word, score] of Object.entries(members)) absent(word, score);
  for (const req of fact.required) {
    if (req === 'children') continue;
    if ((omits[req] ?? 0) >= CLAIM_MIN) {
      hits.push({
        line: section.start,
        exportName: fact.name,
        type: 'missing-required',
        text: fact.name,
        issue: `Call '${fact.name}' is missing required argument '${req}'`,
      });
    }
  }
  if (fact.oneOf.length > 0 && (omits.one_of ?? 0) >= CLAIM_MIN) {
    const arms = fact.oneOf.map((arm) => `'${arm.join(' + ')}'`).join(' or ');
    hits.push({
      line: section.start,
      exportName: fact.name,
      type: 'missing-required',
      text: fact.name,
      issue: `Call '${fact.name}' needs one of ${arms}`,
    });
  }
  return hits;
}

function mentionedIn(text: string, name: string): boolean {
  return boundary(name).test(text);
}

function boundary(name: string): RegExp {
  return new RegExp(`(?<![\\w$])${pattern(name)}(?![\\w$])`);
}

function lineOf(text: string, index: number): number {
  if (index < 0) return 1;
  return text.slice(0, index).split('\n').length;
}

function pattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function claimFor(file: string, section: Section, hit: Hit): JudgedClaim {
  const local = hit.line - section.start + 1;
  const kind = inFence(section.text, local) ? 'fence' : 'inline';
  return {
    id: `${file}:${hit.line}:${hit.type}:${hit.exportName}:${hit.text}`,
    kind,
    text: hit.text,
    locator: {
      path: file,
      start: { line: hit.line, col: 1 },
      end: { line: hit.line, col: 1 + hit.text.length },
      ...(section.heading ? { headingText: section.heading.replace(/`/g, '') } : {}),
    },
    specRef: { export: hit.exportName },
    rule: { type: hit.type, issue: hit.issue },
  };
}

type Answer = {
  type?: string;
  probability?: number;
  choice?: string;
  probabilities?: Record<string, number>;
};

export type ReadCache = Record<
  string,
  {
    about?: string;
    aboutConfidence?: number;
    aboutScores?: Record<string, number>;
    relation?: string;
    relationConfidence?: number;
    options?: Record<string, number>;
    members?: Record<string, number>;
    omits?: Record<string, number>;
  }
>;

export type ReadStats = { requests: number; cached: number; inputTokens: number; model?: string };

const WORD_CAP = 80;

export async function readPage(
  file: string,
  content: string,
  specs: OpenPkgSpec[],
  importFrom: string[],
  classifier: Classifier | null,
  cache: ReadCache,
): Promise<{ claims: JudgedClaim[]; stats: ReadStats }> {
  const index = factsOf(merge(specs));
  const claims: JudgedClaim[] = [];
  const stats: ReadStats = { requests: 0, cached: 0, inputTokens: 0 };
  for (const section of splitSections(content)) {
    const found = checkSection(section, index);
    for (const hit of found.hits) claims.push(claimFor(file, section, hit));
    if (section.older || !classifier) continue;
    for (const win of windowsOf(section)) {
      const words = wordsOf(win.text);
      const prose = !win.text.includes('\n');
      const candidates: Fact[] = [];
      const seen = new Set<string>();
      for (const [name, fact] of index) {
        const named = mentionedIn(win.text, name) || (prose && mentionedIn(section.heading, name));
        if (!named || seen.has(fact.name)) continue;
        seen.add(fact.name);
        candidates.push(fact);
      }
      if (!candidates.length) continue;
      const window: Section = { ...section, start: win.start, text: win.text };
      const routed = await route(window, candidates, classifier, cache, stats);
      for (const fact of candidates) {
        if ((routed.about[fact.name] ?? 0) < ROUTE_MIN) continue;
        const judged = await judge(file, window, fact, words, importFrom, classifier, cache, stats);
        claims.push(...judged);
      }
    }
  }
  return { claims, stats };
}

function merge(specs: OpenPkgSpec[]): OpenPkgSpec {
  return {
    exports: specs.flatMap((spec) => spec.exports),
    types: specs.flatMap((spec) => spec.types ?? []),
  };
}

function unknownWords(fact: Fact, words: string[], text: string): string[] {
  const known = new Set([
    fact.name,
    ...fact.allowed,
    ...fact.members,
    ...fact.required,
    ...fact.oneOf.flat(),
  ]);
  const unknown = words.filter((word) => !known.has(word));
  const near: string[] = [];
  const rest: string[] = [];
  for (const word of unknown) {
    if (sameLine(text, fact.name, word)) near.push(word);
    else rest.push(word);
  }
  return [...near, ...rest].slice(0, WORD_CAP);
}

function sameLine(text: string, exportName: string, word: string): boolean {
  for (const line of text.split('\n')) {
    if (boundary(exportName).test(line) && boundary(word).test(line)) return true;
  }
  return false;
}

const ROUTE_MIN = 0.7;

async function route(
  window: Section,
  candidates: Fact[],
  classifier: Classifier,
  cache: ReadCache,
  stats: ReadStats,
): Promise<{ about: Record<string, number> }> {
  const names = candidates.map((item) => item.name);
  const state = {
    heading: window.heading,
    block: window.text.slice(0, 4000),
    names,
  };
  const key = createHash('sha256')
    .update(`r2\0${JSON.stringify(state)}`)
    .digest('hex');
  const cached = cache[key];
  if (cached?.aboutScores) {
    stats.cached++;
    return { about: cached.aboutScores };
  }
  const questions: Record<string, Question> = {};
  for (const name of names) {
    questions[`about_${name}`] = {
      type: 'noul',
      instructions: `Is this block documenting \`${name}\`: a call of it, a type shape for it, or prose about it? Nested in the same sample as another export still counts. A comment, a value, or a sample of a different API does not.`,
      criteria: {
        true: `This block is about \`${name}\`.`,
        false: `This block is not about \`${name}\`.`,
      },
    };
  }
  const result = await classifier.evaluate({ state, questions });
  stats.requests++;
  stats.inputTokens += result.usage.inputTokens;
  stats.model = result.model;
  const about: Record<string, number> = {};
  for (const name of names) about[name] = yes(result.answers[`about_${name}`] as Answer);
  cache[key] = { aboutScores: about };
  return { about };
}

async function judge(
  file: string,
  section: Section,
  fact: Fact,
  words: string[],
  importFrom: string[],
  classifier: Classifier,
  cache: ReadCache,
  stats: ReadStats,
): Promise<JudgedClaim[]> {
  const unknown = unknownWords(fact, words, section.text);
  const state = {
    export: {
      name: fact.name,
      description: fact.description ?? '',
      deprecated: fact.deprecated,
      parameters: fact.allowed,
      required: fact.required,
      oneOf: fact.oneOf,
      members: fact.members,
    },
    importedFrom: importFrom,
    section: section.text.slice(0, 4000),
    words: unknown,
  };
  const key = createHash('sha256')
    .update(`b6\0${JSON.stringify(state)}`)
    .digest('hex');
  const cached = cache[key];
  let answer = cached?.options && cached.members && cached.omits ? cached : undefined;
  if (answer) stats.cached++;
  else {
    const questions: Record<string, Question> = {
      relation: {
        type: 'choice',
        instructions: 'How does the prose in `section` relate to `export.description`?',
        criteria: {
          matches: 'The prose states what the description states.',
          contradicts: 'The prose states a behaviour the description denies.',
          says_nothing: 'The prose does not address the description.',
        },
      },
    };
    for (const word of unknown) {
      questions[`option_${word}`] = {
        type: 'noul',
        instructions: `Is \`${word}\` the *name* of a prop or option of a call to \`${fact.name}\` (the key, or the JSX prop)? A value assigned to an option (\`auth: myAuthHandler\`) is not. A field of stored example data is not.`,
        criteria: {
          true: `\`${word}\` is the name of an option of \`${fact.name}\`.`,
          false: `\`${word}\` is a value, a comment, or unrelated.`,
        },
      };
      questions[`member_${word}`] = {
        type: 'noul',
        instructions: `Does the section say that \`${fact.name}\` has a field or method named \`${word}\`? A documented method (\`delete(key)\`) is that. A field of example data stored in an instance is not. A method on a value some other call returned is not.`,
        criteria: {
          true: `The section claims \`${fact.name}\` has \`${word}\`.`,
          false: `\`${word}\` is not claimed as a member of \`${fact.name}\`.`,
        },
      };
    }
    for (const req of fact.required) {
      if (req === 'children') continue;
      questions[`omits_${req}`] = {
        type: 'noul',
        instructions: `Is there a call of \`${fact.name}\` in this section that leaves out required \`${req}\`? A mention without a call is not an omission.`,
        criteria: {
          true: `A call of \`${fact.name}\` is shown and \`${req}\` is not passed.`,
          false: `There is no such omitting call.`,
        },
      };
    }
    if (fact.oneOf.length) {
      const arms = fact.oneOf.map((arm) => arm.join(' or ')).join(', or ');
      questions.omits_one_of = {
        type: 'noul',
        instructions: `Is there a call of \`${fact.name}\` that passes none of ${arms}? A mention without a call is not that.`,
        criteria: {
          true: 'A call is shown and none of those is passed.',
          false: 'There is no such omitting call.',
        },
      };
    }
    const result = await classifier.evaluate({ state, questions });
    stats.requests++;
    stats.inputTokens += result.usage.inputTokens;
    stats.model = result.model;
    const answers = result.answers as Record<string, Answer>;
    const relation = choiceOf(answers.relation);
    const options: Record<string, number> = {};
    const members: Record<string, number> = {};
    const omits: Record<string, number> = {};
    for (const word of unknown) {
      options[word] = yes(answers[`option_${word}`]);
      members[word] = yes(answers[`member_${word}`]);
    }
    for (const req of fact.required) omits[req] = yes(answers[`omits_${req}`]);
    if (fact.oneOf.length) omits.one_of = yes(answers.omits_one_of);
    answer = {
      relation: relation.choice,
      relationConfidence: relation.confidence,
      options,
      members,
      omits,
    };
    cache[key] = answer;
  }
  const options = answer.options ?? {};
  const members = answer.members ?? {};
  const omits = answer.omits ?? {};
  const relation = answer.relation ?? 'says_nothing';
  const relationConfidence = answer.relationConfidence ?? 0;
  const claims: JudgedClaim[] = [];
  for (const hit of roleProofs(fact, section, options, members, omits)) {
    claims.push(claimFor(file, section, hit));
  }
  if (
    section.prose &&
    fact.description &&
    relation === 'contradicts' &&
    relationConfidence >= 0.8
  ) {
    claims.push({
      id: `${file}:${section.start}:behaviour:${fact.name}`,
      kind: 'prose',
      text: proseOf(section.text).split('\n')[0] ?? fact.name,
      locator: {
        path: file,
        start: { line: section.start, col: 1 },
        end: { line: section.start, col: 1 },
        ...(section.heading ? { headingText: section.heading.replace(/`/g, '') } : {}),
      },
      specRef: { export: fact.name },
      jev: { stale: 0, incomplete: 0, inaccurate: relationConfidence, reason: 'prose' },
    });
  }
  return claims;
}

function yes(answer: Answer | undefined): number {
  return answer?.probability ?? 0;
}

function choiceOf(answer: Answer | undefined): { choice: string; confidence: number } {
  const probs = Object.values(answer?.probabilities ?? {});
  const peak = probs.length ? Math.max(...probs) : 0;
  const confidence = probs.length > 1 ? (probs.length * peak - 1) / (probs.length - 1) : peak;
  return { choice: answer?.choice ?? 'not_this', confidence };
}
