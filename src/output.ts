import { maxScore, topDimension } from './policy';
import type { Decision } from './store';
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

/** JSDoc as a reader would see it: `{@link cuid2 \`z.cuid2()\`}` reads `z.cuid2()`, `{@link Foo}` reads `Foo`. */
export function plainDoc(text: string): string {
  return text
    .replace(
      /\{@(?:link|linkcode|linkplain)\s+([^\s}|]+)(?:\s*\|?\s*([^}]*))?\}/g,
      (_, target: string, label: string) => (label ?? '').trim().replace(/^`|`$/g, '') || target,
    )
    .replace(/\s+/g, ' ')
    .trim();
}

const KIND_WORD: Record<string, string> = {
  getter: 'getter',
  setter: 'setter',
  method: 'method',
  property: 'property',
  field: 'property',
  accessor: 'accessor',
};

/**
 * A member the page never documents. Says what kind of thing it is, because the
 * same name often appears on the page as something else: `port: 1999` is the
 * constructor option, not the `port` getter the reader gets back.
 */
function gapSentence(claim: JudgedClaim, context: string | undefined, kind?: string): string {
  const ref = claim.specRef;
  if (!ref?.member)
    return `\`${subject(claim)}\` is in the spec, but this page never documents it.`;
  const word = kind ? KIND_WORD[kind] : undefined;
  const shown = word === 'method' ? `${ref.member}()` : ref.member;
  const head = word
    ? `\`${ref.export}\` has a \`${shown}\` ${word} this page never documents.`
    : `\`${ref.export}.${ref.member}\` is in the spec, but this page never documents it.`;
  // The name written as a key (`port:`, `port?:`) is an option or a field of some other shape.
  const asKey = context && new RegExp(`(^|[\\s{,(])${ref.member}\\s*\\??:`).test(context);
  return asKey && word && word !== 'property'
    ? `${head} The \`${ref.member}:\` on this page is an option key, not the ${word}.`
    : head;
}

/**
 * What is wrong, in one sentence, with identifiers in backticks. A code template:
 * the popover and the copied prompt both say this. `context` is the text around
 * the claim, when the caller has it: it tells a call from a field.
 */
export function sentence(claim: JudgedClaim, context?: string, kind?: string): string {
  const name = subject(claim);
  if (claim.kind === 'gap') return gapSentence(claim, context, kind);
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
  const declared = claim.specRef ? page?.declared?.[claim.specRef.export] : undefined;
  if (declared) return declared;
  const entry = page?.source?.entry ?? '';
  return claim.specRef ? `${entry} ${claim.specRef.export}`.trim() : entry;
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

- The reviewer's decisions come first. Do what they say. A decision that says the source code is wrong is not a docs edit: stop, report it, and move on.
- The API spec is the source of truth. Edit docs only. Never change source code or the public API to make a finding go away.
- Verify before you edit. For each finding, read the declaration on its "Verify" line. One lookup per claim; never from memory.
- **Rule** findings are deterministic detector hits. Treat them as true unless the lookup contradicts them. If it does, do not edit: report it as a false positive.
- **Jev** findings are probabilities (stale, incomplete, inaccurate), not verdicts. Check each against the spec first. Skip the ones that are fine and say why.
- "Never documented" means the spec has it and the page never documents it. Decide whether this page should document it. If not, say so instead of padding the page.
- Smallest edit that makes the claim true. Keep the author's voice and structure. Leave sections with no finding alone.
- If the docs look right and the spec looks wrong, stop and tell me. Do not "fix" either one.`;

function findingBlock(claim: JudgedClaim, page: JudgedPage, n: number, decision?: string): string {
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
  if (decision !== undefined) lines.push(`   Decision: ${decision || 'Real. Fix it.'}`);
  return lines.join('\n');
}

/** What a decision says about a finding, in one line. */
function decisionLine(claim: JudgedClaim, decision: string): string {
  return `${sentence(claim)}\n   → ${decision || 'Real. Fix it.'}`;
}

/**
 * The copy button's payload: a brief a coding agent can act on in any harness.
 * The reader's decisions lead; the findings follow as context, with the spec and how to
 * verify each. It never contains a rewrite; the agent does the editing, checked against the spec.
 * A finding resolved as not a problem (`null`) is left out.
 */
export function toPrompt(
  pages: JudgedPage[],
  findings: Set<JudgedClaim>,
  resolved: Record<string, Decision>,
  route: string,
): string {
  const kept = (claim: JudgedClaim): boolean => findings.has(claim) && resolved[claim.id] !== null;
  const decided = pages.flatMap((page) =>
    page.claims.filter((c) => kept(c) && typeof resolved[c.id] === 'string'),
  );
  const sections = pages.flatMap((page) => {
    const claims = page.claims.filter(kept);
    if (!claims.length) return [];
    const heading =
      page.source?.mode === 'rendered'
        ? `### Rendered page \`${page.path}\`\n\nChecked as rendered, so there is no source path. Find the file by searching the repo for the quoted text.`
        : `### \`${page.path}\``;
    const items = claims.map((claim, i) =>
      findingBlock(claim, page, i + 1, resolved[claim.id] ?? undefined),
    );
    return [`${heading}\n\n${items.join('\n\n')}`];
  });
  const total = pages.flatMap((p) => p.claims).filter(kept).length;
  const decisions = decided.length
    ? `## Decisions

The reviewer resolved ${decided.length} of these on the page. In their words:

${decided.map((c, i) => `${i + 1}. ${decisionLine(c, resolved[c.id] as string)}`).join('\n')}

`
    : '';
  return `# Fix docs drift on ${route}

These docs have drifted from the API they document. Buoy, a docs review overlay, pinned ${total} finding${total === 1 ? '' : 's'} on the rendered page and a person reviewed them there. Work through them below.

${decisions}${GROUND_RULES}

## Findings

${sections.join('\n\n')}

## When you are done

- Run \`npx buoy build\` and confirm these findings are gone.
- Report per finding: what you changed, what you skipped and why, and any false positives (those are bugs in the detector, worth filing).
`;
}
