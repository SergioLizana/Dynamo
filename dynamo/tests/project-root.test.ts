// The engine works on the project it is run in, not on the folder it lives in (inside a plugin that is the cache): the main
// folder of the current directory gives `factory.json` and the logs. A project here is a scratch folder with a `.git`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectRoot } from '../factory.ts';
import { DYNAMO, fakeGhEnv, scratch } from './helpers.ts';

// A main folder (its .git is a folder) with a factory.json of `repo`, one ticket log, and a copy under .claude/worktrees/
// (its .git is a file that names the main one). `inner` is a subfolder of the main one.
function project(repo: string) {
  const main = join(scratch(), 'main');
  const copy = join(main, '.claude', 'worktrees', 'ticket-7');
  const inner = join(main, 'src', 'deep');
  mkdirSync(join(main, '.git', 'worktrees', 'ticket-7'), { recursive: true });
  mkdirSync(copy, { recursive: true });
  mkdirSync(inner, { recursive: true });
  writeFileSync(join(copy, '.git'), `gitdir: ${join(main, '.git', 'worktrees', 'ticket-7').replaceAll('\\', '/')}\n`);
  writeFileSync(join(main, '.claude', 'factory.json'), JSON.stringify({ version: 1, project: { repo, mainBranch: 'main', checks: [] } }));
  mkdirSync(join(main, '.claude', 'worktrees', 'logs', '7'), { recursive: true });
  writeFileSync(join(main, '.claude', 'worktrees', 'logs', '7', 'steps.jsonl'), `${JSON.stringify({ at: 't', round: 1, step: 'column', column: 'Build' })}\n`);
  return { main, copy, inner };
}

// Runs dynamo with `cwd` as the current folder; the fake gh answers and records its calls.
function dynamo(cwd: string, ...args: string[]) {
  const ghState = scratch();
  const r = spawnSync(process.execPath, [DYNAMO, ...args], { cwd, encoding: 'utf8', env: fakeGhEnv(ghState) });
  let calls = '';
  try { calls = readFileSync(join(ghState, 'calls.jsonl'), 'utf8'); } catch { /* no gh call */ }
  return { ...r, out: JSON.parse(r.stdout.split('\n')[0]), calls };
}

test('projectRoot is the main folder from the main folder, from a folder inside it and from a copy', () => {
  const { main, copy, inner } = project('o/r');
  assert.equal(projectRoot(main), main);
  assert.equal(projectRoot(inner), main);
  assert.equal(projectRoot(copy), main);
  assert.equal(projectRoot(join(copy, '..')), main);
});

test('projectRoot says so when the folder is in no repository', () => {
  assert.throws(() => projectRoot(scratch()), /not inside a git repository/);
});

test('run from a folder other than the engine\'s project, dynamo reads the factory.json of the project it is in', () => {
  const { main, inner } = project('scratch-owner/scratch-project');
  const body = join(scratch(), 'body.md');
  writeFileSync(body, 'text');
  for (const cwd of [main, inner]) {
    const r = dynamo(cwd, 'comment', '7', '--body-file', body);
    assert.match(r.calls, /scratch-owner\/scratch-project/, cwd);
  }
});

test('run from a copy, dynamo takes the main folder of the project: its factory.json', () => {
  const { copy } = project('copy-owner/copy-project');
  const body = join(scratch(), 'body.md');
  writeFileSync(body, 'text');
  assert.match(dynamo(copy, 'comment', '7', '--body-file', body).calls, /copy-owner\/copy-project/);
});

test('dynamo status finds the logs of the project it is run in, from the main folder and from a copy', () => {
  const { main, copy, inner } = project('o/r');
  for (const cwd of [main, inner, copy]) {
    const r = dynamo(cwd, 'status', '--json');
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.out.rows.map((x: { ticket: number }) => x.ticket), [7], cwd);
  }
});
