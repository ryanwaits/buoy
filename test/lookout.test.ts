import { expect, test } from 'bun:test';
import {
  checkableUse,
  type OpenPkgSpec,
  passageAt,
  renderType,
  showsUse,
  specRecord,
  unknownMembers,
} from '../src/lookout/evidence';
import { combine } from '../src/lookout/rubric';

const MD = [
  '# Storage', // 1
  '', // 2
  'Read shared state with `useStorage`.', // 3
  'It returns `null` while loading.', // 4
  '', // 5
  '```tsx', // 6
  'const count = useStorage((root) => root.get("count"));', // 7
  '```', // 8
  '', // 9
  '## `useMutation`', // 10
  '', // 11
  'Writes go through a mutation.', // 12
  '', // 13
  '## Next', // 14
].join('\n');

test('a prose line brings its paragraph', () => {
  expect(passageAt(MD, 4)).toBe(
    'Read shared state with `useStorage`.\nIt returns `null` while loading.',
  );
});

test('a fence brings the paragraph that introduces it', () => {
  expect(passageAt(MD, 7)).toBe(
    'Read shared state with `useStorage`.\nIt returns `null` while loading.\n\n```tsx\nconst count = useStorage((root) => root.get("count"));\n```',
  );
});

test('a heading brings the section it opens, up to the next heading', () => {
  expect(passageAt(MD, 10)).toBe('## `useMutation`\n\nWrites go through a mutation.');
});

test('spec record: real types, referenced shapes, deprecation', () => {
  const spec = {
    exports: [],
    types: [
      {
        name: 'JoinOptions',
        schema: {
          type: 'object',
          properties: { userId: { type: 'string' }, token: { type: 'string' } },
          required: ['userId'],
        },
      },
    ],
  };
  const record = specRecord(spec, {
    name: 'joinRoom',
    kind: 'function',
    description: 'Connects to a room.',
    tags: [
      { name: 'param', param: { name: 'roomId', description: 'Room to join' } },
      { name: 'deprecated', text: 'Use enterRoom' },
    ],
    signatures: [
      {
        parameters: [
          { name: 'roomId', schema: { type: 'string' }, required: true },
          { name: 'options', schema: { $ref: '#/types/JoinOptions' }, required: false },
        ],
        returns: { schema: { $ref: '#/types/Room' } },
      },
    ],
  });
  expect(record).toEqual({
    name: 'joinRoom',
    kind: 'function',
    signature: 'joinRoom(roomId: string, options?: JoinOptions): Room',
    description: 'Connects to a room.',
    parameters: [
      { name: 'roomId', type: 'string', required: true, description: 'Room to join' },
      { name: 'options', type: 'JoinOptions', required: false },
    ],
    returns: 'Room',
    types: { JoinOptions: '{ userId: string; token?: string }' },
    deprecated: true,
    replacement: 'Use enterRoom',
  });
});

test('a class record lists public members; a member gets its own record', () => {
  const entry = {
    name: 'Client',
    kind: 'class',
    members: [
      {
        name: 'leave',
        kind: 'method',
        signatures: [{ parameters: [{ name: 'id', schema: { type: 'string' } }] }],
      },
      { name: '_socket', schema: { type: 'object' } },
    ],
  };
  expect(specRecord({ exports: [] }, entry).members).toEqual(['leave(id: string)']);
  expect(specRecord({ exports: [] }, entry, 'leave')).toEqual({
    name: 'Client.leave',
    kind: 'method',
    signature: 'leave(id: string)',
    parameters: [{ name: 'id', type: 'string', required: true }],
  });
});

