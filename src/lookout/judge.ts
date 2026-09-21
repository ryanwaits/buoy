/**
 * The judge: Drift's claims in, the same claims with `jev` out.
 *
 * One request per distinct (passage, spec record): every question about it goes
 * in that request, answered in parallel and in isolation. Answers are cached by
 * content and rubric version, so an unchanged page costs nothing to rebuild.
 */

import { createHash } from 'node:crypto';
import type { Classifier, Noul } from '../sonar';
import type { Claim, Jev, JudgedClaim, PageDocument } from '../types';
import {
  checkableUse,
  knownMembers,
  type OpenPkgSpec,
  passageAt,
  type SpecRecord,
  showsUse,
  specRecord,
  type Use,
  unknownMembers,
} from './evidence';
import { combine, QUESTIONS, type QuestionId, RUBRIC } from './rubric';

export type JudgeInput = {
  page: PageDocument;
  /** The markdown the page's locators point into */
  content: string;
  spec: OpenPkgSpec;
  /** Other entries the page documents. A claim is read against the first spec that has its export. */
  also?: OpenPkgSpec[];
};

/** Hash → the raw answers for one request. Survives between builds. */
export type JudgeCache = Record<string, Record<string, number>>;

export type JudgeStats = { requests: number; cached: number; inputTokens: number; model?: string };

type Ask = {
  state: Record<string, unknown>;
  questions: Record<string, Noul>;
  used: Use | null;
  overloaded: boolean;
  passage: string;
  /** Read from the passage and the spec by code, after the answer: never sent, never cached. */
  names: () => string[];
  /** What the record does have, shown beside `names`. */
  has: () => string[];
};

function askFor(claim: Claim, input: JudgeInput): Ask | null {
  // A rule hit is certain; a gap is a rule hit. Jev has no say on either.
  if (claim.kind === 'gap' || claim.rule) return null;
  const passage = passageAt(input.content, claim.locator.start.line);
  if (!passage.trim()) return null;
  const questions: Record<string, Noul> = {};
  const heading = claim.locator.headingText;
  const state: Record<string, unknown> = {
    package: input.page.packageName,
    ...(heading ? { heading } : {}),
    passage,
  };

  const home = [input.spec, ...(input.also ?? [])].find((spec) =>
    spec.exports.some((e) => e.name === claim.specRef?.export),
  );
  const entry = home?.exports.find((e) => e.name === claim.specRef?.export);
  // A member's record lists no members, so there is nothing for a name to be missing from.
  const names = (): string[] =>
    home && entry && !claim.specRef?.member ? unknownMembers(passage, home, entry) : [];
  const has = (): string[] => (home && entry ? knownMembers(home, entry) : []);
  if (home && entry && claim.specRef) {
    state.export = specRecord(home, entry, claim.specRef.member, passage);
    Object.assign(questions, QUESTIONS);
  }
  const name = claim.specRef?.member
    ? `${claim.specRef.export}.${claim.specRef.member}`
    : (claim.specRef?.export ?? '');
  const record = state.export as SpecRecord | undefined;
  const used = record ? checkableUse(passage, record) : showsUse(passage, name);
  const overloaded = (record?.overloads?.length ?? 0) > 1;
  return Object.keys(questions).length
    ? { state, questions, used, overloaded, passage, names, has }
    : null;
}

// Only what Jev is sent. `used` is read from the passage after the answer comes back, so a
// change to that check must not throw the answers away.
const keyOf = (ask: Ask, model: string): string =>
  createHash('sha256')
    .update(JSON.stringify([RUBRIC, model, ask.state, ask.questions]))
    .digest('hex')
    .slice(0, 32);

type Asked = Pick<Ask, 'used' | 'overloaded' | 'passage' | 'names' | 'has'> & { key: string };

