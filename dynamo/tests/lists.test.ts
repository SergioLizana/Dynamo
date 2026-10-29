// The list of a run as data (lists.ts): which tickets it takes, what starts, what waits, what is skipped, when it ends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Row } from '../frontier.ts';
import type { Item, State } from '../lists.ts';
import { atOnceOf, listOf, schedule } from '../lists.ts';

const open = (number: number) => ({ number, state: 'OPEN', doneLabel: false });
const row = (number: number, why: string | null, blockers = [] as Row['blockers']): Row => ({
  number, title: `t${number}`, column: 'Todo', doneLabel: false, blockers, ready: why === null, why,
});
const item = (number: number, state: State, blockers: number[] = []): Item => ({ number, blockers, state, why: null });

test('atOnceOf reads ticketsAtOnce, a whole number from 1, and refuses anything else', () => {
  assert.equal(atOnceOf({ ticketsAtOnce: 2 }), 2);
  for (const bad of [undefined, 0, -1, 1.5, '2', null]) assert.throws(() => atOnceOf({ ticketsAtOnce: bad }), /ticketsAtOnce/, String(bad));
});

test('listOf with numbers keeps every ticket: the ready and those waiting on blockers wait, the rest are skipped with why', () => {
  const rows = [
    row(3, 'blocker not done: #1', [open(1), { number: 2, state: 'CLOSED', doneLabel: false }]),
    row(1, null),
    row(4, 'in Needs Human', [open(1)]),
    row(5, 'done (in-release)'),
  ];
  assert.deepEqual(listOf(rows, true), [
    { number: 1, blockers: [], state: 'waiting', why: null },
    { number: 3, blockers: [1], state: 'waiting', why: null },
    { number: 4, blockers: [1], state: 'skipped', why: 'in Needs Human' },
    { number: 5, blockers: [], state: 'skipped', why: 'done (in-release)' },
  ]);
});

test('listOf with no numbers keeps only the ready and those that wait on the list, also through others', () => {
  const rows = [
    row(1, null),
    row(2, 'blocker not done: #1', [open(1)]),
    row(3, 'blocker not done: #2', [open(2)]),
    row(4, 'in Needs Human'),
    row(5, 'blocker not done: #4', [open(4)]),
    row(6, 'blocker not done: #5', [open(5)]),
    row(7, 'blocker not done: #99', [open(99)]),
    row(8, 'done (in-release)'),
  ];
  assert.deepEqual(listOf(rows, false).map((i) => i.number), [1, 2, 3]);
});

test('schedule starts the ready ones by number while fewer than N run, and the rest wait', () => {
  const items = [item(3, 'waiting'), item(1, 'waiting'), item(2, 'waiting'), item(4, 'waiting', [1])];
  assert.deepEqual(schedule(items, 2), { start: [1, 2], skip: [], done: false });
  const later = [item(1, 'running'), item(2, 'waiting'), item(3, 'running'), item(4, 'waiting', [1])];
  assert.deepEqual(schedule(later, 2), { start: [], skip: [], done: false });
  assert.deepEqual(schedule(later, 3), { start: [2], skip: [], done: false });
});

test('schedule starts a ticket once every blocker of the list is merged', () => {
  const items = [item(1, 'merged'), item(2, 'running'), item(3, 'waiting', [1, 2])];
  assert.deepEqual(schedule(items, 2).start, []);
  assert.deepEqual(schedule([item(1, 'merged'), item(2, 'merged'), item(3, 'waiting', [1, 2])], 2), { start: [3], skip: [], done: false });
});

test('schedule skips the dependents of a stopped ticket, also transitively, and of a skipped one', () => {
  const items = [item(1, 'blocked'), item(2, 'waiting', [1]), item(3, 'waiting', [2]), item(4, 'skipped'), item(5, 'waiting', [4]), item(6, 'waiting')];
  assert.deepEqual(schedule(items, 2), {
    start: [6],
    skip: [
      { number: 2, why: 'blocker #1 stopped in this run' },
      { number: 3, why: 'blocker #2 was skipped' },
      { number: 5, why: 'blocker #4 was skipped' },
    ],
    done: false,
  });
});

test('schedule skips a ticket waiting on one outside the list, and a cycle of blockers once nothing else runs', () => {
  assert.deepEqual(schedule([item(2, 'waiting', [9])], 2).skip, [{ number: 2, why: 'blocker not done: #9, which is not in the list' }]);
  const cycle = [item(1, 'waiting', [2]), item(2, 'waiting', [1]), item(3, 'running')];
  assert.deepEqual(schedule(cycle, 2), { start: [], skip: [], done: false });
  assert.deepEqual(schedule([item(1, 'waiting', [2]), item(2, 'waiting', [1]), item(3, 'merged')], 2), {
    start: [],
    skip: [{ number: 1, why: 'a cycle of blockers: #2 never start' }, { number: 2, why: 'a cycle of blockers: #1 never start' }],
    done: true,
  });
});

test('schedule ends the list when nothing runs and nothing can start; an empty list ends at once', () => {
  assert.deepEqual(schedule([item(1, 'merged'), item(2, 'blocked'), item(3, 'skipped')], 2), { start: [], skip: [], done: true });
  assert.deepEqual(schedule([item(1, 'blocked'), item(2, 'waiting', [1])], 2), { start: [], skip: [{ number: 2, why: 'blocker #1 stopped in this run' }], done: true });
  assert.deepEqual(schedule([], 2), { start: [], skip: [], done: true });
  assert.equal(schedule([item(1, 'running')], 2).done, false);
});