test('function-typed parameters read as TypeScript', () => {
  const seen = new Set<string>();
  const fn = {
    'x-ts-function': true,
    'x-ts-signatures': [
      {
        parameters: [{ name: 'root', schema: { $ref: '#/types/LiveObject' } }],
        returns: { schema: { 'x-ts-type': 'T' } },
      },
    ],
  };
  expect(renderType(fn, seen)).toBe('(root: LiveObject) => T');
  const rest = {
    'x-ts-function': true,
    'x-ts-signatures': [
      {
        parameters: [{ name: 'arg', rest: true, required: false, schema: { 'x-ts-type': 'Args' } }],
        returns: { schema: { 'x-ts-type': 'Result' } },
      },
    ],
  };
  expect(renderType(rest, new Set())).toBe('(...arg: Args) => Result');
  expect([...seen]).toEqual(['LiveObject']);
});

const answers = {
  about: 0.9,
  counter: 0.1,
  stale: 0.9,
  incomplete: 0.8,
  setup: 0.1,
  prose: 0.6,
  declared: 0.2,
  members: 0.2,
};

test('inaccuracy is the question furthest over its own cut', () => {
  // declared 0.75 is the higher score, but it has not cleared its 0.8; members 0.72 cleared 0.7.
  expect(combine({ ...answers, declared: 0.75, members: 0.72 }, 'whole')).toMatchObject({
    inaccurate: 0.72,
    reason: 'members',
  });
});

test('a passage that shows no call cannot be incomplete', () => {
  expect(combine(answers, null)).toMatchObject({
    incomplete: 0,
    inaccurate: 0.6,
    reason: 'prose',
  });
  expect(combine(answers, null).stale).toBe(0.9);
});

test('a lone opening tag cannot leave a prop out', () => {
  expect(combine(answers, 'fragment').incomplete).toBe(0);
  expect(combine(answers, 'whole').incomplete).toBe(0.8);
});

test('code shown as what not to write cannot be wrong by accident', () => {
  const broken = { ...answers, counter: 0.8, members: 0.9, prose: 0.75 };
  expect(combine(broken, 'whole')).toMatchObject({
    incomplete: 0,
    inaccurate: 0.75,
    reason: 'prose',
  });
  expect(combine({ ...broken, counter: 0.2 }, 'whole').incomplete).toBe(0.8);
});

test('on an overloaded export a missing parameter counts only when Jev is sure', () => {
  const hedged = { ...answers, incomplete: 0.56 };
  expect(combine(hedged, 'whole', true).incomplete).toBe(0);
  expect(combine(hedged, 'whole', false).incomplete).toBe(0.56);
  expect(combine({ ...answers, incomplete: 0.8 }, 'whole', true).incomplete).toBe(0.8);
});

test('a broken setup requirement counts only when Jev is sure of it', () => {
  const quiet = { ...answers, incomplete: 0.1 };
  expect(combine({ ...quiet, setup: 0.54 }, 'whole').incomplete).toBe(0.1);
  expect(combine({ ...quiet, setup: 0.82 }, 'whole').incomplete).toBe(0.82);
});

test('a passage that is not about the export cannot be inaccurate about it', () => {
  expect(combine({ ...answers, about: 0.1 }, 'whole')).toMatchObject({ inaccurate: 0, stale: 0.9 });
});

test('what a passage says in words needs it to be about the export, not just to touch it', () => {
  const said = { ...answers, prose: 0.75, members: 0.85 };
  expect(combine({ ...said, about: 0.35 }, 'whole')).toMatchObject({
    inaccurate: 0.85,
    reason: 'members',
  });
  expect(combine({ ...said, about: 0.35, members: 0.1 }, 'whole').inaccurate).toBeLessThan(0.7);
  expect(combine({ ...said, about: 0.6, members: 0.1 }, 'whole')).toMatchObject({
    inaccurate: 0.75,
    reason: 'prose',
  });
});

