import { expect, test } from 'bun:test';
import type { OpenPkgSpec } from '../src/lookout/evidence';
import { checkSection, factsOf, readPage, splitSections } from '../src/read';
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

const issues = (text: string, from = ['ai']): string[] =>
  checkSection(splitSections(text)[0], factsOf(spec), from).hits.map((hit) => hit.issue);

test('a heading section is one slice, and a fence title can mark it as the old version', () => {
  const [first, second] = splitSections('# Use\n\nCall it.\n\n## Before\n\nold\n');
  expect(first.heading).toBe('Use');
  expect(second.heading).toBe('Before');
  expect(second.older).toBe(true);
  const titled = splitSections('```ts title="AI SDK 4.0"\ngenerateObject()\n```\n');
  expect(titled[0].older).toBe(true);
});

test('an option the record does not have is a proof', () => {
  expect(
    issues("const { messages } = useChat({\n  api: '/api/chat',\n  onData() {},\n});"),
  ).toContain("'api' is not an option of 'useChat'");
});

test('a call that drops a required argument, or one of a required pair, is a proof', () => {
  const found = issues(`const result = await generateText({
  model: 'x',
  tools: {},
  onStepEnd() {},
});`);
  expect(found.some((issue) => issue.includes('needs one of'))).toBe(true);
  expect(found.some((issue) => issue.includes('missing required'))).toBe(false);
});

test('a required argument that is present is quiet, and an elided call is not missing it', () => {
  expect(
    issues("const chat = useChat({ id: 'inbox', messages });").some((issue) =>
      issue.includes('missing required'),
    ),
  ).toBe(false);
  expect(
    issues('const chat = useChat({ ...rest });').some((issue) =>
      issue.includes('missing required'),
    ),
  ).toBe(false);
});

test('a positional name the signature does not have is a proof', () => {
  expect(issues('const Action = empty(requirement, message);')).toContain(
    "'requirement' is not a parameter of 'empty'",
  );
});

test('an import rename written with a colon flags the name that is not exported', () => {
  expect(issues("import { create: actualCreate } from 'zustand'", ['zustand'])).toContain(
    "Import 'actualCreate' is not exported",
  );
  expect(issues("import { create as actualCreate } from 'zustand'", ['zustand'])).toEqual([]);
});

test('a shape in a sentence flags a member the record does not have', () => {
  expect(issues('PresenceUser — { userId, displayName, onlineStatus, joinedAt }')).toContain(
    "'joinedAt' is not a member of 'PresenceUser'",
  );
  expect(issues('PresenceUser — { userId, displayName, connectedAt }')).toEqual([]);
});

test('a deprecated export taught as current is a proof, and an older-version label is not', () => {
  expect(issues('String formats:\nz.cuid();\nz.cuid2();')).toContain(
    "'cuid' is deprecated, and this still teaches it as current",
  );
  expect(issues('```ts title="AI SDK 4.0"\nz.cuid();\n```')).toEqual([]);
  expect(issues('z.cuid() is deprecated. Use cuid2.')).toEqual([]);
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
  expect(asked).toBe(1);
  expect(
    first.claims.some((claim) => claim.kind === 'prose' && claim.jev?.reason === 'prose'),
  ).toBe(true);
  const again = await readPage('docs.md', page, [specWith], [], classifier, cache);
  expect(again.stats.cached).toBe(1);
  expect(asked).toBe(1);
});
