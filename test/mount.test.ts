import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { mount, paramsOf } from '../src/overlay';
import type { JudgedPage } from '../src/types';

/** The hard rule: Buoy measures the host's page and never touches it. */
test('mounting adds one element to <body> and changes nothing inside the article', async () => {
  document.body.innerHTML = readFileSync('test/fixtures/blume.html', 'utf8');
  const article = document.body.querySelector('article') as Element;
  const before = article.innerHTML;
  const children = document.body.children.length;

  const page: JudgedPage = {
    packageName: 'x',
    path: 'docs/providers.md',
    slices: [],
    claims: [
      {
        id: 'a',
        kind: 'fence',
        text: 'useTide(0)',
        locator: {
          path: 'docs/providers.md',
          start: { line: 1, col: 1 },
          end: { line: 1, col: 2 },
          headingId: 'the-tideprovider-convention',
        },
        specRef: null,
        rule: { type: 'prose-broken-reference', issue: 'test' },
      },
    ],
  };
  const unmount = mount({ data: [page], root: 'article' });
  await new Promise((r) => setTimeout(r, 50));

  const host = document.body.querySelector('buoy-overlay');
  expect(host?.shadowRoot?.querySelectorAll('.pin')).toHaveLength(1);
  expect(article.innerHTML).toBe(before);
  expect(document.body.children.length).toBe(children + 1);

  unmount();
  expect(document.body.querySelector('buoy-overlay')).toBeNull();
  expect(article.innerHTML).toBe(before);
});

test('a signature splits into its own parameters, whatever they contain', () => {
  const sig =
    'RoomProvider(roomId: string, opts?: { a: number, b: Map<string, number> }, cb: (x: number, y: number) => void, ...rest: array): ReactNode';
  expect(paramsOf(sig).map((p) => p.name)).toEqual(['roomId', 'opts', 'cb', 'rest']);
  expect(paramsOf(sig)[2].text).toBe('cb: (x: number, y: number) => void');
  expect(paramsOf('PresenceUser')).toEqual([]);
});
