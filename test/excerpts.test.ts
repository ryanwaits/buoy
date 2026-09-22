import { expect, test } from 'bun:test';
import * as path from 'node:path';
import { excerptsFor, memberLine } from '../src/excerpts';
import type { Claim } from '../src/types';

const root = path.join(import.meta.dir, 'fixtures');
const claim = (exp: string, member?: string): Pick<Claim, 'specRef'> => ({
  specRef: { export: exp, ...(member ? { member } : {}) },
});
const declared = { Room: 'src/room.ts.txt:2', Ghost: 'src/nowhere.ts:1' };

test('an excerpt around the export, and one at each member found in the file', () => {
  const out = excerptsFor(
    [claim('Room'), claim('Room', 'send'), claim('Room', 'roomId'), claim('Room', 'off')],
    declared,
    root,
  );
  expect(out?.Room).toEqual({
    file: 'src/room.ts.txt',
    from: 1,
    at: 2,
    lines: [
      '/** A room. */',
      'export class Room extends Base {',
      '  readonly roomId: string;',
      '  private readonly userId: string;',
      '',
      '  connect(): void {}',
      '',
      '  send(message: string): boolean {',
    ],
  });
  expect(out?.['Room.send']?.at).toBe(8);
  expect(out?.['Room.send']?.from).toBe(6);
  expect(out?.['Room.roomId']?.at).toBe(3);
  // Inherited: not in this file, so no excerpt of its own.
  expect(out?.['Room.off']).toBeUndefined();
});

test('a file that is not there, or a bare file with no line, gives nothing', () => {
  expect(excerptsFor([claim('Ghost')], declared, root)).toBeUndefined();
  expect(excerptsFor([claim('Room')], { Room: 'src/room.ts.txt' }, root)).toBeUndefined();
});

test('memberLine matches a declaration, not a mention', () => {
  const lines = [
    'class A {',
    '  // send is throttled',
    '  x = this.send;',
    '  async send(a: T) {}',
    '  get send2() {}',
  ];
  expect(memberLine(lines, 1, 'send')).toBe(4);
  expect(memberLine(lines, 1, 'send2')).toBe(5);
  expect(memberLine(lines, 1, 'nope')).toBeUndefined();
});
