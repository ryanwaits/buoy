import { expect, test } from 'bun:test';
import { declaredAt } from '../src/declared';
import type { Claim } from '../src/types';

const claim = (name: string | null): Claim => ({
  id: name ?? 'none',
  kind: 'inline',
  text: name ?? '',
  locator: { path: 'a.md', start: { line: 1, col: 1 }, end: { line: 1, col: 2 } },
  specRef: name ? { export: name } : null,
});

const storage = {
  exports: [
    {
      name: 'LiveObject',
      kind: 'class',
      source: { file: 'packages/storage/src/live-object.ts', line: 15 },
    },
    { name: 'LiveMap', kind: 'class', source: { file: 'packages/storage/src/live-map.ts' } },
    { name: 'nowhere', kind: 'function', source: null },
  ],
  types: [{ name: 'Op', source: { file: 'packages/storage/src/ops.ts', line: 3 } }],
};
const react = {
  exports: [
    {
      name: 'useStorage',
      kind: 'function',
      source: { file: '/repo/packages/react/src/use-storage.ts', line: 9 },
    },
    {
      name: 'LiveObject',
      kind: 'class',
      source: { file: 'packages/react/src/reexport.ts', line: 1 },
    },
  ],
  types: [{ name: 'LiveMap', source: { file: 'packages/react/src/shadow.ts', line: 2 } }],
};

test('each export a page cites, where the spec says it is declared', () => {
  const claims = [
    'LiveObject',
    'LiveObject',
    'LiveMap',
    'Op',
    'useStorage',
    'nowhere',
    'ghost',
    null,
  ].map(claim);
  expect(declaredAt(claims, [storage, react], '/repo')).toEqual({
    // The first spec that exports it, as the judge reads it; a line is optional.
    LiveObject: 'packages/storage/src/live-object.ts:15',
    LiveMap: 'packages/storage/src/live-map.ts',
    // Not an export anywhere: a type.
    Op: 'packages/storage/src/ops.ts:3',
    // OpenPkg writes the path it was given, absolute; the manifest keeps it relative to the repo.
    useStorage: 'packages/react/src/use-storage.ts:9',
  });
});

test('nothing declared, nothing written', () => {
  expect(declaredAt([claim('ghost'), claim(null)], [storage])).toBeUndefined();
  expect(declaredAt([], [storage])).toBeUndefined();
});
