import { expect, test } from 'bun:test';
import type { OpenPkgSpec } from '../src/lookout/evidence';
import { checkSection, factsOf, readPage, roleProofs, splitSections, windowsOf } from '../src/read';
import type { Classifier } from '../src/sonar';

const spec: OpenPkgSpec = {
  exports: [
    {
      name: 'useChat',
      kind: 'function',
      description: 'React hook for a chat session.',
      signatures: [
        {
          parameters: [
            {
              name: 'options',
              required: true,
              'x-ts-destructured': true,
              schema: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  messages: { type: 'array' },
                  onData: {},
                },
                required: ['id'],
              },
            },
          ],
        },
      ],
    },
    {
      name: 'generateText',
      kind: 'function',
      description: 'Generate text and call tools for a given prompt.',
      signatures: [
        {
          parameters: [
            {
              name: 'options',
              required: true,
              'x-ts-destructured': true,
              schema: {
                type: 'object',
                properties: {
                  model: { type: 'string' },
                  prompt: { type: 'string' },
                  messages: { type: 'array' },
                  tools: { type: 'object' },
                  onStepEnd: {},
                },
                required: ['model'],
                anyOf: [{ required: ['prompt'] }, { required: ['messages'] }],
              },
            },
          ],
        },
      ],
    },
    {
      name: 'empty',
      kind: 'function',
      description: 'Creates an empty validation action.',
      signatures: [
        {
          parameters: [{ name: 'message', required: false, schema: { type: 'string' } }],
        },
      ],
    },
    {
      name: 'create',
      kind: 'function',
      description: 'Creates a store.',
      signatures: [{ parameters: [] }],
    },
    {
      name: 'cuid',
      kind: 'function',
      deprecated: true,
      description: 'CUID v1 is deprecated. Use cuid2 instead.',
      signatures: [{ parameters: [] }],
    },
    {
      name: 'PresenceUser',
      kind: 'interface',
      description: 'The user record on a presence list.',
      members: [{ name: 'userId' }, { name: 'displayName' }, { name: 'connectedAt' }],
    },
  ],
};

const section = (text: string) => splitSections(text)[0];
const fact = (name: string) => factsOf(spec).get(name)!;

const proved = (
  name: string,
  text: string,
  options: Record<string, number>,
  members: Record<string, number> = {},
  omits: Record<string, number> = {},
) => roleProofs(fact(name), section(text), options, members, omits).map((hit) => hit.issue);

test('a heading section is one slice, and a fence title can mark it as the old version', () => {
  const [first, second] = splitSections('# Use\n\nCall it.\n\n## Before\n\nold\n');
  expect(first.heading).toBe('Use');
  expect(second.heading).toBe('Before');
  expect(second.older).toBe(true);
  const titled = splitSections('```ts title="AI SDK 4.0"\ngenerateObject()\n```\n');
  expect(titled[0].older).toBe(true);
});

test('a fence is judged only against names that appear in it', () => {
  const [sec] = splitSections(`# Hooks

\`\`\`ts
const count = useStorage(root => root.get("count"));
\`\`\`

\`\`\`ts
const settings = useObject("settings");
\`\`\`
`);
  const wins = windowsOf(sec);
  expect(wins.length).toBe(2);
  expect(wins[0].text).toContain('useStorage');
  expect(wins[0].text.includes('useObject')).toBe(false);
  expect(wins[1].text).toContain('useObject');
});

test('the scanner itself does not decide that a word is an API claim', () => {
  const noisy = factsOf({
    exports: [
      {
        name: 'WebSocket',
        kind: 'class',
        signatures: [{ parameters: [{ name: 'url', required: true, schema: { type: 'string' } }] }],
        members: [{ name: 'send' }],
      },
      {
        name: 'LiveObject',
        kind: 'class',
        members: [{ name: 'get' }, { name: 'set' }],
      },
      {
        name: 'generateKeyBetween',
        kind: 'function',
        signatures: [
          {
            parameters: [
              { name: 'a', required: false },
              { name: 'b', required: false },
            ],
          },
        ],
      },
    ],
  });
  const samples = [
    '// open WebSocket (called automatically by joinRoom)',
    'const shape = new LiveObject({ name: "Untitled", x: 1, y: 2 });',
    'const between = generateKeyBetween(first, after);',
  ];
  for (const sample of samples) {
    expect(checkSection(section(sample), noisy).hits).toEqual([]);
  }
});

