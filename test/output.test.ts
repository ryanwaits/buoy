import { expect, test } from 'bun:test';
import { offending, sentence, toPrompt } from '../src/output';
import { isHidden, issueCount, kindOf } from '../src/policy';
import type { JudgedClaim, JudgedPage } from '../src/types';

const claim = (over: Partial<JudgedClaim>): JudgedClaim => ({
  id: 'x',
  kind: 'fence',
  text: 'useLiveCursor',
  locator: {
    path: 'docs/hooks.md',
    start: { line: 12, col: 1 },
    end: { line: 12, col: 14 },
    headingText: 'Providers',
  },
  specRef: null,
  ...over,
});

const page = (claims: JudgedClaim[], mode: 'markdown' | 'rendered'): JudgedPage => ({
  packageName: '@waits/lively-react',
  path: mode === 'rendered' ? '/docs/react' : 'docs/hooks.md',
  claims,
  slices: [{ export: 'Simnet', member: 'execute', signature: 'execute(snippet: string)' }],
  source: { mode, entry: 'packages/react/src/index.ts' },
});

test('rule finding: issue, hint, how to verify, decision, source line', () => {
  const c = claim({
    rule: {
      type: 'prose-broken-reference',
      issue: "Import 'useLiveCursor' does not exist",
      suggestion: "Did you mean 'useUpdateCursor'?",
    },
  });
  const out = toPrompt(
    [page([c], 'markdown')],
    new Set([c]),
    { x: 'renamed in 0.2' },
    '/docs/react',
  );
  expect(out).toContain('# Fix docs drift on /docs/react');
  expect(out).toContain('### `docs/hooks.md`');
  expect(out).toContain(
    '1. **Rule `prose-broken-reference`** · fence · line 12 · under "Providers"',
  );
  expect(out).toContain("Detector hint: Did you mean 'useUpdateCursor'?");
  expect(out).toContain('Verify: `npx @driftdev/cli list packages/react/src/index.ts`');
  expect(out).toContain('Decision: renamed in 0.2');
  expect(out).toContain('## Decisions');
  expect(out).toContain('→ renamed in 0.2');
  expect(out).toContain('Edit docs only');
});

test('Jev finding on a rendered page: probability wording, replacement spec, no fake line number', () => {
  const c = claim({
    kind: 'prose',
    text: 'Use `runSnippet` to execute code',
    specRef: { export: 'Simnet', member: 'runSnippet', deprecated: true, replacement: 'execute' },
    jev: { stale: 0.86, incomplete: 0.3, inaccurate: 0.4 },
  });
  const out = toPrompt([page([c], 'rendered')], new Set([c]), {}, '/docs/react');
  expect(out).toContain('**Jev, 86% likely stale** · prose · under "Providers"');
  expect(out).not.toContain('line 12');
  expect(out).toContain('Spec: `execute(snippet: string)`');
  expect(out).toContain('Verify: `npx @driftdev/cli get packages/react/src/index.ts Simnet`');
  expect(out).toContain('searching the repo for the quoted text');
});

test('only the findings handed in are listed', () => {
  const kept = claim({ id: 'a', rule: { type: 'key-gap', issue: 'kept' } });
  const dismissed = claim({ id: 'b', rule: { type: 'key-gap', issue: 'dismissed' } });
  const out = toPrompt([page([kept, dismissed], 'markdown')], new Set([kept]), {}, '/docs');
  expect(out).toContain('kept');
  expect(out).not.toContain('Issue: dismissed');
  expect(out).toContain('pinned 1 finding on');
  expect(out).not.toContain('## Decisions');
});

test('decisions lead; not-a-problem is left out; a bare resolve reads as "fix it"', () => {
  const real = claim({ id: 'a', rule: { type: 'key-gap', issue: 'real one' } });
  const bare = claim({ id: 'b', rule: { type: 'key-gap', issue: 'bare one' } });
  const nope = claim({ id: 'c', rule: { type: 'key-gap', issue: 'not one' } });
  const fresh = claim({ id: 'd', rule: { type: 'key-gap', issue: 'fresh one' } });
  const all = [real, bare, nope, fresh];
  const out = toPrompt(
    [page(all, 'markdown')],
    new Set(all),
    { a: 'prose in this section needs a rewrite', b: '', c: null },
    '/docs',
  );
  expect(out.indexOf('## Decisions')).toBeLessThan(out.indexOf('## Ground rules'));
  expect(out).toContain('resolved 2 of these');
  expect(out).toContain('→ prose in this section needs a rewrite');
  expect(out).toContain('→ Real. Fix it.');
  expect(out).toContain('Decision: Real. Fix it.');
  expect(out).not.toContain('not one');
  expect(out).toContain('Issue: fresh one');
  expect(out).toContain('pinned 3 findings on');
});

const members = claim({
  kind: 'inline',
  text: 'LiveObject',
  specRef: { export: 'LiveObject' },
  jev: { stale: 0, incomplete: 0, inaccurate: 0.95, reason: 'members', names: ['delete'] },
});
const unknownProp = claim({
  specRef: { export: 'LivelyProvider' },
  rule: { type: 'prose-unknown-key', issue: "Unknown prop 'serverUrl' on '<LivelyProvider>'" },
});

test('the sentence names the word that is wrong, and tells a call from a field', () => {
  expect(sentence(members, '`delete(key)` removes a field')).toBe(
    '`delete` is not a method of LiveObject.',
  );
  expect(sentence(members, '{ id, delete }')).toBe('`delete` is not a field of LiveObject.');
  expect(sentence(unknownProp)).toBe('Unknown prop `serverUrl` on `<LivelyProvider>`');
  expect(offending(members)).toEqual(['delete']);
  expect(offending(unknownProp)).toEqual(['serverUrl', 'LivelyProvider']);
});

test('the same issue in two places is one decision; the filter hides by evidence or kind', () => {
  const again = { ...unknownProp, id: 'y' };
  expect(issueCount([unknownProp, again, members])).toBe(2);
  expect(kindOf(unknownProp)).toBe('args');
  expect(kindOf(members)).toBe('says');
  expect(isHidden(members, new Set(['likely']))).toBe(true);
  expect(isHidden(unknownProp, new Set(['likely', 'says']))).toBe(false);
  expect(isHidden(unknownProp, new Set(['args']))).toBe(true);
});

test('a gap says what kind of member is missing, and tells it from an option key of the same name', () => {
  const gap = claim({
    kind: 'gap',
    text: 'port',
    specRef: { export: 'LivelyServer', member: 'port' },
    rule: {
      type: 'spec-not-in-claims',
      issue: "Spec member 'LivelyServer.port' is not mentioned on this page",
    },
  });
  expect(sentence(gap)).toBe(
    '`LivelyServer.port` is in the spec, but this page never documents it.',
  );
  expect(sentence(gap, 'const s = new LivelyServer({ port: 1999 });', 'getter')).toBe(
    '`LivelyServer` has a `port` getter this page never documents. The `port:` on this page is an option key, not the getter.',
  );
  expect(sentence(gap, 'no key here', 'method')).toBe(
    '`LivelyServer` has a `port()` method this page never documents.',
  );
});