function toJev(answers: Record<string, number>, { used, overloaded, names, has }: Asked): Jev {
  const scored =
    'about' in answers ? combine(answers as Record<QuestionId, number>, used, overloaded) : null;
  const missing = scored && scored.inaccurate > 0 && scored.reason === 'members' ? names() : [];
  return {
    stale: scored?.stale ?? 0,
    incomplete: scored?.incomplete ?? 0,
    inaccurate: scored?.inaccurate ?? 0,
    ...(scored && scored.inaccurate > 0 ? { reason: scored.reason } : {}),
    ...(missing.length ? { names: missing, has: has() } : {}),
  };
}

async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await work(items[next++]);
    }),
  );
}

/** Judge every claim Jev can say something about. Mutates `cache`; returns pages with `claim.jev` set. */
export async function judge(
  inputs: JudgeInput[],
  classifier: Classifier,
  cache: JudgeCache,
): Promise<{
  pages: (Omit<PageDocument, 'claims'> & { claims: JudgedClaim[] })[];
  stats: JudgeStats;
}> {
  const stats: JudgeStats = { requests: 0, cached: 0, inputTokens: 0 };
  const asks = new Map<string, Ask>();
  const keys = new Map<Claim, Asked>();
  for (const input of inputs) {
    for (const claim of input.page.claims) {
      const ask = askFor(claim, input);
      if (!ask) continue;
      const key = keyOf(ask, classifier.name);
      const { used, overloaded, passage, names, has } = ask;
      keys.set(claim, { key, used, overloaded, passage, names, has });
      if (cache[key]) stats.cached++;
      else asks.set(key, ask);
    }
  }

  await pool([...asks], 8, async ([key, ask]) => {
    const result = await classifier.evaluate({
      state: ask.state as never,
      questions: ask.questions,
    });
    cache[key] = Object.fromEntries(
      Object.entries(result.answers).map(([id, a]) => [id, a.probability]),
    );
    stats.requests++;
    stats.inputTokens += result.usage.inputTokens;
    stats.model = result.model;
  });

  const pages = inputs.map(({ page }) => {
    // Drift claims a name once in the sentence and once in the fence or code span under it.
    // They read the same passage against the same record, so Jev's answer is one finding, told
    // once, on the most exact anchor: anything but the whole sentence. A rule hit keeps its own:
    // there the answer is a second opinion on the rule.
    const teller = new Map<string, Claim>();
    for (const claim of page.claims) {
      const key = keys.get(claim)?.key;
      if (!key || claim.rule) continue;
      const held = teller.get(key);
      if (!held || (held.kind === 'prose' && claim.kind !== 'prose')) teller.set(key, claim);
    }
    const judged = page.claims.map((claim): JudgedClaim => {
      const asked = keys.get(claim);
      const answers = asked && cache[asked.key];
      if (!asked || !answers) return claim;
      if (!claim.rule && teller.get(asked.key) !== claim) return claim;
      return { ...claim, jev: toJev(answers, asked) };
    });
    // A fence is read together with the paragraph that introduces it. When what is wrong is
    // something that paragraph SAYS, and the paragraph has its own finding for the same export,
    // the fence is only repeating it.
    const said = (c: JudgedClaim): boolean =>
      c.jev?.reason === 'prose' || c.jev?.reason === 'declared';
    const sameExport = (a: Claim, b: Claim): boolean =>
      a.specRef?.export === b.specRef?.export && a.specRef?.member === b.specRef?.member;
    const claims = judged.map((claim, i): JudgedClaim => {
      const mine = keys.get(page.claims[i])?.passage;
      if (claim.rule || !mine || !said(claim)) return claim;
      const echoes = judged.some((other, j) => {
        const theirs = keys.get(page.claims[j])?.passage;
        return (
          j !== i &&
          !other.rule &&
          theirs !== undefined &&
          said(other) &&
          sameExport(other, claim) &&
          mine.startsWith(`${theirs}\n\n`)
        );
      });
      if (!echoes) return claim;
      const { jev: _repeated, ...rest } = claim;
      return rest;
    });
    return { ...page, claims };
  });
  return { pages, stats };
}
