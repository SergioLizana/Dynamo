// The hook that keeps a session from changing a file of the main folder while a `dynamo run` is alive
// (hooks/main-folder-lock.js): it refuses with the pid of the run, lets the copies and the scratchpad through, and
// does nothing when there is no lock or the lock is dead. Each case runs the hook as Claude Code does, with the JSON on stdin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scratch } from './helpers.ts';

const HOOK = join(import.meta.dirname, '..', '..', 'hooks', 'main-folder-lock.js');

type Lock = { pid: number; ageMs: number } | null;

// A main folder (its .git is a folder) with a copy under .claude/worktrees/ (its .git is a file that names the main one),
// and the run lock written as `lock` says.
function project(lock: Lock) {
  const root = scratch();
  const main = join(root, 'main');
  const copy = join(main, '.claude', 'worktrees', 'ticket-7');
  mkdirSync(join(main, '.git', 'worktrees', 'ticket-7'), { recursive: true });
  mkdirSync(copy, { recursive: true });
  writeFileSync(join(copy, '.git'), `gitdir: ${join(main, '.git', 'worktrees', 'ticket-7').replace(/\\/g, '/')}\n`);
  if (lock) {
    const beat = new Date(Date.now() - lock.ageMs).toISOString();
    writeFileSync(join(main, '.claude', 'worktrees', 'run.json'), JSON.stringify({ pid: lock.pid, since: beat, heartbeat: beat }));
  }
  const pad = join(root, 'pad');
  mkdirSync(pad);
  return { main, copy, pad };
}

function hook(tool_name: string, tool_input: Record<string, string>, cwd: string) {
  return spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name, tool_input, cwd }), encoding: 'utf8' });
}

// The pid of a process that has already ended.
const deadPid = () => Number(spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']).stdout.toString());
const live: Lock = { pid: process.pid, ageMs: 1000 };

test('a live run: Edit, Write and a Bash write in the main folder are refused, naming the pid and why', () => {
  const { main } = project(live);
  const file = join(main, 'README.md');
  const refused = [
    hook('Edit', { file_path: file, old_string: 'a', new_string: 'b' }, main),
    hook('Write', { file_path: file, content: 'x' }, main),
    hook('NotebookEdit', { notebook_path: file }, main),
    hook('Bash', { command: 'echo x > README.md' }, main),
    hook('Bash', { command: `touch ${file.replace(/\\/g, '/')}` }, main),
    hook('Bash', { command: 'rm -f dynamo/run.ts' }, main),
  ];
  for (const r of refused) {
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, new RegExp(`pid ${process.pid}\\b`));
    assert.match(r.stderr, /dynamo run/);
    assert.match(r.stderr, /wait/i);
  }
});

test('a live run: a write inside a copy under .claude/worktrees/ or in the scratchpad goes through', () => {
  const { main, copy, pad } = project(live);
  const file = join(copy, 'a.txt');
  const through = [
    hook('Edit', { file_path: file, old_string: 'a', new_string: 'b' }, copy),
    hook('Write', { file_path: file, content: 'x' }, copy),
    hook('Write', { file_path: join(pad, 'a.txt'), content: 'x' }, main),
    hook('Bash', { command: 'echo x > a.txt' }, copy),
    hook('Bash', { command: `touch ${join(copy, 'b.txt').replace(/\\/g, '/')}` }, main),
    hook('Bash', { command: `cp README.md ${join(pad, 'c.txt').replace(/\\/g, '/')}` }, main),
    hook('Bash', { command: 'git status' }, main),
    hook('Bash', { command: 'cat README.md' }, main),
  ];
  for (const r of through) assert.equal(r.status, 0, r.stderr);
});

test('no lock, a dead pid or an old heartbeat: nothing is refused', () => {
  for (const lock of [null, { pid: deadPid(), ageMs: 1000 }, { pid: process.pid, ageMs: 10 * 60_000 }]) {
    const { main } = project(lock);
    assert.equal(hook('Write', { file_path: join(main, 'README.md'), content: 'x' }, main).status, 0);
    assert.equal(hook('Bash', { command: 'echo x > README.md' }, main).status, 0);
  }
});
