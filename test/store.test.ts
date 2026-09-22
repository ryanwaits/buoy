import { beforeEach, expect, test } from 'bun:test';
import { loadStore } from '../src/store';

beforeEach(() => localStorage.clear());

test('empty by default; save round-trips', () => {
  const store = loadStore();
  expect(store.resolved).toEqual({});
  store.resolved.a = 'fix the prose';
  store.resolved.b = null;
  store.hidden.add('likely');
  store.save();
  const again = loadStore();
  expect(again.resolved).toEqual({ a: 'fix the prose', b: null });
  expect([...again.hidden]).toEqual(['likely']);
});

test('pre-0.3 dismissed ids become "not a problem", keeping a note they had', () => {
  localStorage.setItem('buoy:dismissed', JSON.stringify(['a', 'b']));
  localStorage.setItem('buoy:notes', JSON.stringify({ a: ' renamed in 0.2 ', c: 'unrelated' }));
  const store = loadStore();
  expect(store.resolved).toEqual({ a: 'renamed in 0.2', b: null });
  expect(localStorage.getItem('buoy:dismissed')).toBeNull();
  expect(localStorage.getItem('buoy:notes')).toBeNull();
  expect(loadStore().resolved).toEqual({ a: 'renamed in 0.2', b: null });
});