test('showsUse: calls, constructors, generics, JSX and member calls, not mentions', () => {
  expect(showsUse('const room = useRoom();', 'useRoom')).toBe('whole');
  expect(showsUse('const x = useStorage<number>((r) => r)', 'useStorage')).toBe('whole');
  expect(showsUse('new LivelyClient({ serverUrl })', 'LivelyClient')).toBe('whole');
  expect(showsUse('<RoomProvider roomId="a">\n  <App />\n</RoomProvider>', 'RoomProvider')).toBe(
    'whole',
  );
  expect(showsUse('<Cursor x={1} />', 'Cursor')).toBe('whole');
  expect(showsUse('client.joinRoom("a")', 'LivelyClient.joinRoom')).toBe('whole');
  expect(showsUse('Use `useRoom` when you need the room.', 'useRoom')).toBeNull();
  expect(showsUse('import { useRoom } from "x";', 'useRoom')).toBeNull();
  expect(showsUse('obj.useRoom()', 'useRoom')).toBeNull();
  expect(showsUse('Filter with `useSelf()` if you only want others.', 'useSelf')).toBeNull();
  expect(showsUse('```ts\nconst me = useSelf();\n```', 'useSelf')).toBe('whole');
  expect(showsUse('Start with `LiveMap<LiveObject>` for collections.', 'LiveObject')).toBeNull();
  expect(showsUse('Wrap your app in `<LivelyProvider>` first.', 'LivelyProvider')).toBeNull();
  expect(showsUse('Use `<RoomProvider roomId="a">` per room.', 'RoomProvider')).toBe('fragment');
  expect(showsUse('```ts\nconst del = useMutation(/* ... */);\n```', 'useMutation')).toBeNull();
  expect(showsUse('```ts\nconst del = useMutation(...);\n```', 'useMutation')).toBeNull();
});

test('a component exposes props, and an unresolved type stays silent', () => {
  const provider = specRecord(
    { exports: [] },
    {
      name: 'RoomProvider',
      kind: 'function',
      signatures: [
        {
          parameters: [
            { name: 'roomId', schema: { type: 'string' }, required: true },
            { name: 'token', schema: { type: 'string' }, required: false },
          ],
          returns: { schema: { $ref: '#/types/ReactNode' } },
        },
      ],
    },
  );
  expect(provider.kind).toBe('React component');
  expect(provider.signature).toBe('<RoomProvider roomId token? />');
  expect(provider.props?.map((p) => p.name)).toEqual(['roomId', 'token']);
  expect(provider.parameters).toBeUndefined();

  const hook = specRecord(
    { exports: [] },
    {
      name: 'useMap',
      kind: 'function',
      signatures: [{ parameters: [], returns: { schema: { 'x-ts-type': 'unknown' } } }],
    },
  );
  expect(hook).toEqual({ name: 'useMap', kind: 'function', signature: 'useMap()' });
});

test('a table row is judged with its header, not with the rows about other exports', () => {
  const table = [
    'Intro.',
    '',
    '| Key | Type |',
    '|-----|------|',
    '| `useRoom` | `() => Room` |',
    '| `useCursors` | `() => CursorData[]` |',
  ].join('\n');
  expect(passageAt(table, 6)).toBe(
    '| Key | Type |\n|-----|------|\n| `useCursors` | `() => CursorData[]` |',
  );
  expect(passageAt(table, 3)).toBe('| Key | Type |');
});

test('type arguments survive rendering', () => {
  const seen = new Set<string>();
  const map = {
    type: 'object',
    'x-ts-type': 'Map',
    'x-ts-type-arguments': [{ type: 'string' }, { $ref: '#/types/CursorData' }],
  };
  expect(renderType(map, seen)).toBe('Map<string, CursorData>');
  const ref = { $ref: '#/types/LiveList', 'x-ts-type-arguments': [{ 'x-ts-type': 'T' }] };
  expect(renderType(ref, seen)).toBe('LiveList<T>');
  expect([...seen].sort()).toEqual(['CursorData', 'LiveList']);
  expect(renderType({}, seen)).toBe('unknown');
});

