import { expect, test } from 'bun:test';
import { type JudgeCache, judge } from '../src/lookout/judge';
import { isFinding, maxScore, topDimension } from '../src/policy';
import type { Classifier, Question } from '../src/sonar';
import type { Claim, PageDocument } from '../src/types';

const content = [
  '## Storage', // 1
  '', // 2
  'Read shared state with `useStorage`.', // 3
  '', // 4
  '```ts', // 5
  'const id = crypto.randomUUID();', // 6
  '```', // 7
].join('\n');

const claim = (id: string, line: number, over: Partial<Claim>): Claim => ({
  id,
  kind: 'inline',
  text: 'useStorage',
  locator: { path: 'docs/a.md', start: { line, col: 1 }, end: { line, col: 2 } },
  specRef: { export: 'useStorage' },
  ...over,
});

const page: PageDocument = {
  packageName: '@acme/live',
  path: 'docs/a.md',
  slices: [],
  claims: [
    claim('mention', 3, { kind: 'prose', candidate: true }),
    claim('again', 3, { candidate: true }),
    claim('ghost', 6, {
      kind: 'fence',
      text: 'crypto.randomUUID()',
      specRef: null,
      rule: { type: 'prose-unresolved-member', issue: 'no such member' },
    }),
    claim('gap', 1, { kind: 'gap' }),
  ],
};
const spec = {
  exports: [{ name: 'useStorage', kind: 'function', signatures: [{ parameters: [] }] }],
};

/** Answers every question with a fixed probability per id, and records what it was asked. */
function fake(answers: Record<string, number>): Classifier & { asked: Record<string, Question>[] } {
  const asked: Record<string, Question>[] = [];
  return {
    name: 'fake',
    asked,
    async evaluate(request) {
      asked.push(request.questions);
      return {
        model: 'fake-1',
        usage: { inputTokens: 100, outputTokens: 0 },
        answers: Object.fromEntries(
          Object.keys(request.questions).map((id) => [
            id,
            { type: 'noul', probability: answers[id] ?? 0 },
          ]),
        ) as never,
      };
    },
  };
}

test('one request per passage and record; rule hits and gaps are not judged', async () => {
  const classifier = fake({ about: 0.9, stale: 0.8 });
  const cache: JudgeCache = {};
  const { pages, stats } = await judge([{ page, content, spec }], classifier, cache);
  const [mention, again, ghost, gap] = pages[0].claims;

  // Two claims on one passage share a request. A rule hit is certain, and a gap is one: Jev has
  // no say on either.
  expect(stats.requests).toBe(1);
  // ...and one answer is one finding, told on the name rather than on the whole sentence.
  expect(again.jev).toEqual({ stale: 0.8, incomplete: 0, inaccurate: 0 });
  expect(mention.jev).toBeUndefined();
  expect(gap.jev).toBeUndefined();
  expect(ghost.jev).toBeUndefined();
  expect(isFinding(ghost)).toBe(true);
});

test('an unchanged page is answered from the cache', async () => {
  const cache: JudgeCache = {};
  await judge([{ page, content, spec }], fake({ about: 0.9 }), cache);
  const second = fake({ about: 0.9 });
  const { stats } = await judge([{ page, content, spec }], second, cache);
  expect(stats.requests).toBe(0);
  expect(second.asked).toHaveLength(0);
});

test('each dimension clears its own threshold', () => {
  const judged = (jev: { stale: number; incomplete: number; inaccurate: number }) =>
    ({ ...claim('x', 3, {}), jev }) as Claim & { jev: typeof jev };
  // 0.55 stale is a finding; 0.55 inaccurate is not.
  expect(isFinding(judged({ stale: 0.55, incomplete: 0, inaccurate: 0 }))).toBe(true);
  expect(isFinding(judged({ stale: 0, incomplete: 0, inaccurate: 0.55 }))).toBe(false);
  // The label follows the dimension that cleared, not merely the biggest number.
  const mixed = judged({ stale: 0.55, incomplete: 0, inaccurate: 0.65 });
  expect(topDimension(mixed)).toBe('stale');
  expect(maxScore(mixed)).toBe(0.55);
});

