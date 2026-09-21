import { expect, test } from 'bun:test';
import { entryFor, entryPath } from '../src/config';

test('one entry covers every route', () => {
  expect(entryFor('src/index.ts', '/docs/anything')).toBe('src/index.ts');
});

test('a map resolves exact route, then longest prefix, then "*"', () => {
  const entry = {
    '/docs': 'packages/core/src/index.ts',
    '/docs/react': 'packages/react/src/index.ts',
    '*': 'packages/client/src/index.ts',
  };
  expect(entryFor(entry, '/docs/react')).toBe('packages/react/src/index.ts');
  expect(entryFor(entry, '/docs/react/hooks')).toBe('packages/react/src/index.ts');
  expect(entryFor(entry, '/docs/reactive')).toBe('packages/core/src/index.ts');
  expect(entryFor(entry, '/blog')).toBe('packages/client/src/index.ts');
});

test('no match and no "*"', () => {
  expect(entryFor({ '/docs/react': 'a.ts' }, '/docs/server')).toBeUndefined();
});

test('an entry can say what it is imported as, and what else the page documents', () => {
  const zod = {
    path: 'packages/zod/src/index.ts',
    also: [{ path: 'packages/zod/src/mini/index.ts', importSpecifier: 'zod/mini' }],
  };
  expect(entryFor(zod, '/api')).toBe(zod);
  expect(entryFor({ '/api': zod, '*': 'src/index.ts' }, '/api/strings')).toBe(zod);
  expect(entryPath(zod)).toBe('packages/zod/src/index.ts');
  expect(entryPath('src/index.ts')).toBe('src/index.ts');
});
