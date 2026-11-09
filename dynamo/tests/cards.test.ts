import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOVES, columns, decide, moveArgs, optionOf, statusOf, viewArgs, where } from '../cards.ts';

const project = { repo: 'me/proj', boardOwner: 'me' };
const options = { Todo: 'aaa', Build: 'bbb' };
const board = { boardNumber: 3, boardName: 'Board', options };
const w = where(project, board);
const items = (...i: unknown[]) => JSON.stringify({ projectItems: i });

test('where reads the repository and the board, and a whole board number counts as its digits', () => {
  assert.deepEqual(w, { repo: 'me/proj', owner: 'me', number: '3', boardName: 'Board' });
  assert.equal(where(project, { ...board, boardNumber: '3' }).number, '3');
});

test('where names what is missing or wrong', () => {
  for (const key of ['repo', 'boardOwner']) assert.throws(() => where({ ...project, [key]: undefined }, board), new RegExp(`project\.${key}`), key);
  for (const key of ['boardNumber', 'boardName']) assert.throws(() => where(project, { ...board, [key]: undefined }), new RegExp(`board\\.${key}`), key);
  assert.throws(() => where(project, { ...board, boardNumber: 1.5 }), /boardNumber/);
  assert.throws(() => where({ ...project, repo: 'noslash' }, board), /owner\/name/);
  assert.throws(() => where({ ...project, boardNumber: 3, boardName: 'Board' }, undefined), /board\.boardNumber/, "the board's values are not read from project");
});

test('optionOf gives the id of an own key and null for anything else', () => {
  assert.equal(optionOf(board, 'Build'), 'bbb');
  for (const column of ['build', '', 'toString', '__proto__', 'constructor']) assert.equal(optionOf(board, column), null, column);
  assert.equal(optionOf({ options: { Build: '' } }, 'Build'), null);
  assert.equal(optionOf({ options: { Build: 7 } }, 'Build'), null);
});

test('optionOf refuses a board without options, or options that are not an object', () => {
  for (const bad of [undefined, null, 'x', {}, { options: 'x' }, { options: ['Build'] }, { options: null }]) assert.throws(() => optionOf(bad, 'Build'), /board\.options/);
});

test('columns lists the names of the options', () => {
  assert.deepEqual(columns(board), ['Todo', 'Build']);
  assert.deepEqual(columns(undefined), []);
});

test('moveArgs moves by the issue URL and the column name; viewArgs reads that one issue', () => {
  assert.deepEqual(moveArgs(w, 7, 'Build'), ['project', 'item-edit', '3', '--owner', 'me', '--url', 'https://github.com/me/proj/issues/7', '--field', 'Status', '--value', 'Build']);
  assert.deepEqual(viewArgs(w, 7), ['issue', 'view', '7', '-R', 'me/proj', '--json', 'projectItems']);
});

test('statusOf gives the name and option id of the card on our board', () => {
  const json = items({ title: 'Other', status: { name: 'Done', optionId: 'zzz' } }, { title: 'Board', status: { name: 'Build', optionId: 'bbb' } });
  assert.deepEqual(statusOf(json, 'Board'), { name: 'Build', optionId: 'bbb' });
});

test('statusOf has no name for a card on no board, on another board or with no state', () => {
  const none = { name: null, optionId: null };
  assert.deepEqual(statusOf(items(), 'Board'), none);
  assert.deepEqual(statusOf(items({ title: 'Other', status: { name: 'Build', optionId: 'bbb' } }), 'Board'), none);
  assert.deepEqual(statusOf(items({ title: 'Board', status: null }), 'Board'), none);
  assert.deepEqual(statusOf(items({ title: 'Board' }), 'Board'), none);
  assert.deepEqual(statusOf(items({ title: 'Board', status: { name: 5 } }), 'Board'), none);
});

test('statusOf refuses what is not JSON or has no projectItems list', () => {
  assert.throws(() => statusOf('nope', 'Board'), /JSON/);
  for (const bad of ['null', '[]', '{}', '{"projectItems":5}']) assert.throws(() => statusOf(bad, 'Board'), /projectItems/, bad);
});

test('decide: a card in the column before any move is left alone', () => {
  assert.equal(decide({ name: 'Build', optionId: 'bbb' }, 'bbb', 0), 'already');
});

test('decide: a card in the column after a move is done, whatever the move count', () => {
  for (let moves = 1; moves <= MOVES; moves++) assert.equal(decide({ name: 'Build', optionId: 'bbb' }, 'bbb', moves), 'done');
});

test('decide: a card not in the column is moved until MOVES moves were made, then it fails', () => {
  const todo = { name: 'Todo', optionId: 'aaa' };
  assert.equal(MOVES, 2);
  assert.equal(decide(todo, 'bbb', 0), 'again');
  assert.equal(decide(todo, 'bbb', 1), 'again');
  assert.equal(decide(todo, 'bbb', 2), 'fail');
  assert.equal(decide({ name: null, optionId: null }, 'bbb', 2), 'fail');
});

test('decide compares the option id, not the name', () => {
  assert.equal(decide({ name: 'Build', optionId: 'other' }, 'bbb', 0), 'again');
  assert.equal(decide({ name: 'Todo', optionId: 'bbb' }, 'bbb', 0), 'already');
});
