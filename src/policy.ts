import { DIMENSIONS, type Dimension, INACCURATE_MIN, THRESHOLDS } from './lookout/thresholds';
import type { JudgedClaim } from './types';

export { DIMENSIONS, type Dimension };

/** The cut a dimension has to clear. `inaccurate` has one per question. */
function cut(claim: JudgedClaim, d: Dimension): number {
  return d === 'inaccurate' ? INACCURATE_MIN[claim.jev?.reason ?? 'prose'] : THRESHOLDS[d];
}

/** The dimensions a claim's scores clear, highest score first. */
function cleared(claim: JudgedClaim): Dimension[] {
  const jev = claim.jev;
  if (!jev) return [];
  return DIMENSIONS.filter((d) => jev[d] >= cut(claim, d)).sort((a, b) => jev[b] - jev[a]);
}

/** What Jev thinks is most wrong: the strongest cleared dimension, else simply the highest score. */
export function topDimension(claim: JudgedClaim): Dimension {
  const jev = claim.jev;
  return cleared(claim)[0] ?? [...DIMENSIONS].sort((a, b) => (jev?.[b] ?? 0) - (jev?.[a] ?? 0))[0];
}

/** The score shown to the reader: that of the top dimension. */
export function maxScore(claim: JudgedClaim): number {
  return claim.jev?.[topDimension(claim)] ?? 0;
}

/**
 * A finding is a rule hit, or a Jev score over its cut. `candidate` claims are
 * Drift's inventory and carry neither, so they never show.
 */
export function isFinding(claim: JudgedClaim): boolean {
  return claim.rule !== undefined || cleared(claim).length > 0;
}

export type FindingType = 'rule' | 'jev' | 'gap';

export function findingType(claim: JudgedClaim): FindingType {
  if (claim.kind === 'gap') return 'gap';
  return claim.rule ? 'rule' : 'jev';
}

/** What a finding is about, in the reader's words. The filter panel groups by these. */
export const KINDS = {
  name: 'Wrong name or import',
  args: 'Arguments and props',
  deprecated: 'Deprecated',
  says: 'Says what the spec does not',
  gap: 'Never mentioned',
} as const;

export type Kind = keyof typeof KINDS;

const RULE_KINDS: Record<string, Kind> = {
  'spec-not-in-claims': 'gap',
  'key-gap': 'gap',
  'prose-deprecated-reference': 'deprecated',
  'deprecated-mismatch': 'deprecated',
  'prose-unknown-key': 'args',
  'prose-arity-mismatch': 'args',
  'prose-missing-required': 'args',
  'prose-literal-type-mismatch': 'args',
  'prose-param-mismatch': 'args',
  'param-mismatch': 'args',
  'param-type-mismatch': 'args',
  'optionality-mismatch': 'args',
  'key-ghost': 'args',
  'key-inversion': 'args',
  'return-type-mismatch': 'says',
  'property-type-drift': 'says',
};

export function kindOf(claim: JudgedClaim): Kind {
  if (claim.kind === 'gap') return 'gap';
  if (claim.rule) return RULE_KINDS[claim.rule.type] ?? 'name';
  const top = topDimension(claim);
  if (top === 'stale') return 'deprecated';
  return top === 'incomplete' ? 'args' : 'says';
}

export type Evidence = 'proved' | 'likely';

/** Proved: code checked it. Likely: a model's read, with the odds. */
export function evidenceOf(claim: JudgedClaim): Evidence {
  return claim.rule ? 'proved' : 'likely';
}

/** Filter keys are evidence names and kind names; a finding shows unless one of its two is hidden. */
export function isHidden(claim: JudgedClaim, hidden: ReadonlySet<string>): boolean {
  return hidden.has(evidenceOf(claim)) || hidden.has(kindOf(claim));
}

/**
 * The same thing wrong in several places is one issue: one decision for the reader,
 * one count in the toolbar. A section's missing members are one question per type.
 */
export function issueKey(claim: JudgedClaim): string {
  const ref = claim.specRef;
  if (claim.kind === 'gap') return `gap|${ref?.export ?? claim.id}`;
  if (claim.rule) return `${claim.rule.type}|${claim.rule.issue}`;
  if (!ref) return claim.id;
  const jev = claim.jev;
  return [topDimension(claim), jev?.reason, ref.export, ref.member, ...(jev?.names ?? [])].join(
    '|',
  );
}

/** How many decisions a set of findings asks for. */
export function issueCount(claims: JudgedClaim[]): number {
  return new Set(claims.map(issueKey)).size;
}
