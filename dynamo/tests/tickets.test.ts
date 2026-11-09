import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTickets } from '../tickets.ts';
import type { Result } from '../exec.ts';

const where = { repo: 'o/r', boardId: 'BOARD', statusFieldId: 'STATUS', doneLabel: 'in-release' };
const conn = (nodes: unknown[], totalCount = nodes.length) => ({ totalCount, nodes });
const label = (name: string) => ({ name });
const card = (column: string, boardId = 'BOARD', fieldId = 'STATUS') =>
  ({ project: { id: boardId }, fieldValues: conn([{}, { name: column, field: { id: fieldId } }]) });
const node = (number: number, more: Record<string, unknown> = {}) => ({
  number, title: `t${number}`, state: 'OPEN', labels: conn([]), projectItems: conn([card('Todo')]), blockedBy: conn([]), ...more,
});
const ok = (data: unknown, errors?: unknown[]): Result =>
  ({ code: errors ? 1 : 0, stdout: JSON.stringify({ data, ...(errors ? { errors } : {}) }), stderr: errors ? 'gh: some error\n' : '' });

// A gh that answers the calls in order and keeps their arguments.
function fakeGh(...answers: Result[]) {
  const calls: string[][] = [];
  const gh = (args: string[]): Result => {
    calls.push(args);
    return answers.shift() ?? { code: 1, stdout: '', stderr: 'no more answers' };
  };
  return { gh, calls };
}
const queryOf = (args: string[]) => args.find((a) => a.startsWith('query=')) ?? '';

test('with numbers it asks GitHub for those issues only, by graphql, and reads their card, labels and blockers', () => {
  const blocker = { number: 3, state: 'OPEN', labels: conn([label('in-release')]) };
  const { gh, calls } = fakeGh(ok({ repository: {
    t5: node(5, { labels: conn([label('bug'), label('in-release')]), blockedBy: conn([blocker]) }),
    t7: node(7, { projectItems: conn([card('Build', 'OTHER'), card('Review')]) }),
  } }));
  const r = readTickets(gh, where, [5, 7]);
  assert.deepEqual(r, { missing: [], found: [
    { number: 5, title: 't5', state: 'OPEN', column: 'Todo', doneLabel: true, blockers: [{ number: 3, state: 'OPEN', doneLabel: true }] },
    { number: 7, title: 't7', state: 'OPEN', column: 'Review', doneLabel: false, blockers: [] },
  ] });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ['api', 'graphql']);
  assert.match(queryOf(calls[0]), /t5:issue\(number:5\).*t7:issue\(number:7\)/);
  assert.doesNotMatch(queryOf(calls[0]), /issues\(/);
  assert.ok(calls[0].includes('owner=o') && calls[0].includes('name=r'));
});

test('a card on another board, or no card, gives no column', () => {
  const { gh } = fakeGh(ok({ repository: { t5: node(5, { projectItems: conn([card('Build', 'OTHER')]) }), t6: node(6, { projectItems: conn([]) }) } }));
  assert.deepEqual(readTickets(gh, where, [5, 6]).found.map((t) => t.column), [null, null]);
});

test('a number GitHub does not know is missing, not a failure', () => {
  const { gh } = fakeGh(ok({ repository: { t5: node(5), t9999: null } },
    [{ type: 'NOT_FOUND', path: ['repository', 't9999'], message: 'Could not resolve to an Issue with the number of 9999.' }]));
  const r = readTickets(gh, where, [5, 9999]);
  assert.deepEqual(r.found.map((t) => t.number), [5]);
  assert.deepEqual(r.missing, [9999]);
});

test('without numbers it reads the open issues, every page of them', () => {
  const { gh, calls } = fakeGh(
    ok({ repository: { issues: { pageInfo: { hasNextPage: true, endCursor: 'C1' }, nodes: [node(1), node(2)] } } }),
    ok({ repository: { issues: { pageInfo: { hasNextPage: false, endCursor: 'C2' }, nodes: [node(3)] } } }),
  );
  assert.deepEqual(readTickets(gh, where, []).found.map((t) => t.number), [1, 2, 3]);
  assert.equal(calls.length, 2);
  assert.match(queryOf(calls[0]), /issues\(states:OPEN/);
  assert.ok(!calls[0].some((a) => a.startsWith('after=')));
  assert.ok(calls[1].includes('after=C1'));
});

test('a page that says there is more but gives no cursor fails instead of stopping there', () => {
  const { gh } = fakeGh(ok({ repository: { issues: { pageInfo: { hasNextPage: true, endCursor: null }, nodes: [node(1)] } } }));
  assert.throws(() => readTickets(gh, where, []), /more open issues/);
});

test('a list GitHub cuts (labels, cards, blockers, a blocker\'s labels) fails the read: never cut silently', () => {
  const cut = [
    { labels: conn([label('a')], 2) },
    { projectItems: conn([card('Todo')], 2) },
    { projectItems: conn([{ project: { id: 'BOARD' }, fieldValues: conn([], 1) }]) },
    { blockedBy: conn([], 1) },
    { blockedBy: conn([{ number: 3, state: 'OPEN', labels: conn([], 1) }]) },
  ];
  for (const more of cut) {
    const { gh } = fakeGh(ok({ repository: { t5: node(5, more) } }));
    assert.throws(() => readTickets(gh, where, [5]), /cut/, JSON.stringify(more));
  }
});

test('a gh failure throws with the reason', () => {
  const { gh } = fakeGh({ code: 1, stdout: '', stderr: 'HTTP 401: Bad credentials\r\n' });
  assert.throws(() => readTickets(gh, where, [5]), /exit 1.*HTTP 401: Bad credentials/);
});

test('an error other than a missing issue fails the read, even with data', () => {
  const { gh } = fakeGh(ok({ repository: { t5: node(5) } }, [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }]));
  assert.throws(() => readTickets(gh, where, [5]), /API rate limit exceeded/);
});

test('a repository GitHub does not know fails the read', () => {
  const { gh } = fakeGh(ok({ repository: null }, [{ type: 'NOT_FOUND', path: ['repository'], message: 'Could not resolve to a Repository' }]));
  assert.throws(() => readTickets(gh, where, [5]), /Could not resolve to a Repository/);
});

test('an answer that is not the expected shape fails the read', () => {
  for (const t5 of [{ number: 5 }, { ...node(5), labels: 'x' }]) {
    const { gh } = fakeGh(ok({ repository: { t5 } }));
    assert.throws(() => readTickets(gh, where, [5]), JSON.stringify(t5));
  }
  const { gh } = fakeGh({ code: 0, stdout: 'not json', stderr: '' });
  assert.throws(() => readTickets(gh, where, [5]));
});
