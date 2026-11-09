// The hook that refuses a write outside the working tree (hooks/outside-writes.js) only acts in a Dynamo project: a folder
// whose main git folder has `.claude/factory.json`. Each case runs the hook as Claude Code does, with the JSON on stdin.
// (The cases of what the hook refuses and allows are in hooks/outside-writes.test.js.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scratch } from './helpers.ts';

const HOOK = join(import.meta.dirname, '..', '..', 'hooks', 'outside-writes.js');
// A write that no project owns: the root of the drive, outside the temp folder too.
const OUTSIDE = 'echo x > /outside-hook-test.txt';

function hook(command: string, cwd: string) {
  return spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd }), encoding: 'utf8' });
}

// A main folder (its .git is a folder), with or without the factory.json, and a copy under .claude/worktrees/ whose .git
// is a file that names the main one, as `git worktree add` leaves it.
function project(factory: boolean) {
  const main = join(scratch(), 'main');
  const copy = join(main, '.claude', 'worktrees', 'ticket-7');
  mkdirSync(join(main, '.git', 'worktrees', 'ticket-7'), { recursive: true });
  mkdirSync(copy, { recursive: true });
  writeFileSync(join(copy, '.git'), `gitdir: ${join(main, '.git', 'worktrees', 'ticket-7').replaceAll('\\', '/')}\n`);
  if (factory) writeFileSync(join(main, '.claude', 'factory.json'), '{}');
  return { main, copy };
}

test('a project with .claude/factory.json: a write outside the tree is refused, in the main folder and in a copy', () => {
  const { main, copy } = project(true);
  for (const cwd of [main, copy]) {
    const r = hook(OUTSIDE, cwd);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /Refused/);
  }
});

test('a project with .claude/factory.json: a write inside the tree goes through, also from a copy', () => {
  const { main, copy } = project(true);
  for (const cwd of [main, copy]) assert.equal(hook('echo x > inside.txt', cwd).status, 0);
});

test('a git folder with no .claude/factory.json: nothing is refused, from the folder or from a copy', () => {
  const { main, copy } = project(false);
  for (const cwd of [main, copy]) {
    const r = hook(OUTSIDE, cwd);
    assert.equal(r.status, 0, r.stderr);
  }
});

test('no git repository: nothing is refused', () => {
  const dir = scratch();
  mkdirSync(join(dir, '.claude'));
  writeFileSync(join(dir, '.claude', 'factory.json'), '{}');
  const r = hook(OUTSIDE, dir);
  assert.equal(r.status, 0, r.stderr);
});