test('overloads are all shown, and a long deprecation note is cut to its first sentence', () => {
  const record = specRecord(
    { exports: [] },
    {
      name: 'useStore',
      kind: 'function',
      tags: [
        {
          name: 'deprecated',
          text: 'Use `useStoreWithEqualityFn` instead. It will be removed in v6.\n\nLong story.',
        },
      ],
      signatures: [
        { parameters: [{ name: 'api', schema: { type: 'object' } }] },
        {
          parameters: [
            { name: 'api', schema: { type: 'object' } },
            { name: 'selector', schema: { 'x-ts-function': true } },
          ],
        },
      ],
    },
  );
  expect(record.overloads).toEqual([
    'useStore(api: object)',
    'useStore(api: object, selector: unknown)',
  ]);
  expect(record.signature).toBeUndefined();
  expect(record.parameters).toBeUndefined();
  expect(record.replacement).toBe('Use `useStoreWithEqualityFn` instead.');
});

test('a type only a later overload mentions is still spelled out', () => {
  const options = { $ref: '#/types/JsonStorageOptions' };
  const record = specRecord(
    {
      exports: [],
      types: [
        {
          name: 'JsonStorageOptions',
          schema: { type: 'object', properties: { reviver: { 'x-ts-function': true } } },
        },
      ],
    },
    {
      name: 'createJSONStorage',
      kind: 'function',
      signatures: [
        { parameters: [] },
        { parameters: [{ name: 'options', required: false, schema: options }] },
      ],
    },
  );
  expect(Object.keys(record.types ?? {})).toEqual(['JsonStorageOptions']);
});

test('a parameter default, a written utility type and a readonly array reach the record', () => {
  const record = specRecord(
    { exports: [] },
    {
      name: 'useThing',
      kind: 'function',
      signatures: [
        {
          parameters: [
            { name: 'delay', required: false, default: 50, schema: { type: 'number' } },
            { name: 'base', required: false, default: '{} as T', schema: { 'x-ts-type': 'T' } },
          ],
          returns: {
            schema: { type: 'array', 'x-ts-readonly': true, items: { 'x-ts-type': 'T' } },
          },
        },
      ],
    },
  );
  expect(record.parameters?.map((p) => p.default)).toEqual(['50', '{} as T']);
  expect(record.returns).toBe('readonly T[]');
  expect(renderType({ 'x-ts-type': 'Readonly<T>' }, new Set())).toBe('Readonly<T>');
});

test('a record with no signature cannot be checked against a call', () => {
  const passage = '`setAutoFreeze(true / false)` turns this on or off.';
  expect(checkableUse(passage, { name: 'setAutoFreeze', kind: 'variable' })).toBeNull();
  expect(
    checkableUse(passage, {
      name: 'setAutoFreeze',
      kind: 'function',
      signature: 'setAutoFreeze(on: boolean)',
    }),
  ).toBe('whole');
});

test('a default export goes by its local name, and a rest parameter reads as one', () => {
  const record = specRecord(
    { exports: [] },
    {
      name: 'default',
      localName: 'useSWR',
      kind: 'function',
      signatures: [
        {
          parameters: [
            { name: 'key', schema: { type: 'string' } },
            { name: 'args', rest: true, required: false, schema: { type: 'array', items: {} } },
          ],
        },
      ],
    },
  );
  expect(record.name).toBe('useSWR');
  expect(record.signature).toBe('useSWR(key: string, ...args: unknown[])');
  expect(record.parameters?.[1]).toMatchObject({ rest: true, required: false });
});

test('a long class lists the members the passage names first, and the rest by name', () => {
  const members = Array.from({ length: 40 }, (_, i) => ({
    name: i === 39 ? 'email' : `m${i}`,
    signatures: [{ parameters: [] }],
  }));
  const entry = { name: 'ZodString', kind: 'class', members };
  const record = specRecord({ exports: [] }, entry, undefined, 'Use `z.string().email()` here.');
  expect(record.members?.[0]).toBe('email()');
  expect(record.members).toHaveLength(24);
  expect(record.otherMembers).toHaveLength(16);
  expect(record.otherMembers).not.toContain('email');
});

