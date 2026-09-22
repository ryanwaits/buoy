import { expect, test } from 'bun:test';
import { type OpenPkgSpec, renderType, specRecord } from '../src/lookout/evidence';

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

test('a parameter type too big to spell out is listed by its key names', () => {
  const keys = Array.from({ length: 30 }, (_, i) => `option${i}Name`);
  const spec = {
    exports: [
      {
        name: 'Agent',
        kind: 'class',
        signatures: [
          {
            parameters: [
              { name: 'settings', required: true, schema: { $ref: '#/types/Settings' } },
            ],
          },
        ],
      },
    ],
    types: [
      {
        name: 'Settings',
        schema: {
          type: 'object',
          properties: Object.fromEntries(
            keys.map((k) => [k, { type: 'string', description: 'x'.repeat(30) }]),
          ),
        },
      },
    ],
  } as unknown as OpenPkgSpec;
  const rec = specRecord(spec, spec.exports[0]);
  expect(rec.types?.Settings).toMatch(/^\{ keys: option0Name, option1Name/);
});
