import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { anchorClaims } from '../src/anchor';
import { findRoot } from '../src/roots';
import type { ClaimKind, JudgedClaim } from '../src/types';

/** Fixtures are hand-written: each mirrors the DOM shape of one platform's docs page, with invented content. */
function load(name: string, rootSelector: string): Element {
  document.body.innerHTML = readFileSync(`test/fixtures/${name}.html`, 'utf8');
  const root = document.body.querySelector(rootSelector);
  if (!root) throw new Error(`${name}: no ${rootSelector}`);
  return root;
}

let line = 0;
function claim(
  kind: ClaimKind,
  text: string,
  headingId?: string,
  headingText?: string,
): JudgedClaim {
  line += 1;
  return {
    id: `docs/page.md:${kind}:X:${line}`,
    kind,
    text,
    locator: {
      path: 'docs/page.md',
      start: { line, col: 1 },
      end: { line, col: text.length },
      headingId,
      headingText,
    },
    specRef: { export: 'X' },
  };
}

const text = (range: Range): string => range.toString().replace(/\s+/g, ' ').trim();

describe('fumadocs', () => {
  const root = () => load('fumadocs', '.prose');

  test('fence text split across shiki token spans', () => {
    const { placed, unplaced } = anchorClaims(root(), [
      claim('fence', "readSnapshot('harbor-west')", 'usage'),
    ]);
    expect(unplaced).toEqual([]);
    expect(text(placed[0].range)).toBe("readSnapshot('harbor-west')");
    expect(placed[0].range.startContainer.parentElement?.closest('pre')).not.toBeNull();
  });

  test('heading wrapped in an anchor with a copy button', () => {
    const { placed } = anchorClaims(root(), [claim('heading', 'Output', 'output')]);
    expect(text(placed[0].range)).toBe('Output');
    expect(placed[0].range.startContainer.parentElement?.closest('h3')?.id).toBe('output');
  });

  test('prose source span with backticks matches rendered inline code', () => {
    const { placed } = anchorClaims(root(), [
      claim('prose', 'A frozen `TideSnapshot` is returned.', 'output'),
    ]);
    expect(text(placed[0].range)).toBe('A frozen TideSnapshot is returned.');
  });

  test('gap selects the last block of its section', () => {
    const { placed } = anchorClaims(root(), [claim('gap', 'readTide', 'output')]);
    expect(text(placed[0].range)).toBe('A frozen TideSnapshot is returned.');
  });
});

describe('docusaurus', () => {
  const root = () => load('docusaurus', '.theme-doc-markdown');

  test('heading that is inline code, with a zero-width hash link', () => {
    const { placed } = anchorClaims(root(), [claim('heading', '`harbor`', 'harbor')]);
    expect(text(placed[0].range)).toBe('harbor');
    expect(placed[0].range.startContainer.parentElement?.closest('h3')?.id).toBe('harbor');
  });

  test('prism lines separated by <br> read as whitespace', () => {
    const article = root();
    const { placed } = anchorClaims(article, [
      claim('fence', "export default {\n  harbor: 'west-pier',\n};", 'harbor'),
    ]);
    // Range#toString has no text for <br>, so compare without whitespace.
    expect(placed[0].range.toString().replace(/\s/g, '')).toBe(
      "exportdefault{harbor:'west-pier',};",
    );
    // Overview shows the same fence first; the claim's section is the one that counts.
    const pre = placed[0].range.startContainer.parentElement?.closest('pre');
    expect(pre).toBe(article.querySelectorAll('pre')[1]);
  });

  test('identical spans in one section take successive matches', () => {
    const { placed, unplaced } = anchorClaims(root(), [
      claim('fence', 'export default {', 'required-fields'),
      claim('fence', 'export default {', 'required-fields'),
    ]);
    expect(unplaced).toEqual([]);
    const [a, b] = placed.map((p) => p.range.startContainer.parentElement?.closest('pre'));
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toBe(b);
  });

  test('two rules on one source span share its place on the page', () => {
    const first = claim('fence', 'export default {', 'required-fields');
    const second = { ...first, id: `${first.id}:again` };
    const { placed, unplaced } = anchorClaims(root(), [first, second]);
    expect(unplaced).toEqual([]);
    const [a, b] = placed.map((p) => p.range);
    expect(a.startContainer).toBe(b.startContainer);
    expect(a.startOffset).toBe(b.startOffset);
  });

  test('a section stops at the next heading of its level', () => {
    const { unplaced } = anchorClaims(root(), [
      claim('fence', "endpoint: 'wss://tide.acme.example'", 'harbor'),
    ]);
    expect(unplaced).toHaveLength(1);
  });
});