test('every distinct overload is shown', () => {
  const sig = (n: number) => ({
    parameters: Array.from({ length: n }, (_, i) => ({
      name: `a${i}`,
      schema: { type: 'string' },
    })),
  });
  const signatures = [sig(1), sig(1), sig(2), sig(2), sig(1), sig(2), sig(1), sig(2), sig(3)];
  const record = specRecord({ exports: [] }, { name: 'useSWR', kind: 'function', signatures });
  expect(record.overloads).toHaveLength(3);
  expect(record.overloads?.[2]).toBe('useSWR(a0: string, a1: string, a2: string)');
});

test('a type ref resolves by id, and an ambiguous name resolves to nothing', () => {
  const shape = (key: string) => ({ type: 'object', properties: { [key]: { type: 'boolean' } } });
  const spec = {
    exports: [],
    types: [
      { id: 'Options', name: 'Options', schema: shape('enabled') },
      { id: 'react.Options', name: 'Options', schema: shape('sync') },
    ],
  };
  const fn = (ref: string) => ({
    name: 'devtools',
    kind: 'function',
    signatures: [{ parameters: [{ name: 'options', schema: { $ref: `#/types/${ref}` } }] }],
  });
  expect(specRecord(spec, fn('Options')).types).toEqual({ Options: '{ enabled?: boolean }' });
  expect(Object.values(specRecord(spec, fn('react.Options')).types ?? {})).toEqual([
    '{ sync?: boolean }',
  ]);
});

test('an optional member keeps its question mark', () => {
  const record = specRecord(
    { exports: [] },
    {
      name: 'PresenceUser',
      kind: 'interface',
      members: [
        { name: 'userId', schema: { type: 'string' } },
        { name: 'avatarUrl', schema: { type: 'string' }, flags: { optional: true } },
      ],
    },
  );
  expect(record.members).toEqual(['userId: string', 'avatarUrl?: string']);
});

test('type parameters are part of the signature', () => {
  const record = specRecord(
    { exports: [] },
    {
      name: 'createRoomContext',
      kind: 'function',
      typeParameters: [{ name: 'TPresence' }, { name: 'TStorage' }],
      signatures: [{ parameters: [] }],
    },
  );
  expect(record.signature).toBe('createRoomContext<TPresence, TStorage>()');
});

const liveObject = {
  name: 'LiveObject',
  kind: 'class',
  extends: 'AbstractCrdt',
  typeParameters: [{ name: 'T' }],
  members: ['get', 'set', 'update', 'toObject', 'toImmutable', '_attach'].map((name) => ({
    name,
    kind: 'method',
  })),
};
const presenceUser = {
  name: 'PresenceUser',
  kind: 'interface',
  members: [
    'userId',
    'displayName',
    'color',
    'connectedAt',
    'onlineStatus',
    'lastActiveAt',
    'isIdle',
    'avatarUrl',
    'location',
    'metadata',
  ].map((name) => ({ name, kind: 'property' })),
};
const live = {
  exports: [
    liveObject,
    presenceUser,
    { name: 'AbstractCrdt', kind: 'class', members: [] },
    { name: 'useStorage', kind: 'function', signatures: [{ parameters: [] }] },
  ],
};

test('unknownMembers: a method listed in prose that the class does not have', () => {
  expect(unknownMembers('`delete(key)` — remove a field:', live, liveObject)).toEqual(['delete']);
  expect(
    unknownMembers('- `get(key)`: read a field\n- `.remove(key)`: drop it', live, liveObject),
  ).toEqual(['remove']);
  expect(unknownMembers('Call the `clear` method to reset it.', live, liveObject)).toEqual([
    'clear',
  ]);
});

test('unknownMembers: a written-out shape with a field the interface does not have', () => {
  const passage =
    '`PresenceUser` — { userId, displayName, onlineStatus, location?, metadata?, joinedAt }';
  expect(unknownMembers(passage, live, presenceUser)).toEqual(['joinedAt']);
  const declared =
    '```ts\ninterface PresenceUser {\n  userId: string;\n  readonly joinedAt?: number;\n}\n```';
  expect(unknownMembers(declared, live, presenceUser)).toEqual(['joinedAt']);
  // A shape that belongs to something else on the line is not this export's.
  expect(
    unknownMembers('`PresenceUser` comes from `useSelf({ fresh })`.', live, presenceUser),
  ).toEqual([]);
});

