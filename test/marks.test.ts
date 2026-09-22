import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { anchorClaims } from '../src/anchor';
import { codeLine, fenceOf } from '../src/anchor/token';
import { toMarks } from '../src/overlay/marks';
import type { JudgedClaim } from '../src/types';

const ids = new Map<Node, number>();
const blockId = (node: Node): number => {
  if (!ids.has(node)) ids.set(node, ids.size);
  return ids.get(node) ?? 0;
};

function claim(
  id: string,
  kind: JudgedClaim['kind'],
  text: string,
  over: Partial<JudgedClaim> = {},
): JudgedClaim {
  return {
    id,
    kind,
    text,
    locator: {
      path: 'docs/page.md',
      start: { line: 1, col: 1 },
      end: { line: 1, col: 2 },
      headingId: 'ebbing',
    },
    specRef: { export: 'Tide', member: text },
    ...over,
  };
}

test("a section's gaps share one mark, whoever found them", () => {
  document.body.innerHTML = readFileSync('test/fixtures/blume.html', 'utf8');
  const root = document.body.querySelector('article') as Element;
  const rule = { type: 'spec-not-in-claims' as const, issue: 'missing' };
  const jev = {
    stale: 0,
    incomplete: 0.9,
    inaccurate: 0,
  };
  const { placed } = anchorClaims(root, [
    claim('p', 'prose', 'By default a tide uses `ebb:gentle`'),
    claim('g1', 'gap', 'ebb', { rule }),
    claim('g2', 'gap', 'flood', { rule }),
    claim('g3', 'gap', 'slack', { jev }),
  ]);
  const marks = toMarks(placed, blockId);
  expect(marks.map((m) => m.claims.map((c) => c.id))).toEqual([['p'], ['g1', 'g2', 'g3']]);

  // Dropping a member keeps the group's identity, so its popover can stay open.
  const again = toMarks(
    placed.filter((a) => a.claim.id !== 'g1'),
    blockId,
  );
  expect(again[1].id).toBe(marks[1].id);
  expect(again[1].claims.map((c) => c.id)).toEqual(['g2', 'g3']);
});

test('findings on one span share one mark, placed on the word that is wrong', () => {
  document.body.innerHTML =
    '<article><h2 id="setup">Setup</h2><pre><code>&lt;Provider serverUrl="ws://x"&gt;</code></pre><p><code>PresenceUser</code> has { userId, joinedAt }</p></article>';
  const root = document.body.querySelector('article') as Element;
  const locator = {
    path: 'docs/page.md',
    start: { line: 3, col: 1 },
    end: { line: 3, col: 30 },
    headingId: 'setup',
  };
  const tag = '<Provider serverUrl="ws://x">';
  const { placed } = anchorClaims(root, [
    claim('a', 'fence', tag, {
      locator,
      rule: { type: 'prose-unknown-key', issue: "Unknown prop 'serverUrl' on '<Provider>'" },
    }),
    claim('b', 'fence', tag, {
      locator,
      rule: {
        type: 'prose-missing-required',
        issue: "'<Provider>' is missing required prop 'client'",
      },
    }),
    claim('c', 'inline', 'PresenceUser', {
      locator: { ...locator, start: { line: 5, col: 1 }, end: { line: 5, col: 12 } },
      jev: { stale: 0, incomplete: 0, inaccurate: 0.8, reason: 'members', names: ['joinedAt'] },
    }),
  ]);
  const marks = toMarks(placed, blockId);
  expect(marks.map((m) => m.claims.map((c) => c.id))).toEqual([['a', 'b'], ['c']]);
  expect(marks.map((m) => m.token)).toEqual([true, true]);
  expect(marks[0].anchor.range.toString()).toBe('serverUrl');
  // The name the locator pointed at is not the word that is wrong; the field beside it is.
  expect(marks[1].anchor.range.toString()).toBe('joinedAt');
});

test('a finding on a heading moves to the word in its section, read from code only', () => {
  document.body.innerHTML =
    '<article><h2 id="liveobject">LiveObject</h2><p>To delete a field, use:</p><p><code>delete(key)</code> removes a field</p><h2 id="next">Next</h2><p><code>delete</code></p></article>';
  const root = document.body.querySelector('article') as Element;
  const { placed } = anchorClaims(root, [
    claim('h', 'heading', 'LiveObject', {
      locator: {
        path: 'docs/page.md',
        start: { line: 1, col: 1 },
        end: { line: 1, col: 10 },
        headingId: 'liveobject',
      },
      jev: { stale: 0, incomplete: 0, inaccurate: 0.9, reason: 'members', names: ['delete'] },
    }),
  ]);
  const [mark] = toMarks(placed, blockId);
  expect(mark.token).toBe(true);
  expect(mark.anchor.range.startContainer.parentElement?.tagName).toBe('CODE');
  expect(mark.anchor.range.startContainer.parentElement?.closest('p')?.textContent).toBe(
    'delete(key) removes a field',
  );
});

test('a line of code is the element under <code>, with or without newlines', () => {
  // Docusaurus: a div per line, no newlines.
  document.body.innerHTML =
    '<pre><code><div class="token-line"><span>import x</span></div><div class="token-line"><span>&lt;Provider </span><span id="t">serverUrl</span><span>&gt;</span></div></code></pre>';
  const pre = document.querySelector('pre') as Element;
  const word = (document.getElementById('t') as Element).firstChild as Node;
  expect(codeLine(word, pre)?.textContent).toBe('<Provider serverUrl>');

  // A plain fence has no line elements: the caller falls back to newlines.
  document.body.innerHTML = '<pre><code>a\nb</code></pre>';
  const plain = document.querySelector('pre') as Element;
  expect(codeLine(plain.querySelector('code')?.firstChild as Node, plain)).toBeNull();
});

test('a code block built from <div>s is a fence: findings land in it, on the word, by its line', () => {
  document.body.innerHTML =
    '<article><h2 id="wrap">Wrap your app</h2><p>Use <code>serverUrl</code> when self-hosting.</p>' +
    '<div class="code-block"><div class="bar">app.tsx</div><div class="p-4 font-mono text-sm">' +
    '<div>import { TideProvider } from "@acme/tide";</div><div>&lt;TideProvider <span>serverUrl</span>="wss://x"&gt;</div>' +
    '</div></div><div class="font-mono">v1.2.0 released today</div></article>';
  const root = document.body.querySelector('article') as Element;
  const block = root.querySelector('.font-mono') as Element;
  expect(fenceOf(block.querySelector('span'))).toBe(block);
  // Monospace prose and the wrapper with its filename bar are not code.
  expect(fenceOf(root.querySelectorAll('.font-mono')[1])).toBeNull();
  expect(fenceOf(root.querySelector('.bar'))).toBeNull();

  const { placed, unplaced } = anchorClaims(root, [
    claim('f', 'fence', '<TideProvider serverUrl="wss://x">', {
      locator: {
        path: 'docs/page.md',
        start: { line: 5, col: 1 },
        end: { line: 5, col: 30 },
        headingId: 'wrap',
      },
      rule: { type: 'prose-unknown-key', issue: "Unknown prop 'serverUrl' on '<TideProvider>'" },
    }),
  ]);
  expect(unplaced).toHaveLength(0);
  const [mark] = toMarks(placed, blockId);
  // In the block, not on the same word in the paragraph above it.
  expect(fenceOf(mark.anchor.range.startContainer)).toBe(block);
  expect(mark.anchor.range.toString()).toBe('serverUrl');
  expect(codeLine(mark.anchor.range.startContainer, block)?.textContent).toBe(
    '<TideProvider serverUrl="wss://x">',
  );
});
