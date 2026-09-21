import { maxScore, topDimension } from './policy';
import type { JudgedClaim, JudgedPage, SpecSlice } from './types';

/** The name a finding is about, as the reader would write it. */
function subject(claim: JudgedClaim): string {
  const ref = claim.specRef;
  if (!ref) return claim.text;
  return ref.member ? `${ref.export}.${ref.member}` : ref.export;
}

/**
 * Identifiers a finding is about, most exact first: what the overlay looks for on
 * the page to put the buoy on the word that is wrong. From code, never from the model.
 */
export function offending(claim: JudgedClaim): string[] {
  if (claim.jev?.names?.length) return claim.jev.names;
  return [...(claim.rule?.issue.matchAll(/'<?([\w$.]+)>?'/g) ?? [])].map((m) => m[1]);
}

/**
 * What is wrong, in one sentence, with identifiers in backticks. A code template:
 * the popover and the copied prompt both say this. `context` is the text around
 * the claim, when the caller has it: it tells a call from a field.
 */
export function sentence(claim: JudgedClaim, context?: string): string {
  const name = subject(claim);
  if (claim.kind === 'gap') return `\`${name}\` is in the spec, but this page never mentions it.`;
  if (claim.rule) return claim.rule.issue.replace(/'([^'\s]+)'/g, '`$1`');
  const top = topDimension(claim);
  if (top === 'stale') {
    const to = claim.specRef?.replacement;
    return `\`${name}\` is deprecated in the spec${to ? ` in favour of \`${to}\`` : ''}, and this still teaches it as current.`;
  }
  if (top === 'incomplete')
    return `Following this alone would fail: \`${name}\` requires something it leaves out.`;
  const names = claim.jev?.names ?? [];
  if (claim.jev?.reason === 'members' && names.length) {
    const called = names.some((n) => context?.includes(`${n}(`));
    const list = names.map((n) => `\`${n}\``).join(names.length > 2 ? ', ' : ' and ');
    // Without the text around it there is no telling a call from a field.
    const what = context === undefined ? 'member' : called ? 'method' : 'field';
    return `${list} ${names.length > 1 ? `are not ${what}s` : `is not a ${what}`} of ${name}.`;
  }
  switch (claim.jev?.reason) {
    case 'members':
      return `It uses a method or property that \`${name}\` does not have.`;
    case 'declared':
      return `The type written here is not the type the spec declares for \`${name}\`.`;
    default:
      return `What this says about \`${name}\` and what the spec says disagree.`;
  }
}

/** The one command that settles a finding. */
export function checkCommand(claim: JudgedClaim, page: JudgedPage | undefined): string {
  const entry = page?.source?.entry ? `${page.source.entry} ` : '';
  return claim.specRef
    ? `npx @driftdev/cli get ${entry}${claim.specRef.export}`
    : `npx @driftdev/cli list ${entry}`.trim();
}

/** The spec a claim should be read against: its replacement when deprecated. */
export function truthSlice(claim: JudgedClaim, slices: SpecSlice[]): SpecSlice | null {
  const ref = claim.specRef;
  if (!ref) return null;
  const find = (member?: string) =>
    slices.find((s) => s.export === ref.export && s.member === member);
  return (ref.replacement ? find(ref.replacement) : undefined) ?? find(ref.member) ?? ref;
}

export function signatureOf(slice: SpecSlice | null): string | null {
  return slice?.signature ?? slice?.body ?? null;
}

const GROUND_RULES = `## Ground rules

- The API spec is the source of truth. Edit docs only. Never change source code or the public API to make a finding go away.
- Verify before you edit. For each finding, read the real export with the command on its "Verify" line. One lookup per claim; never from memory, never by grepping source. If the \`drift\` skill or the \`drift mcp\` server is available in your harness, use it instead of the raw CLI.
- **Rule** findings are deterministic detector hits. Treat them as true unless the lookup contradicts them. If it does, do not edit: report it as a false positive.
- **Jev** findings are probabilities (stale, incomplete, inaccurate), not verdicts. Check each against the spec first. Skip the ones that are fine and say why.
- "Missing from page" means the spec exports it and the page never mentions it. Decide whether this page should document it. If not, say so instead of padding the page.
- Smallest edit that makes the claim true. Keep the author's voice and structure. Leave sections with no finding alone.
- If the docs look right and the spec looks wrong, stop and tell me. Do not "fix" either one.`;

function findingBlock(claim: JudgedClaim, page: JudgedPage, n: number, note?: string): string {
  const rendered = page.source?.mode === 'rendered';
  const label = claim.rule
    ? `Rule \`${claim.rule.type}\``
    : `Jev, ${Math.round(maxScore(claim) * 100)}% likely ${topDimension(claim)}`;
  const where = [
    claim.kind,
    rendered ? null : `line ${claim.locator.start.line}`,
    claim.locator.headingText ? `under "${claim.locator.headingText}"` : null,
  ].filter(Boolean);
  const lines = [`${n}. **${label}** · ${where.join(' · ')}`];
  lines.push(`   Text: \`${claim.kind === 'gap' ? `(missing) ${claim.text}` : claim.text}\``);
  if (claim.rule) lines.push(`   Issue: ${claim.rule.issue}`);
  else if (claim.jev) lines.push(`   Why: ${sentence(claim)}`);
  if (claim.rule?.suggestion) lines.push(`   Detector hint: ${claim.rule.suggestion}`);
  const signature = signatureOf(truthSlice(claim, page.slices));
  if (signature) lines.push(`   Spec: \`${signature}\``);
  const declared = claim.specRef ? page.declared?.[claim.specRef.export] : undefined;
  if (declared) lines.push(`   Declared: \`${declared}\``);
  const check = checkCommand(claim, page);
  lines.push(
    claim.specRef
      ? `   Verify: \`${check}\``
      : `   Verify: \`${check}\` to see what the package really exports`,
  );
  if (note) lines.push(`   Reviewer note: ${note}`);
  return lines.join('\n');
}

/**
 * The copy button's payload: a brief a coding agent can act on in any harness.
 * It hands over findings, the spec, and how to verify. It never contains a rewrite;
 * the agent does the editing, checked against Drift.
 */
export function toPrompt(
  pages: JudgedPage[],
  findings: Set<JudgedClaim>,
  notes: Record<string, string>,
  route: string,
): string {
  const sections = pages.flatMap((page) => {
    const claims = page.claims.filter((claim) => findings.has(claim));
    if (!claims.length) return [];
    const heading =
      page.source?.mode === 'rendered'
        ? `### Rendered page \`${page.path}\`\n\nChecked as rendered, so there is no source path. Find the file by searching the repo for the quoted text.`
        : `### \`${page.path}\``;
    const items = claims.map((claim, i) => findingBlock(claim, page, i + 1, notes[claim.id]));
    return [`${heading}\n\n${items.join('\n\n')}`];
  });
  const total = sections.length ? [...findings].length : 0;
  return `# Fix docs drift on ${route}

These docs have drifted from the API they document. Buoy, a docs review overlay, pinned ${total} finding${total === 1 ? '' : 's'} on the rendered page and a person reviewed them there. Work through them below.

${GROUND_RULES}

## Findings

${sections.join('\n\n')}

## When you are done

- Run \`npx buoy build\` and confirm these findings are gone.
- Report per finding: what you changed, what you skipped and why, and any false positives (those are bugs in the detector, worth filing).
`;
}