test('unknownMembers: a member read off a receiver the code binds to the export', () => {
  const code = [
    '```ts',
    'const obj = new LiveObject({ count: 0 });',
    'obj.remove("count"); // obj.gone() is not a call',
    'obj.get("count").toFixed();',
    'liveObject.delete("count");',
    'LiveObject.from({});',
    'other.missing();',
    'import x from "./liveObject.js";',
    'obj.remove("again");',
    '```',
  ].join('\n');
  expect(unknownMembers(code, live, liveObject)).toEqual(['remove', 'delete', 'from']);
  expect(
    unknownMembers(
      '```ts\nfunction f(user: PresenceUser) {\n  return user?.joinedAt;\n}\n```',
      live,
      presenceUser,
    ),
  ).toEqual(['joinedAt']);
  expect(unknownMembers('```ts\nnew LiveObject({}).destroy();\n```', live, liveObject)).toEqual([
    'destroy',
  ]);
});

test('unknownMembers: when in doubt, no name', () => {
  // Its own name, its type parameters, other exports, members, builtins.
  const safe = [
    '`LiveObject(initial)` — the constructor',
    '`T` — the shape',
    '`useStorage()` — read it',
    '`get(key)` — read a field',
    '`_attach(doc)` — internal',
    '`toString()` — debug',
    '```ts\nconst o = new LiveObject({});\no.then(() => {});\nliveObject.length;\n```',
  ].join('\n');
  expect(unknownMembers(safe, live, liveObject)).toEqual([]);
  // A bare identifier on a class could be an option or an argument.
  expect(unknownMembers('- `initial`: the starting value', live, liveObject)).toEqual([]);
  // Saying it is not there agrees with the record.
  expect(unknownMembers('There is no `delete()` method. Use `update`.', live, liveObject)).toEqual(
    [],
  );
  expect(unknownMembers('`.delete(key)` was removed.', live, liveObject)).toEqual([]);
  // Not a class, interface or type: nothing to be a member of.
  expect(unknownMembers('`delete(key)` — remove', live, live.exports[3])).toEqual([]);
  // Capped at three.
  expect(unknownMembers('`a()` — x\n`b()` — x\n`c()` — x\n`d()` — x', live, liveObject)).toEqual([
    'a',
    'b',
    'c',
  ]);
});

test('unknownMembers: an open type can have any member', () => {
  const passage = '`Meta` — { id, anything }';
  const meta = (over: object) => ({
    name: 'Meta',
    kind: 'interface',
    members: [{ name: 'id', kind: 'property' }],
    ...over,
  });
  const closed = meta({});
  expect(unknownMembers(passage, { exports: [closed] }, closed)).toEqual(['anything']);
  for (const open of [
    meta({ schema: { type: 'object', properties: {}, additionalProperties: true } }),
    meta({ members: [{ name: 'id' }, { name: '[string]' }] }),
    meta({ schema: { allOf: [{ $ref: '#/types/Gone' }] } }),
    meta({ schema: { allOf: [{ type: 'object', additionalProperties: { type: 'string' } }] } }),
    meta({ schema: { anyOf: [{ type: 'object' }] } }),
    meta({ extends: 'HonoBase' }),
    meta({ members: [] }),
  ])
    expect(unknownMembers(passage, { exports: [open] }, open)).toEqual([]);
  // A base the spec has is part of the member list.
  const child = meta({ extends: 'Base<string>' });
  const base = { name: 'Base', kind: 'interface', members: [{ name: 'anything' }] };
  expect(unknownMembers(passage, { exports: [child, base] }, child)).toEqual([]);
  const viaTypes = {
    exports: [child],
    types: [{ name: 'Base', schema: { type: 'object', properties: { anything: {} } } }],
  };
  expect(unknownMembers(passage, viaTypes, child)).toEqual([]);
  const external = { exports: [child], types: [{ name: 'Base', external: true }] };
  expect(unknownMembers(passage, external, child)).toEqual([]);
});

