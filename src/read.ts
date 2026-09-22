/**
 * One heading section, one export, a thin record.
 *
 * Code proves a name in a use position that the record does not have, and a
 * required argument a call does not pass. Jev is asked one question: does the
 * prose contradict the description. An older-version label, lifted by the scan,
 * drops the section before either runs.
 */

import { createHash } from 'node:crypto';
import { displayName, type OpenPkgExport, type OpenPkgSpec, unpacked } from './lookout/evidence';
import type { Classifier } from './sonar';
import type { JudgedClaim } from './types';

type Schema = {
  properties?: Record<string, Schema>;
  required?: string[];
  anyOf?: Schema[];
  oneOf?: Schema[];
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

function factOf(spec: OpenPkgSpec, entry: OpenPkgExport): Fact {
  const sigs = (entry.signatures ?? []).map((sig) => unpacked(sig as Signature, spec) as Signature);
  const shaped = sigs.filter((sig) => sig.braces);
  const use = shaped.length ? shaped : sigs;
  const allowed = new Set<string>();
  for (const sig of use) for (const param of sig.parameters ?? []) allowed.add(param.name);
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

export function checkSection(
  section: Section,
  index: Index,
  importFrom: string[],
): { hits: Hit[]; mentioned: Fact[] } {
  if (section.older) return { hits: [], mentioned: [] };
  const hits: Hit[] = [];
  const mentioned = new Set<Fact>();
  const at = (line: number): number => section.start + line - 1;

  for (const found of importsIn(section.text, importFrom)) {
    const line = lineOf(section.text, found.at);
    if (!index.has(found.name)) {
      hits.push({
        line: at(line),
        exportName: found.name,
        type: 'absent-name',
        text: found.name,
        issue: `Import '${found.name}' is not exported`,
      });
    }
  }

  for (const [name, fact] of index) {
    if (!mentionedIn(section.text, name)) continue;
    mentioned.add(fact);
    if (fact.deprecated && !/deprecat/i.test(section.text)) {
      const line = lineOf(
        section.text,
        section.text.search(new RegExp(`(?<![\\w$])${name}(?![\\w$])`)),
      );
      hits.push({
        line: at(line),
        exportName: fact.name,
        type: 'deprecated-export',
        text: name,
        issue: `'${fact.name}' is deprecated${fact.replacement ? ` in favour of '${fact.replacement}'` : ''}, and this still teaches it as current`,
      });
    }
    for (const call of callsOf(section.text, name)) {
      const line = at(lineOf(section.text, call.at));
      if (fact.braces && fact.allowed.length) {
        for (const key of call.keys) {
          if (!fact.allowed.includes(key) && !fact.members.includes(key)) {
            hits.push({
              line,
              exportName: fact.name,
              type: 'absent-name',
              text: key,
              issue: `'${key}' is not an option of '${fact.name}'`,
            });
          }
        }
      }
      if (!call.elided && fact.braces) {
        for (const req of fact.required) {
          if (!call.keys.includes(req)) {
            hits.push({
              line,
              exportName: fact.name,
              type: 'missing-required',
              text: name,
              issue: `Call '${fact.name}' is missing required argument '${req}'`,
            });
          }
        }
        if (
          fact.oneOf.length &&
          !fact.oneOf.some((arm) => arm.every((key) => call.keys.includes(key)))
        ) {
          const arms = fact.oneOf.map((arm) => `'${arm.join(' + ')}'`).join(' or ');
          hits.push({
            line,
            exportName: fact.name,
            type: 'missing-required',
            text: name,
            issue: `Call '${fact.name}' needs one of ${arms}`,
          });
        }
      }
      if (!fact.braces) {
        for (const arg of call.positional) {
          if (!fact.allowed.includes(arg) && !index.has(arg)) {
            hits.push({
              line,
              exportName: fact.name,
              type: 'absent-name',
              text: arg,
              issue: `'${arg}' is not a parameter of '${fact.name}'`,
            });
          }
        }
      }
    }
    if (fact.members.length) {
      for (const member of shapeMembers(section.text, name)) {
        if (!fact.members.includes(member.name)) {
          hits.push({
            line: at(lineOf(section.text, member.at)),
            exportName: fact.name,
            type: 'absent-name',
            text: member.name,
            issue: `'${member.name}' is not a member of '${fact.name}'`,
          });
        }
      }
    }
  }

  const seen = new Set<string>();
  return {
    hits: hits.filter((hit) => {
      const key = `${hit.line}|${hit.issue}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    mentioned: [...mentioned],
  };
}

function mentionedIn(text: string, name: string): boolean {
  return new RegExp(`(?<![\\w$])${pattern(name)}(?![\\w$])`).test(text);
}

function lineOf(text: string, index: number): number {
  if (index < 0) return 1;
  return text.slice(0, index).split('\n').length;
}

function pattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function importsIn(text: string, from: string[]): { name: string; at: number }[] {
  if (!from.length) return [];
  const out: { name: string; at: number }[] = [];
  const re = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  for (const match of text.matchAll(re)) {
    const specifier = match[2];
    if (
      specifier.startsWith('.') ||
      !from.some((item) => specifier === item || specifier.startsWith(`${item}/`))
    )
      continue;
    const at = match.index ?? 0;
    const clause = match[1] ?? '';
    const head = clause.trim();
    if (/^[\w$]+/.test(head)) out.push({ name: /^[\w$]+/.exec(head)?.[0] ?? '', at });
    const brace = /\{([^}]+)\}/.exec(clause);
    for (const part of (brace?.[1] ?? '').split(',')) {
      const raw = part.trim();
      if (!raw) continue;
      const renamed = /([\w$]+)\s+as\s+[\w$]+/.exec(raw);
      if (renamed) {
        out.push({ name: renamed[1], at });
        continue;
      }
      for (const name of raw.split(':')) {
        const side = name.trim();
        if (/^[\w$]+$/.test(side)) out.push({ name: side, at });
      }
    }
  }
  return out.filter((item) => item.name && item.name !== 'type');
}

type Call = { at: number; keys: string[]; positional: string[]; elided: boolean };

function callsOf(text: string, name: string): Call[] {
  const out: Call[] = [];
  const re = new RegExp(`(?<![\\w$.])${pattern(name)}\\s*(?:<[^\\n>]{0,160}>)?\\s*\\(`, 'g');
  for (const match of text.matchAll(re)) {
    const paren = (match.index ?? 0) + match[0].lastIndexOf('(');
    const parsed = parseCall(text, paren);
    if (parsed) out.push({ at: match.index ?? 0, ...parsed });
  }
  const jsx = new RegExp(`<${pattern(name)}\\b([^>]*)>`, 'g');
  for (const match of text.matchAll(jsx)) {
    const keys = [...(match[1] ?? '').matchAll(/([\w$]+)\s*=/g)].map((item) => item[1]);
    out.push({
      at: match.index ?? 0,
      keys,
      positional: [],
      elided: /\{\s*\.\.\./.test(match[1] ?? ''),
    });
  }
  return out;
}

function parseCall(
  text: string,
  paren: number,
): { keys: string[]; positional: string[]; elided: boolean } | null {
  let look = paren + 1;
  while (look < text.length && /\s/.test(text[look])) look++;
  const braces = text[look] === '{';
  const keys: string[] = [];
  const positional: string[] = [];
  let elided = false;
  let parenDepth = 0;
  let braceDepth = 0;
  let token = '';
  const take = (next: string): void => {
    if (!token) return;
    const word = token;
    token = '';
    if (braces && braceDepth === 1 && parenDepth === 1 && /^\s*:/.test(next)) keys.push(word);
    else if (!braces && parenDepth === 1 && braceDepth === 0) positional.push(word);
  };
  for (let at = paren; at < text.length; at++) {
    const ch = text[at];
    if (ch === '(') {
      take(text.slice(at));
      parenDepth++;
      continue;
    }
    if (ch === ')') {
      take(text.slice(at));
      parenDepth--;
      if (parenDepth === 0) break;
      continue;
    }
    if (ch === '{') {
      take(text.slice(at));
      braceDepth++;
      continue;
    }
    if (ch === '}') {
      take(text.slice(at));
      braceDepth--;
      continue;
    }
    if (ch === '/' && text[at + 1] === '/') {
      if (braces && braceDepth === 1 && parenDepth === 1) elided = true;
      while (at < text.length && text[at] !== '\n') at++;
      continue;
    }
    if (ch === '/' && text[at + 1] === '*') {
      if (braces && braceDepth === 1 && parenDepth === 1) elided = true;
      at += 2;
      while (at < text.length && !(text[at] === '*' && text[at + 1] === '/')) at++;
      continue;
    }
    if (ch === '.' && text[at + 1] === '.' && text[at + 2] === '.') {
      if ((braces && braceDepth === 1) || (!braces && parenDepth === 1 && braceDepth === 0))
        elided = true;
      token = '';
      at += 2;
      continue;
    }
    if (/[\w$]/.test(ch)) {
      token += ch;
      if (!/[\w$]/.test(text[at + 1] ?? '')) take(text.slice(at + 1));
      continue;
    }
    token = '';
  }
  return { keys, positional, elided };
}

function shapeMembers(text: string, name: string): { name: string; at: number }[] {
  const out: { name: string; at: number }[] = [];
  const re = new RegExp(
    `(?<![\\w$])${pattern(name)}(?![\\w$])[^\\n{}]{0,40}\\{([^{}\\n]+)\\}`,
    'g',
  );
  for (const match of text.matchAll(re)) {
    const body = match[1] ?? '';
    const at = match.index ?? 0;
    for (const ident of body.matchAll(/[\w$]+/g)) {
      if (/^(key|type|string|number|boolean)$/.test(ident[0])) continue;
      out.push({ name: ident[0].replace(/\?$/, ''), at: at + (ident.index ?? 0) });
    }
  }
  return out;
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

export type ReadCache = Record<string, { choice: string; confidence: number }>;

export type ReadStats = { requests: number; cached: number; inputTokens: number; model?: string };

/**
 * Behaviour only. One Choice per mentioned export: the sentence against the
 * description. Code proofs are already on the claims.
 */
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
  const jobs: { section: Section; fact: Fact }[] = [];
  for (const section of splitSections(content)) {
    const found = checkSection(section, index, importFrom);
    for (const hit of found.hits) claims.push(claimFor(file, section, hit));
    if (!section.prose || section.older) continue;
    for (const fact of found.mentioned) {
      if (fact.description) jobs.push({ section, fact });
    }
  }
  const stats: ReadStats = { requests: 0, cached: 0, inputTokens: 0 };
  for (const job of jobs) {
    const behaviour = await ask(file, job.section, job.fact, classifier, cache, stats);
    if (behaviour) claims.push(behaviour);
  }
  return { claims, stats };
}

function merge(specs: OpenPkgSpec[]): OpenPkgSpec {
  return {
    exports: specs.flatMap((spec) => spec.exports),
    types: specs.flatMap((spec) => spec.types ?? []),
  };
}

async function ask(
  file: string,
  section: Section,
  fact: Fact,
  classifier: Classifier | null,
  cache: ReadCache,
  stats: ReadStats,
): Promise<JudgedClaim | null> {
  if (!classifier || !fact.description) return null;
  const state = {
    export: { name: fact.name, description: fact.description, deprecated: fact.deprecated },
    section: section.text.slice(0, 4000),
  };
  const key = createHash('sha256')
    .update(`b1\0${JSON.stringify(state)}`)
    .digest('hex');
  const cached = cache[key];
  let answer = cached && typeof cached.choice === 'string' ? cached : undefined;
  if (answer) stats.cached++;
  else {
    const result = await classifier.evaluate({
      state,
      questions: {
        relation: {
          type: 'choice',
          instructions:
            'How does `section` relate to `export.description`? A sample labeled as an older version is showing the past, which is `says_nothing`.',
          criteria: {
            matches: 'The section states what the description states.',
            contradicts: 'The section states a behaviour the description denies.',
            says_nothing: 'The section does not address the description.',
          },
        },
      },
    });
    stats.requests++;
    stats.inputTokens += result.usage.inputTokens;
    stats.model = result.model;
    const choice = result.answers.relation;
    const probs = 'probabilities' in choice ? choice.probabilities : {};
    const values = Object.values(probs);
    const peak = values.length ? Math.max(...values) : 0;
    const confidence = values.length > 1 ? (values.length * peak - 1) / (values.length - 1) : peak;
    answer = { choice: 'choice' in choice ? choice.choice : 'says_nothing', confidence };
    cache[key] = answer;
  }
  if (answer.choice !== 'contradicts' || answer.confidence < 0.8) return null;
  const line = section.start;
  return {
    id: `${file}:${line}:behaviour:${fact.name}`,
    kind: 'prose',
    text: proseOf(section.text).split('\n')[0] ?? fact.name,
    locator: {
      path: file,
      start: { line, col: 1 },
      end: { line, col: 1 },
      ...(section.heading ? { headingText: section.heading.replace(/`/g, '') } : {}),
    },
    specRef: { export: fact.name },
    jev: { stale: 0, incomplete: 0, inaccurate: answer.confidence, reason: 'prose' },
  };
}
