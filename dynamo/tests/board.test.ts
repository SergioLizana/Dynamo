import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { board } from '../board.ts';
import { UsageError } from '../cli.ts';
import { readFactory } from '../factory.ts';
import type { Deps } from '../cli.ts';
import type { Result } from '../exec.ts';
import { DYNAMO, fakeGhEnv, scratch } from './helpers.ts';

const factory = readFactory();
const project = factory.project as Record<string, unknown>;
const needsHuman = String((factory.columns as Record<string, unknown>).needsHuman);
const conn = (nodes: unknown[]) => ({ totalCount: nodes.length, nodes });
const node = (number: number, column: string, blockers: unknown[] = []) => ({
  number, title: `t${number}`, state: 'OPEN', labels: conn([]),
  projectItems: conn([{ project: { id: project.boardId }, fieldValues: conn([{ name: column, field: { id: project.statusFieldId } }]) }]),
  blockedBy: conn(blockers),
});
const answer = (repository: unknown) => JSON.stringify({ data: { repository } });

function deps(...answers: Result[]): Deps & { calls: string[][] } {
  const calls: string[][] = [];
  const gh = (args: string[]): Result => { calls.push(args); return answers.shift() ?? { code: 1, stdout: '', stderr: 'no answer' }; };
  const git = (): Result => { throw new Error('board does not use git'); };
  const exec = (): Result => { throw new Error('board does not run programs'); };
  return { gh, git, exec, factory: () => factory, calls };
}

test('board prints, for each ticket, number, title, column, done label, blockers, ready and why not', () => {
  const blocker = { number: 3, state: 'OPEN', labels: conn([]) };
  const d = deps({ code: 0, stderr: '', stdout: answer({ t5: node(5, 'Todo', [blocker]), t6: node(6, 'Todo') }) });
  const out = board(['6', '5', '6'], d);
  assert.deepEqual(out, { ok: true, tickets: [
    { number: 5, title: 't5', state: 'OPEN', column: 'Todo', doneLabel: false, blockers: [{ number: 3, state: 'OPEN', doneLabel: false }],
      ready: false, why: 'blocker not done: #3' },
    { number: 6, title: 't6', state: 'OPEN', column: 'Todo', doneLabel: false, blockers: [], ready: true, why: null },
  ] });
  assert.equal(d.calls.length, 1);
});

test('board takes the repository, the board and the columns from the config it is given', () => {
  const d = deps({ code: 0, stderr: '', stdout: answer({ t5: node(5, needsHuman) }) });
  const out = board(['5'], d);
  const [owner, name] = String(project.repo).split('/');
  assert.ok(d.calls[0].includes(`owner=${owner}`) && d.calls[0].includes(`name=${name}`));
  assert.match(JSON.stringify(out), new RegExp(`"why":"in ${needsHuman}"`));
});

test('board refuses an argument that is not a ticket number as a usage error', () => {
  for (const bad of ['abc', '0', '-1', '5x']) assert.throws(() => board([bad], deps()), UsageError, bad);
});

test('board refuses a config without what it needs', () => {
  const d = deps();
  assert.throws(() => board(['5'], { ...d, factory: () => ({ project: { ...factory.project, boardId: undefined } }) }), /boardId/);
});

// The whole program, with the fake gh as a process: it fails every call it has no answer for, and `project item-list` on
// purpose, so a read of the board would show.
function dynamo(answers: unknown[], ...args: string[]) {
  const state = scratch();
  writeFileSync(join(state, 'answers.json'), JSON.stringify([
    { args: ['project', 'item-list'], code: 1, stderr: 'fake gh: the board must never be listed' }, ...answers,
  ]));
  const r = spawnSync(process.execPath, [DYNAMO, 'board', ...args], { encoding: 'utf8', env: fakeGhEnv(state) });
  const log = join(state, 'calls.jsonl');
  const calls = (existsSync(log) ? readFileSync(log, 'utf8') : '').split('\n').filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l).args as string[]);
  const lines = r.stdout.split('\n').filter((l) => l !== '');
  assert.equal(lines.length, 1, `one line, got: ${r.stdout}${r.stderr}`);
  return { code: r.status, out: JSON.parse(lines[0]), calls };
}

test('dynamo board with numbers reads only those issues and never lists the board', () => {
  const r = dynamo([{ args: ['api', 'graphql'], stdout: answer({ t5: node(5, 'Todo') }) }], '5');
  assert.equal(r.code, 0);
  assert.deepEqual(r.out.tickets.map((t: { number: number }) => t.number), [5]);
  assert.equal(r.calls.length, 1);
  assert.match(r.calls[0].join(' '), /t5:issue\(number:5\)/);
  assert.ok(!r.calls.some((a) => a[0] === 'project'));
});

test('dynamo board without numbers reads only the open issues and never lists the board', () => {
  const page = { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [node(1, 'Todo'), node(2, 'Done')] } };
  const r = dynamo([{ args: ['api', 'graphql'], stdout: answer(page) }]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.out.tickets.map((t: { number: number }) => t.number), [1, 2]);
  assert.match(r.calls[0].join(' '), /issues\(states:OPEN/);
  assert.ok(!r.calls.some((a) => a[0] === 'project'));
});

test('dynamo board exits non-zero with the reason when gh fails', () => {
  const r = dynamo([{ args: ['api', 'graphql'], code: 1, stderr: 'HTTP 502: Bad Gateway' }], '5');
  assert.equal(r.code, 1);
  assert.equal(r.out.ok, false);
  assert.match(r.out.error, /HTTP 502: Bad Gateway/);
});

test('dynamo board exits 2 when called wrong', () => {
  const r = dynamo([], 'abc');
  assert.equal(r.code, 2);
  assert.equal(r.out.ok, false);
  assert.match(r.out.error, /abc is not a ticket number/);
  assert.deepEqual(r.calls, []);
});
