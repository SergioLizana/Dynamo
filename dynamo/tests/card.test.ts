import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { card } from '../card.ts';
import { UsageError } from '../cli.ts';
import { readFactory } from '../factory.ts';
import type { Deps } from '../cli.ts';
import type { Result } from '../exec.ts';
import { DYNAMO, fakeGhEnv, scratch } from './helpers.ts';

const factory = readFactory();
const project = factory.project as Record<string, unknown>;
const options = factory.options as Record<string, string>;
const repo = String(project.repo);
const url = (n: number) => `https://github.com/${repo}/issues/${n}`;
const readCall = (n: number) => ['issue', 'view', String(n), '-R', repo, '--json', 'projectItems'];
const moveCall = (n: number, column: string) => ['project', 'item-edit', String(project.boardNumber), '--owner', String(project.boardOwner),
  '--url', url(n), '--field', 'Status', '--value', column];

// What `gh issue view --json projectItems` prints for a card in `column`.
const view = (column: string | null, title: unknown = project.boardName): Result => ({
  code: 0, stderr: '',
  stdout: JSON.stringify({ projectItems: column === null ? [] : [{ title, status: { name: column, optionId: options[column] } }] }),
});
const ok: Result = { code: 0, stdout: '', stderr: '' };

// A gh that answers in order and writes down every call; the board's list of cards fails the test, as the fake gh does.
function deps(...answers: Result[]): Deps & { calls: string[][] } {
  const calls: string[][] = [];
  const gh = (args: string[]): Result => {
    calls.push(args);
    assert.ok(!args.includes('item-list'), 'card never lists the board');
    return answers.shift() ?? { code: 1, stdout: '', stderr: 'no answer' };
  };
  const nope = (): Result => { throw new Error('card uses only gh'); };
  return { gh, git: nope, exec: nope, factory: () => factory, calls };
}

test('card moves a card with the issue URL and the column name, then reads only that issue', () => {
  const d = deps(view('Todo'), ok, view('Build'));
  assert.deepEqual(card(['80', 'Build'], d), { ok: true, ticket: 80, column: 'Build', moved: true });
  assert.deepEqual(d.calls, [readCall(80), moveCall(80, 'Build'), readCall(80)]);
});

test('card takes the column and its option id from factory.json: an unknown column is a usage error and calls no gh', () => {
  const d = deps();
  for (const column of ['Nope', 'build', '', 'toString', '__proto__']) assert.throws(() => card(['80', column], d), UsageError, column);
  assert.deepEqual(d.calls, []);
});

test('card checks the option id of the column, not only its name', () => {
  const renamed: Result = { code: 0, stderr: '', stdout: JSON.stringify({ projectItems: [{ title: project.boardName, status: { name: 'Build', optionId: 'deadbeef' } }] }) };
  const d = deps(renamed, ok, view('Build'));
  assert.equal(card(['80', 'Build'], d).moved, true);
});

test('a card already in the column is not moved', () => {
  const d = deps(view('Review'));
  assert.deepEqual(card(['80', 'Review'], d), { ok: true, ticket: 80, column: 'Review', moved: false });
  assert.deepEqual(d.calls, [readCall(80)]);
});

test('a card that is not in the column after the move is moved once more, and then it is ok', () => {
  const d = deps(view('Todo'), ok, view('Todo'), ok, view('Verify'));
  assert.deepEqual(card(['80', 'Verify'], d), { ok: true, ticket: 80, column: 'Verify', moved: true });
  assert.deepEqual(d.calls, [readCall(80), moveCall(80, 'Verify'), readCall(80), moveCall(80, 'Verify'), readCall(80)]);
});

test('a card that is still not in the column after the second move fails, with the column it is in, and is not moved a third time', () => {
  const d = deps(view('Todo'), ok, view('Todo'), ok, view('Todo'));
  const out = card(['80', 'Verify'], d);
  assert.equal(out.ok, false);
  assert.equal(out.found, 'Todo');
  assert.equal(d.calls.filter((c) => c.includes('item-edit')).length, 2);
  assert.equal(d.calls.length, 5);
});