describe('mintlify', () => {
  const root = () => load('mintlify', '.mdx-content');

  test('table-key lands on a list item key, not a fence', () => {
    const { placed } = anchorClaims(root(), [claim('table-key', '`ebbRate`', 'tune-with-options')]);
    expect(text(placed[0].range)).toBe('ebbRate');
    expect(placed[0].range.startContainer.parentElement?.closest('li')).not.toBeNull();
  });

  test('prose in a nested heading section', () => {
    const { placed } = anchorClaims(root(), [
      claim('prose', 'Providers accept a `scope` prop.', 'scope-a-provider-with-scope'),
    ]);
    expect(text(placed[0].range)).toBe('Providers accept a scope prop.');
  });
});

describe('blume', () => {
  const root = () => load('blume', 'article');

  test('fence inside astro-code', () => {
    const { placed } = anchorClaims(root(), [
      claim('fence', 'useTide(0)', 'the-tideprovider-convention'),
    ]);
    expect(text(placed[0].range)).toBe('useTide(0)');
  });

  test('falls back to heading text when the host slugs differently', () => {
    const { placed } = anchorClaims(root(), [
      claim('prose', 'By default a tide uses `ebb:gentle`', 'some-other-slug', 'Ebbing'),
    ]);
    expect(text(placed[0].range)).toBe('By default a tide uses ebb:gentle');
  });
});

describe('inline mentions', () => {
  test('a name that only appears on an import line lands in its fence', () => {
    const root = load('blume', 'article');
    const { placed, unplaced } = anchorClaims(root, [
      claim('inline', 'useTide', 'the-tideprovider-convention'),
    ]);
    expect(unplaced).toEqual([]);
    expect(placed[0].range.startContainer.parentElement?.closest('pre')).not.toBeNull();
  });
});

describe('unplaced', () => {
  const root = () => load('blume', 'article');

  test('text the page does not contain', () => {
    const missing = claim('fence', 'Tide.drain("nowhere")', 'ebbing');
    expect(anchorClaims(root(), [missing])).toEqual({ placed: [], unplaced: [missing] });
  });

  test('a gap with no heading on the page', () => {
    const { unplaced } = anchorClaims(root(), [claim('gap', 'execute', 'not-a-heading')]);
    expect(unplaced).toHaveLength(1);
  });

  test('prose never lands inside a fence', () => {
    const { unplaced } = anchorClaims(root(), [
      claim('prose', 'useTide(0)', 'the-tideprovider-convention'),
    ]);
    expect(unplaced).toHaveLength(1);
  });
});

test('the default root is the article itself, not the page chrome around it', () => {
  const expected: Record<string, string> = {
    fumadocs: 'prose',
    docusaurus: 'theme-doc-markdown',
    mintlify: 'mdx-content',
  };
  for (const [name, cls] of Object.entries(expected)) {
    document.body.innerHTML = readFileSync(`test/fixtures/${name}.html`, 'utf8');
    expect(findRoot<Element>(document)?.classList.contains(cls)).toBe(true);
  }
  document.body.innerHTML = readFileSync('test/fixtures/blume.html', 'utf8');
  expect(findRoot<Element>(document)?.tagName).toBe('ARTICLE');
  // A host's own selector wins.
  expect(findRoot<Element>(document, 'h1')?.tagName).toBe('H1');
});