test('a fence does not repeat what its intro paragraph got wrong', async () => {
  const said: PageDocument = {
    ...page,
    claims: [claim('sentence', 3, {}), claim('fence', 6, { kind: 'fence', text: 'useStorage()' })],
  };
  const classifier = fake({ about: 0.9, prose: 0.9 });
  const { pages } = await judge([{ page: said, content, spec }], classifier, {});
  const [sentence, fence] = pages[0].claims;
  expect(sentence.jev).toMatchObject({ inaccurate: 0.9, reason: 'prose' });
  expect(fence.jev).toBeUndefined();

  // Something wrong IN the code is the fence's own finding.
  const called = fake({ about: 0.9, prose: 0.9, members: 0.95 });
  const again = await judge([{ page: said, content, spec }], called, {});
  expect(again.pages[0].claims[1].jev?.reason).toBe('members');
});

test('a members finding names the identifiers the record lacks; nothing else does', async () => {
  const md = ['## LiveObject', '', '`delete(key)` — remove a field:'].join('\n');
  const live = {
    exports: [
      {
        name: 'LiveObject',
        kind: 'class',
        deprecated: true,
        members: ['get', 'set'].map((name) => ({ name, kind: 'method' })),
      },
    ],
  };
  const doc: PageDocument = {
    ...page,
    claims: [claim('list', 3, { text: 'LiveObject', specRef: { export: 'LiveObject' } })],
  };
  const run = async (answers: Record<string, number>, cache: JudgeCache = {}) =>
    (await judge([{ page: doc, content: md, spec: live }], fake(answers), cache)).pages[0].claims[0]
      .jev;

  const cache: JudgeCache = {};
  const members = await run({ about: 0.9, members: 0.95 }, cache);
  expect(members).toMatchObject({ reason: 'members', names: ['delete'] });
  // Worked out from the passage at read time: never stored, so old caches stay valid and gain it.
  expect(JSON.stringify(cache)).not.toContain('delete');
  expect(await run({}, cache)).toEqual(members);

  expect((await run({ about: 0.9, prose: 0.9 }))?.reason).toBe('prose');
  expect(await run({ about: 0.9, prose: 0.9 })).not.toHaveProperty('names');
  expect(await run({ about: 0.9, declared: 0.9 })).not.toHaveProperty('names');
  expect(await run({ about: 0.9, stale: 0.9 })).toEqual({
    stale: 0.9,
    incomplete: 0,
    inaccurate: 0,
  });
});

test('names play no part in the request or its cache key', async () => {
  const md = '`delete(key)` — remove a field:';
  const live = { exports: [{ name: 'LiveObject', kind: 'class', members: [{ name: 'get' }] }] };
  const doc: PageDocument = {
    ...page,
    claims: [claim('list', 1, { text: 'LiveObject', specRef: { export: 'LiveObject' } })],
  };
  const states: unknown[] = [];
  const spy: Classifier = {
    ...fake({}),
    async evaluate(request) {
      states.push(request.state);
      return fake({ about: 0.9, members: 0.95 }).evaluate(request);
    },
  };
  await judge([{ page: doc, content: md, spec: live }], spy, {});
  expect(JSON.stringify(states)).not.toContain('names');
});

test("a member the sentence gives to another export is not this one's missing member", async () => {
  const spec = {
    exports: [
      { name: 'Registry', kind: 'interface', members: [{ name: 'languageModel', kind: 'method' }] },
      {
        name: 'Experimental_EvaluationRegistry',
        kind: 'interface',
        members: [{ name: 'evaluationModel', kind: 'method' }],
      },
    ],
  } as never;
  const content =
    '`Registry` is unchanged; use `Experimental_EvaluationRegistry` to retain its experimental `evaluationModel` method.\n';
  const page = {
    packageName: 'p',
    path: 'docs/a.md',
    slices: [],
    claims: [claim('sentence', 1, { specRef: { export: 'Registry' } })],
  };
  const classifier = fake({ about: 0.9, members: 0.9 });
  const { pages } = await judge([{ page, content, spec }], classifier, {});
  expect(pages[0].claims[0].jev?.inaccurate ?? 0).toBe(0);
});
