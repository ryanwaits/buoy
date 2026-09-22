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
    ? heads.map((head) => {
        const next = heads.find((h) => h.line > head.line && h.level <= head.level);
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

const ROLE_MIN = 0.85;
const INTENT_MIN = 0.7;
const PASSED_MAX = 0.25;
const QUIET_INTENT = new Set(['data_example', 'mention', 'older_version', 'not_this']);

/**
 * A proof only when Jev is sure the word is an API claim and the record lacks it,
 * or sure a real call skipped a required name. Example data and comments stay quiet.
 */
export function roleProofs(
  fact: Fact,
  section: Section,
  intent: string,
  intentConfidence: number,
  roles: Record<string, number>,
  passed: Record<string, number>,
): Hit[] {
  const hits: Hit[] = [];
  const structural = intent === 'real_call' || intent === 'signature';
  const sure = intentConfidence >= INTENT_MIN && structural && !QUIET_INTENT.has(intent);
  if (sure) {
    const known = new Set([
      fact.name,
      ...fact.allowed,
      ...fact.members,
      ...fact.required,
      ...fact.oneOf.flat(),
    ]);
    for (const [word, score] of Object.entries(roles)) {
      if (score < ROLE_MIN || known.has(word)) continue;
      hits.push({
        line: section.start + lineOf(section.text, section.text.search(boundary(word))) - 1,
        exportName: fact.name,
        type: 'absent-name',
        text: word,
        issue: `'${word}' is not part of '${fact.name}'`,
      });
    }
    for (const req of fact.required) {
      if (req === 'children') continue;
      if ((passed[req] ?? 1) <= PASSED_MAX) {
        hits.push({
          line: section.start,
          exportName: fact.name,
          type: 'missing-required',
          text: fact.name,
          issue: `Call '${fact.name}' is missing required argument '${req}'`,
        });
      }
    }
    if (fact.oneOf.length > 0 && (passed.one_of ?? 1) <= PASSED_MAX) {
      const arms = fact.oneOf.map((arm) => `'${arm.join(' + ')}'`).join(' or ');
      hits.push({
        line: section.start,
        exportName: fact.name,
        type: 'missing-required',
        text: fact.name,
        issue: `Call '${fact.name}' needs one of ${arms}`,
      });
    }
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
    intent: string;
    intentConfidence: number;
    relation: string;
    relationConfidence: number;
    roles: Record<string, number>;
    passed: Record<string, number>;
  }
>;

export type ReadStats = { requests: number; cached: number; inputTokens: number; model?: string };

const WORD_CAP = 24;

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
    for (const fact of found.mentioned) {
      const judged = await judge(
        file,
        section,
        fact,
        found.words,
        importFrom,
        classifier,
        cache,
        stats,
      );
      claims.push(...judged);
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

function unknownWords(fact: Fact, words: string[]): string[] {
  const known = new Set([
    fact.name,
    ...fact.allowed,
    ...fact.members,
    ...fact.required,
    ...fact.oneOf.flat(),
  ]);
  return words.filter((word) => !known.has(word)).slice(0, WORD_CAP);
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
  const unknown = unknownWords(fact, words);
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
    .update(`b3\0${JSON.stringify(state)}`)
    .digest('hex');
  const cached = cache[key];
  let answer = cached?.intent ? cached : undefined;
  if (answer) stats.cached++;
  else {
    const questions: Record<string, Question> = {
      intent: {
        type: 'choice',
        instructions: 'What is this section doing with `export.name`?',
        criteria: {
          real_call: 'A sample shows a working call of this export and the options it passes.',
          signature: 'The section is teaching the parameter names of this export.',
          data_example:
            'A value is being stored or constructed. Keys are example data, not the API of this export.',
          mention: 'The export is named, not called, and no option or member is being claimed.',
          older_version: 'The sample is explicitly an older version.',
          not_this: 'The section is not about this export.',
        },
      },
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
      questions[`role_${word}`] = {
        type: 'noul',
        instructions: `Does the section claim that \`${word}\` is an option, a parameter, or a member of \`${fact.name}\` itself? A value in an example, a word in a comment, a field of data stored in an example, and a method on a value the call returns are not that.`,
        criteria: {
          true: `\`${word}\` is claimed as part of the API of \`${fact.name}\`.`,
          false: `\`${word}\` is prose, a comment, a value, or example data.`,
        },
      };
    }
    for (const req of fact.required) {
      if (req === 'children') continue;
      questions[`passed_${req}`] = {
        type: 'noul',
        instructions: `Does a real call of \`${fact.name}\` in the section pass \`${req}\`?`,
        criteria: {
          true: `The call passes \`${req}\`.`,
          false: `A real call is shown and \`${req}\` is absent.`,
        },
      };
    }
    if (fact.oneOf.length) {
      const arms = fact.oneOf.map((arm) => arm.join(' or ')).join(', or ');
      questions.passed_one_of = {
        type: 'noul',
        instructions: `Does a real call of \`${fact.name}\` pass at least one of ${arms}?`,
        criteria: {
          true: 'One of those is passed.',
          false: 'A real call is shown and none of them is passed.',
        },
      };
    }
    const result = await classifier.evaluate({ state, questions });
    stats.requests++;
    stats.inputTokens += result.usage.inputTokens;
    stats.model = result.model;
    const answers = result.answers as Record<string, Answer>;
    const intent = choiceOf(answers.intent);
    const relation = choiceOf(answers.relation);
    const roles: Record<string, number> = {};
    const passed: Record<string, number> = {};
    for (const word of unknown) roles[word] = yes(answers[`role_${word}`]);
    for (const req of fact.required) passed[req] = yes(answers[`passed_${req}`]);
    if (fact.oneOf.length) passed.one_of = yes(answers.passed_one_of);
    answer = {
      intent: intent.choice,
      intentConfidence: intent.confidence,
      relation: relation.choice,
      relationConfidence: relation.confidence,
      roles,
      passed,
    };
    cache[key] = answer;
  }
  const claims: JudgedClaim[] = [];
  for (const hit of roleProofs(
    fact,
    section,
    answer.intent,
    answer.intentConfidence,
    answer.roles,
    answer.passed,
  )) {
    claims.push(claimFor(file, section, hit));
  }
  if (
    section.prose &&
    fact.description &&
    answer.relation === 'contradicts' &&
    answer.relationConfidence >= 0.8
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
      jev: { stale: 0, incomplete: 0, inaccurate: answer.relationConfidence, reason: 'prose' },
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
