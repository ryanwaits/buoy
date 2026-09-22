import { expect, test } from 'bun:test';
import { memberLabel } from '../src/overlay';

test('memberLabel: drops the export, keeps the parameters, loses the return type', () => {
  expect(memberLabel('Room.roomId', 'Room')).toEqual({ name: 'roomId', params: '' });
  expect(memberLabel('Room.send(data: string): boolean', 'Room')).toEqual({
    name: 'send',
    params: '(data: string)',
  });
  expect(memberLabel('X.f(cb: (a: number) => void, o?: { k: T<U> }): void', 'X')).toEqual({
    name: 'f',
    params: '(cb: (a: number) => void, o?: { k: T<U> })',
  });
  expect(memberLabel('Other.go(): void', 'Room')).toEqual({ name: 'Other.go', params: '()' });
});
