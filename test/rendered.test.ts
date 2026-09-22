import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderedToMarkdown } from '../src/rendered';

const md = (name: string, root?: string): string => {
  const out = renderedToMarkdown(readFileSync(`test/fixtures/${name}.html`, 'utf8'), root);
  if (out === null) throw new Error(`${name}: no root`);
  return out;
};

describe('rendered page → markdown', () => {
  test('fumadocs: heading chrome dropped, shiki spans joined, language kept off when the host has none', () => {
    const out = md('fumadocs', '.prose');
    expect(out).toContain('## Usage');
    expect(out).toContain("import { readSnapshot } from '@acme/tide/snapshot';");
    expect(out).toContain('A frozen `TideSnapshot` is returned.');
  });

  test('docusaurus: <br> lines become newlines, language from the class', () => {
    const out = md('docusaurus', '.theme-doc-markdown');
    expect(out).toContain('### `harbor`');
    expect(out).toContain("```js\nexport default {\n  harbor: 'west-pier',\n};\n```");
  });

  test('mintlify: list keys keep their backticks', () => {
    expect(md('mintlify', '.mdx-content')).toContain('- `ebbRate` - Milliseconds between ebbs');
  });

  test('blume: language and title from data attributes', () => {
    expect(md('blume', 'article')).toMatch(
      /```tsx title="app\/Gauge.tsx"\nimport \{ useTide \} from "@acme\/tide";/,
    );
  });

  test('untagged <pre> is tagged ts only when it plainly is', () => {
    const html =
      '<article><pre>import { a } from "b";</pre><pre>client.leaveRoom("x"); // gone</pre><pre>bun add -D @waits/buoy</pre></article>';
    expect(renderedToMarkdown(html, 'article')).toBe(
      '```ts\nimport { a } from "b";\n```\n\n```ts\nclient.leaveRoom("x"); // gone\n```\n\n```\nbun add -D @waits/buoy\n```\n',
    );
  });

  test('no article', () => {
    expect(renderedToMarkdown('<div>nothing</div>', 'article')).toBeNull();
  });
});

describe('code blocks built from <div>s', () => {
  const block = (tag: string): string =>
    `<article><h2>Use</h2><div class="code-block"><div class="bar">app.tsx</div><${tag} class="p-4 font-mono text-sm"><div>import { createTide } from "@acme/tide";</div><div>const tide = createTide();</div></${tag}></div></article>`;
  const fence = '```ts\nimport { createTide } from "@acme/tide";\nconst tide = createTide();\n```';

  test('are read as fences, innermost block only, line per <div>', () => {
    const out = renderedToMarkdown(block('div')) ?? '';
    expect(out).toContain(fence);
    // The wrapper's filename bar is prose around the fence, not code inside it.
    expect(out).not.toContain('app.tsx\nimport');
  });

  test('read the same as the <pre> they stand in for', () => {
    expect(renderedToMarkdown(block('pre'))).toContain(fence);
  });

  test('inline code and monospace prose stay prose', () => {
    const html =
      '<article><p>Call <code class="font-mono">createTide()</code> once.</p><div class="font-mono">v1.2.0 released today</div></article>';
    expect(renderedToMarkdown(html)).not.toContain('```');
  });
});

test('a code block title in a header bar becomes the fence title', () => {
  const html =
    '<article><div class="group"><div class="flex"><div data-slot="card-title">AI SDK 5</div><button>Copy</button></div><pre><code>const a = generateText({ model });</code></pre></div></article>';
  expect(renderedToMarkdown(html)).toContain(
    '```ts title="AI SDK 5"\nconst a = generateText({ model });',
  );
});
