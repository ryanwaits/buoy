/**
 * Where an export is declared, from the spec: what lets a finding say "see
 * `packages/storage/src/live-object.ts:15`" instead of leaving the reader to grep.
 */

import * as path from 'node:path';
import type { OpenPkgSpec } from './lookout/evidence';
import type { Claim } from './types';

/**
 * `file:line` for every export the claims cite, keyed by export name. Specs are read in the
 * judge's order: the first one that exports the name, then the first that has it as a type.
 * OpenPkg writes the path as it resolved it, usually absolute; under `root` it is made relative,
 * so the manifest reads the same on every machine. Undefined when the spec places none of them.
 */
export function declaredAt(
  claims: Pick<Claim, 'specRef'>[],
  specs: OpenPkgSpec[],
  root?: string,
): Record<string, string> | undefined {
  const declared: Record<string, string> = {};
  for (const name of new Set(claims.flatMap((c) => c.specRef?.export ?? []))) {
    const source = [
      ...specs.map((spec) => spec.exports.find((e) => e.name === name)),
      ...specs.map((spec) => spec.types?.find((t) => t.name === name)),
    ].find((found) => found?.source?.file)?.source;
    if (!source?.file) continue;
    const file =
      root && path.isAbsolute(source.file) ? path.relative(root, source.file) : source.file;
    declared[name] = `${file.replace(/\\/g, '/')}${source.line ? `:${source.line}` : ''}`;
  }
  return Object.keys(declared).length ? declared : undefined;
}

/** What kind of thing a member is, in a reader's word: OpenPkg's `getter`, `method`, `property`... */
export function memberKinds(
  claims: Pick<Claim, 'specRef' | 'kind'>[],
  specs: OpenPkgSpec[],
): Record<string, string> | undefined {
  const kinds: Record<string, string> = {};
  for (const claim of claims) {
    const ref = claim.specRef;
    if (claim.kind !== 'gap' || !ref?.member) continue;
    const entry = [
      ...specs.map((spec) => spec.exports.find((e) => e.name === ref.export)),
      ...specs.map((spec) => spec.types?.find((t) => t.name === ref.export)),
    ].find(Boolean);
    const member = entry?.members?.find((m) => m.name === ref.member);
    if (member?.kind) kinds[`${ref.export}.${ref.member}`] = member.kind;
  }
  return Object.keys(kinds).length ? kinds : undefined;
}