test('a sure option that the record lacks is a proof, and a low score is not', () => {
  const text = "useChat({ api: '/api/chat', onData() {} })";
  expect(proved('useChat', text, { api: 0.95 })).toContain("'api' is not part of 'useChat'");
  expect(proved('useChat', text, { api: 0.4 })).toEqual([]);
});

test('comment words and example values stay quiet when those scores are low', () => {
  expect(
    proved('useChat', '// open WebSocket (called automatically by joinRoom)', {
      called: 0.1,
      automatically: 0.05,
      by: 0.05,
      joinRoom: 0.1,
    }),
  ).toEqual([]);
  expect(
    proved(
      'useChat',
      'new LiveObject({ name: "Untitled", x: 1, y: 2 })',
      {},
      { name: 0.2, x: 0.2, y: 0.2 },
    ),
  ).toEqual([]);
  expect(
    proved('useChat', 'generateKeyBetween(first, after)', { first: 0.2, after: 0.15 }),
  ).toEqual([]);
});

test('a required argument is a proof when the omit score is high', () => {
  const text = 'generateText({ model, tools, onStepEnd() {} })';
  expect(proved('generateText', text, {}, {}, { one_of: 0.9 }).join('\n')).toContain(
    'needs one of',
  );
  expect(proved('generateText', text, {}, {}, { one_of: 0.1 })).toEqual([]);
  expect(proved('useChat', 'useChat({ onData() {} })', {}, {}, { id: 0.9 })).toContain(
    "Call 'useChat' is missing required argument 'id'",
  );
  expect(proved('useChat', 'useChat({ id })', {}, {}, { id: 0.1 })).toEqual([]);
});

test('a member the type is said to have, and does not, is a proof', () => {
  expect(
    proved(
      'PresenceUser',
      'PresenceUser — { userId, displayName, joinedAt }',
      {},
      { joinedAt: 0.92 },
    ),
  ).toEqual(["'joinedAt' is not part of 'PresenceUser'"]);
});

test('a deprecated export taught as current is a proof, and an older-version label is not', () => {
  const hit = (text: string) =>
    checkSection(section(text), factsOf(spec)).hits.map((item) => item.issue);
  expect(hit('String formats:\nz.cuid();\nz.cuid2();')).toContain(
    "'cuid' is deprecated, and this still teaches it as current",
  );
  expect(hit('```ts title="AI SDK 4.0"\nz.cuid();\n```')).toEqual([]);
  expect(hit('z.cuid() is deprecated. Use cuid2.')).toEqual([]);
});

test('a behaviour contradiction is the only question sent to Jev', async () => {
  let asked = 0;
  const classifier = {
    name: 'fake',
    async evaluate(request: { state: unknown }) {
      asked++;
      const section = String((request.state as { section: string }).section);
      const contradicts = section.includes('Maps and Sets are always drafted');
      return {
        model: 'fake',
        usage: { inputTokens: 10, outputTokens: 0 },
        answers: {
          about_produce: { type: 'noul' as const, probability: 0.95 },
          relation: {
            type: 'choice' as const,
            choice: contradicts ? 'contradicts' : 'says_nothing',
            probabilities: contradicts
              ? { contradicts: 0.96, matches: 0.02, says_nothing: 0.02 }
              : { contradicts: 0.05, matches: 0.05, says_nothing: 0.9 },
          },
        },
      };
    },
  } as Classifier;
  const page = [
    '# produce',
    '',
    'Only plain objects and arrays are drafted.',
    '',
    'Plain objects, arrays, Maps and Sets are always drafted by Immer.',
    '',
  ].join('\n');
  const specWith = {
    ...spec,
    exports: [
      ...spec.exports,
      {
        name: 'produce',
        kind: 'function',
        description:
          'Only plain objects and arrays are made mutable. All other objects are uncopyable.',
        signatures: [{ parameters: [] }],
      },
    ],
  };
  const cache = {};
  const first = await readPage('docs.md', page, [specWith], [], classifier, cache);
  expect(asked).toBeGreaterThan(0);
  expect(
    first.claims.some((claim) => claim.kind === 'prose' && claim.jev?.reason === 'prose'),
  ).toBe(true);
  const again = await readPage('docs.md', page, [specWith], [], classifier, cache);
  expect(again.stats.cached).toBe(asked);
});