test('a move that gh refuses is tried once more and its error is reported', () => {
  const refused: Result = { code: 1, stdout: '', stderr: 'specify the item to edit' };
  const d = deps(view('Todo'), refused, view('Todo'), refused, view('Todo'));
  const out = card(['80', 'Done'], d);
  assert.equal(out.ok, false);
  assert.match(String(out.error), /specify the item to edit/);
});

test('a move that fails once and then works is ok', () => {
  const d = deps(view('Todo'), { code: 1, stdout: '', stderr: 'boom' }, view('Todo'), ok, view('Done'));
  assert.equal(card(['80', 'Done'], d).ok, true);
});

test('a card that is on no board, or on another one, is not in the column', () => {
  assert.equal(card(['80', 'Done'], deps(view(null), ok, view(null), ok, view(null))).ok, false);
  const other = () => view('Todo', 'Another board');
  assert.equal(card(['80', 'Todo'], deps(other(), ok, other(), ok, other())).ok, false);
});

test('an issue that cannot be read is an error', () => {
  assert.throws(() => card(['80', 'Build'], deps({ code: 1, stdout: '', stderr: 'Could not resolve' })), /Could not resolve/);
  assert.throws(() => card(['80', 'Build'], deps({ code: 0, stdout: 'not json', stderr: '' })), /JSON/);
  assert.throws(() => card(['80', 'Build'], deps({ code: 0, stdout: '{"projectItems":5}', stderr: '' })), /projectItems/);
});

test('card refuses the wrong number of arguments or a ticket that is not a number as a usage error', () => {
  for (const args of [[], ['80'], ['80', 'Build', 'x'], ['abc', 'Build'], ['0', 'Build'], ['-1', 'Build'], ['8x', 'Build']]) {
    assert.throws(() => card(args, deps()), UsageError, args.join(' '));
  }
});

test('card refuses a config without what it needs', () => {
  const d = deps();
  const without = (key: string) => ({ ...d, factory: () => ({ project: { ...factory.project, [key]: undefined }, options }) });
  assert.throws(() => card(['80', 'Build'], without('boardOwner')), /boardOwner/);
  assert.throws(() => card(['80', 'Build'], without('boardNumber')), /boardNumber/);
  assert.throws(() => card(['80', 'Build'], { ...d, factory: () => ({ project: factory.project }) }), /options/);
});

// Through the program, with the fake gh in place of the real one.
function dynamo(state: string, ...args: string[]) {
  return spawnSync(process.execPath, [DYNAMO, ...args], { encoding: 'utf8', env: fakeGhEnv(state) });
}
const calls = (state: string) => readFileSync(join(state, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).args as string[]);

test('dynamo card with an unknown column exits 2 and prints one JSON line, without starting gh', () => {
  const state = scratch();
  const r = dynamo(state, 'card', '80', 'Nope');
  assert.equal(r.status, 2);
  assert.equal(r.stdout.trim().split('\n').length, 1);
  assert.equal(JSON.parse(r.stdout).ok, false);
  assert.ok(!existsSync(join(state, 'calls.jsonl')), 'the fake gh was never started');
});

test('dynamo card on a card already in the column reads that one issue and exits 0', () => {
  const state = scratch();
  writeFileSync(join(state, 'answers.json'), JSON.stringify([
    { args: ['project', 'item-list'], code: 1, stderr: 'the board is never listed' },
    { args: readCall(80), stdout: view('Build').stdout },
  ]));
  const r = dynamo(state, 'card', '80', 'Build');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { ok: true, ticket: 80, column: 'Build', moved: false });
  assert.deepEqual(calls(state), [readCall(80)]);
});

test('dynamo card that cannot move the card exits 1 after trying twice', () => {
  const state = scratch();
  writeFileSync(join(state, 'answers.json'), JSON.stringify([
    { args: readCall(80), stdout: view('Todo').stdout },
    { args: moveCall(80, 'Build') },
  ]));
  const r = dynamo(state, 'card', '80', 'Build');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).ok, false);
  assert.equal(calls(state).filter((c) => c.includes('item-edit')).length, 2);
});
