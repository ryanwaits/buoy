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

  test('blume: language from data-language', () => {
    expect(md('blume', 'article')).toMatch(/```tsx\nimport \{ useTide \} from "@acme\/tide";/);
  });

  test('untagged <pre> is tagged ts only when it plainly is', () => {
    const html =
      '<article><pre>import { a } from "b";</pre><pre>client.leaveRoom("x"); // gone</pre><pre>bun add -D @driftdev/buoy</pre></article>';
    expect(renderedToMarkdown(html, 'article')).toBe(
      '```ts\nimport { a } from "b";\n```\n\n```ts\nclient.leaveRoom("x"); // gone\n```\n\n```\nbun add -D @driftdev/buoy\n```\n',
    );
  });

  test('no article', () => {
    expect(renderedToMarkdown('<div>nothing</div>', 'article')).toBeNull();
  });
});
