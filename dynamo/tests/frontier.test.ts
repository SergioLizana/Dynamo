import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frontier } from '../frontier.ts';
import type { Ticket } from '../tickets.ts';

const rules = { doneLabel: 'in-release', needsHuman: 'Needs Human' };
const ticket = (number: number, more: Partial<Ticket> = {}): Ticket =>
  ({ number, title: `t${number}`, state: 'OPEN', column: 'Todo', doneLabel: false, blockers: [], ...more });
const one = (t: Ticket) => frontier({ found: [t], missing: [] }, rules)[0];

test('an open ticket with no blockers, not done and not in Needs Human, is ready', () => {
  assert.deepEqual(one(ticket(5)), { ...ticket(5), ready: true, why: null });
});

test('a ticket with the done label is not ready: done', () => {
  assert.deepEqual([one(ticket(5, { doneLabel: true })).ready, one(ticket(5, { doneLabel: true })).why], [false, 'done (in-release)']);
});

test('a closed ticket is not ready: done', () => {
  assert.equal(one(ticket(5, { state: 'CLOSED' })).why, 'done (closed)');
});

test('a ticket whose card is in Needs Human is not ready', () => {
  const row = one(ticket(5, { column: 'Needs Human' }));
  assert.equal(row.ready, false);
  assert.equal(row.why, 'in Needs Human');
});

test('an open blocker without the done label keeps a ticket from being ready, and is named', () => {
  const blockers = [{ number: 3, state: 'OPEN', doneLabel: false }, { number: 4, state: 'OPEN', doneLabel: false }];
  const row = one(ticket(5, { blockers }));
  assert.equal(row.ready, false);
  assert.equal(row.why, 'blocker not done: #3, #4');
  assert.deepEqual(row.blockers, blockers);
});

test('a blocker closed, or open with the done label, is done: the ticket is ready', () => {
  const blockers = [{ number: 3, state: 'CLOSED', doneLabel: false }, { number: 4, state: 'OPEN', doneLabel: true }];
  assert.equal(one(ticket(5, { blockers })).ready, true);
});

test('only the blockers not done are named', () => {
  const blockers = [{ number: 3, state: 'CLOSED', doneLabel: false }, { number: 4, state: 'OPEN', doneLabel: false }];
  assert.equal(one(ticket(5, { blockers })).why, 'blocker not done: #4');
});

test('a number that does not exist is a row that is not ready and says so', () => {
  assert.deepEqual(frontier({ found: [], missing: [9999] }, rules),
    [{ number: 9999, title: null, column: null, doneLabel: false, blockers: [], ready: false, why: 'no such issue' }]);
});

test('done comes before Needs Human, and Needs Human before a blocker', () => {
  const blockers = [{ number: 3, state: 'OPEN', doneLabel: false }];
  assert.equal(one(ticket(5, { doneLabel: true, column: 'Needs Human', blockers })).why, 'done (in-release)');
  assert.equal(one(ticket(5, { column: 'Needs Human', blockers })).why, 'in Needs Human');
});

test('the rows come sorted by number, the missing ones among them', () => {
  const rows = frontier({ found: [ticket(7), ticket(2)], missing: [5] }, rules);
  assert.deepEqual(rows.map((r) => r.number), [2, 5, 7]);
});
