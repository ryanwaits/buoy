/**
 * A few lines of source around each declaration a finding cites, so the card can show
 * the code without leaving the page. Read at build time, where the repo is on disk;
 * the overlay never fetches.
 */

import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { Claim } from './types';

export type Excerpt = {
  /** Relative to the repo root, as `declared` writes it. */
  file: string;
  /** Line number of `lines[0]`, 1-based. */
  from: number;
  /** The line the finding is about: the declaration, or the member inside it. */
  at: number;
  lines: string[];
};

const BEFORE = 2;
const AFTER = 6;
const WIDTH = 160;

/**
 * Where a member is declared inside its export: the first line at or after the export's own
 * that starts a declaration of that name. Inherited members are in another file and give
 * nothing, which the card then says.
 */
export function memberLine(lines: string[], from: number, member: string): number | undefined {
  const name = member.replace(/[$]/g, '\\$');
  const decl = new RegExp(
    `^\\s*(?:(?:public|protected|private|static|readonly|async|abstract|override|get|set|declare)\\s+)*${name}\\s*[?!]?\\s*[(<:=]`,
  );
  for (let i = from - 1; i < lines.length; i++) {
    if (decl.test(lines[i])) return i + 1;
  }
  return undefined;
}

function cut(file: string, lines: string[], at: number): Excerpt {
  const from = Math.max(1, at - BEFORE);
  const to = Math.min(lines.length, at + AFTER);
  const slice = lines
    .slice(from - 1, to)
    .map((l) => (l.length > WIDTH ? `${l.slice(0, WIDTH - 1)}…` : l));
  while (slice.length > at - from + 1 && slice[slice.length - 1].trim() === '') slice.pop();
  return { file, from, at, lines: slice };
}

/**
 * Excerpts for every export the claims cite, keyed by export name, plus `Export.member`
 * for each member claim whose line is found in the export's file. `declared` is the
 * export → `file:line` map the same page carries; files are read under `root`.
 */
export function excerptsFor(
  claims: Pick<Claim, 'specRef'>[],
  declared: Record<string, string>,
  root: string,
): Record<string, Excerpt> | undefined {
  const out: Record<string, Excerpt> = {};
  const read = new Map<string, string[] | null>();
  const linesOf = (file: string): string[] | null => {
    if (!read.has(file)) {
      const full = path.resolve(root, file);
      read.set(
        file,
        existsSync(full) ? readFileSync(full, 'utf8').replace(/\r\n/g, '\n').split('\n') : null,
      );
    }
    return read.get(file) ?? null;
  };
  for (const claim of claims) {
    const ref = claim.specRef;
    const where = ref ? declared[ref.export] : undefined;
    if (!ref || !where) continue;
    const m = /^(.*):(\d+)$/.exec(where);
    if (!m) continue;
    const [, file, line] = m;
    const lines = linesOf(file);
    if (!lines) continue;
    const at = Number(line);
    out[ref.export] ??= cut(file, lines, at);
    if (ref.member && !(`${ref.export}.${ref.member}` in out)) {
      const own = memberLine(lines, at, ref.member);
      if (own !== undefined) out[`${ref.export}.${ref.member}`] = cut(file, lines, own);
    }
  }
  return Object.keys(out).length ? out : undefined;
}