test('in prose, `name()` with nothing inside names the function; in code it is the call', () => {
  expect(
    showsUse('generateImage() Generate images from a prompt.', 'generateImage', false),
  ).toBeNull();
  expect(showsUse('Use generateImage({ model }) here.', 'generateImage', false)).toBe('whole');
  expect(showsUse('const id = generateId();', 'generateId', true)).toBe('whole');
});

test('a destructured parameter reads as its keys, from an inline shape or a named one', () => {
  const spec = {
    exports: [
      {
        name: 'embed',
        kind: 'function',
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
                    value: { type: 'string' },
                    headers: { type: 'object' },
                  },
                  required: ['model', 'value'],
                },
              },
            ],
            returns: { schema: { type: 'object' } },
          },
        ],
      },
      {
        name: 'RoomProvider',
        kind: 'function',
        signatures: [
          {
            parameters: [
              {
                name: 'options',
                required: true,
                'x-ts-destructured': true,
                schema: { $ref: '#/types/RoomProviderProps' },
              },
            ],
            returns: { schema: { 'x-ts-type': 'ReactNode' } },
          },
        ],
      },
    ],
    types: [
      {
        name: 'RoomProviderProps',
        schema: {
          type: 'object',
          properties: {
            roomId: { type: 'string' },
            userId: { type: 'string' },
            children: { 'x-ts-type': 'ReactNode' },
          },
          required: ['roomId', 'userId', 'children'],
        },
      },
    ],
  } as unknown as OpenPkgSpec;
  const embed = specRecord(spec, spec.exports[0]);
  expect(embed.signature).toBe('embed({ model: string, value: string, headers?: object }): object');
  expect(embed.parameters?.map((p) => `${p.name}${p.required ? '' : '?'}`)).toEqual([
    'model',
    'value',
    'headers?',
  ]);
  const room = specRecord(spec, spec.exports[1]);
  expect(room.kind).toBe('React component');
  expect(room.props?.map((p) => p.name)).toEqual(['roomId', 'userId', 'children']);
  expect(room.signature).toBe('<RoomProvider roomId userId children />');
});

test('a call whose options literal elides at its own level is a fragment, not a whole use', () => {
  expect(
    showsUse(
      'const r = await generateText({\n  // ...\n  output: Output.object({ schema }),\n});',
      'generateText',
    ),
  ).toBeNull();
  expect(showsUse('dynamicTool({\n  /* ... */\n})', 'dynamicTool')).toBeNull();
  expect(showsUse('new ToolLoopAgent({ ... })', 'ToolLoopAgent')).toBeNull();
  expect(
    showsUse(
      "so string IDs work: `streamTranscribe({ model: 'openai/whisper', ... })`",
      'streamTranscribe',
      false,
    ),
  ).toBeNull();
  expect(showsUse('f({ ...rest, a: 1 })', 'f')).toBe('whole');
  // An elision inside a nested literal does not make the outer call a fragment.
  expect(showsUse('generateText({\n  model,\n  tools: { /* ... */ },\n});', 'generateText')).toBe(
    'whole',
  );
});

test('a destructured union says which keys a caller must pick between', () => {
  const spec = {
    exports: [
      {
        name: 'generateText',
        kind: 'function',
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
                  },
                  required: ['model'],
                  anyOf: [{ required: ['prompt'] }, { required: ['messages'] }],
                },
              },
            ],
            returns: { schema: { type: 'object' } },
          },
        ],
      },
    ],
  } as unknown as OpenPkgSpec;
  const rec = specRecord(spec, spec.exports[0]);
  expect(rec.signature).toBe(
    'generateText({ model: string, prompt?: string, messages?: unknown[] } /* one of: prompt | messages */): object',
  );
  expect(rec.parameters?.map((p) => p.name)).toEqual(['model', 'prompt', 'messages']);
});
