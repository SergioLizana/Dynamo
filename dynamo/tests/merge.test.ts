import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UsageError } from '../cli.ts';
import { execAsync } from '../exec.ts';
import { gh } from '../gh.ts';
import { git } from '../git.ts';
import { merge } from '../merge.ts';
import { LOCK, hasLabel, refusal, settings, stopReason, subject, ticketBranches } from '../merging.ts';
import { DYNAMO, fakeGhEnv, noGhEnv, scratch } from './helpers.ts';
import type { Deps } from '../cli.ts';
import type { Options } from '../exec.ts';
import type { Factory } from '../factory.ts';

// --- The pure part (merging.ts): data in, data out.

const s = { repo: 'o/r', base: 'release/1.0.0', main: 'main', doneLabel: 'in-release' };
const fit = { clean: true, current: 'release/1.0.0', branches: ['ticket/7-x'] };

test('settings reads repo, main branch and done label, takes the working branch it is given and refuses a config without one', () => {
  assert.deepEqual(settings({ repo: 'o/r', mainBranch: 'main', doneLabel: 'in-release' }, 'release/1.0.0'), s);
  for (const key of ['repo', 'mainBranch', 'doneLabel']) {
    const project: Record<string, unknown> = { repo: 'o/r', mainBranch: 'm', doneLabel: 'd', [key]: '' };
    assert.throws(() => settings(project, 'w'), new RegExp(`project.${key}`));
  }
});

test('ticketBranches keeps only ticket/<n>-<slug>: not another ticket whose number starts the same', () => {
  assert.deepEqual(ticketBranches(['ticket/7-a', 'ticket/77-b', 'ticket/7-', 'ticket/7', 'main', 'ticket/7-a-r2'], 7), ['ticket/7-a', 'ticket/7-a-r2']);
  assert.deepEqual(ticketBranches([''], 7), []);
});

test('refusal: base is main, a dirty tree, another branch, no ticket branch, more than one; null when fit', () => {
  assert.equal(refusal(s, fit, 7), null);
  assert.match(String(refusal({ ...s, main: s.base }, fit, 7)), /main branch/);
  assert.match(String(refusal(s, { ...fit, clean: false }, 7)), /not clean/);
  assert.match(String(refusal(s, { ...fit, current: 'main' }, 7)), /on main, not on the working branch/);
  assert.match(String(refusal(s, { ...fit, branches: [] }, 7)), /no ticket\/7-\* branch/);
  assert.match(String(refusal(s, { ...fit, branches: ['ticket/7-a', 'ticket/7-b'] }, 7)), /more than one.*ticket\/7-a, ticket\/7-b/);
});

test('subject is «Merge <branch> into <base> (#n)»; hasLabel finds the label in gh JSON and nothing in anything else', () => {
  assert.equal(subject('ticket/7-x', 'release/1.0.0', 7), 'Merge ticket/7-x into release/1.0.0 (#7)');
  assert.equal(hasLabel('{"labels":[{"name":"a"},{"name":"in-release"}]}', 'in-release'), true);
  for (const bad of ['{"labels":[{"name":"a"}]}', '{"labels":"in-release"}', 'not json', '', 'null']) assert.equal(hasLabel(bad, 'in-release'), false, bad);
});

// --- The subcommand, on a temporary git repository and the fake gh.

const BASE = 'release/1.0.0';
const run = (cwd: string, ...args: string[]) => {
  const r = git(['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd });
  assert.equal(r.code, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

// `main` at A; the working branch one commit past it (B), checked out; `ticket/7-x` from B with one commit (T).
function repo(): string {
  const dir = scratch();
  run(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'pass.js'), '');
  writeFileSync(join(dir, 'fail.js'), "console.log('what failed'); process.exit(3);");
  // Never ends, and neither does the child it starts: a test that hangs.
  writeFileSync(join(dir, 'hang.cjs'), [
    "const { spawn } = require('node:child_process');",
    "spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
    'setInterval(() => {}, 1000);',
  ].join('\n'));
  run(dir, 'add', '.');
  run(dir, 'commit', '-q', '-m', 'A');
  run(dir, 'checkout', '-q', '-b', BASE);
  writeFileSync(join(dir, 'b.txt'), 'b');
  run(dir, 'add', 'b.txt');
  run(dir, 'commit', '-q', '-m', 'B');
  run(dir, 'checkout', '-q', '-b', 'ticket/7-x');
  writeFileSync(join(dir, 't.txt'), 't');
  run(dir, 'add', 't.txt');
  run(dir, 'commit', '-q', '-m', 'T');
  run(dir, 'checkout', '-q', BASE);
  return dir;
}

// The fake gh answers the label edit, and the read-back with `labels` (by default with the done label).
function fakeGh(labels = ['in-release']): { env: Options['env']; calls: () => string[][] } {
  const state = scratch();
  writeFileSync(join(state, 'answers.json'), JSON.stringify([
    { args: ['issue', 'edit'], stdout: '' },
    { args: ['issue', 'view'], stdout: JSON.stringify({ labels: labels.map((name) => ({ name })) }) },
  ]));
  const calls = () => {
    try { return readFileSync(join(state, 'calls.jsonl'), 'utf8').trim().split('\n').filter((l) => l).map((l) => JSON.parse(l).args); } catch { return []; }
  };
  return { env: fakeGhEnv(state), calls };
}

function deps(dir: string, checks: string[], fake = fakeGh(), project: Record<string, unknown> = {}, limit: unknown = 5): Deps {
  return {
    gh: (args, o) => gh(args, { ...o, env: fake.env }),
    git: (args, o) => git(['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, ...o }),
    exec: execAsync,
    factory: () => ({ project: { repo: 'o/r', mainBranch: 'main', doneLabel: 'in-release', checks, checkTimeoutMinutes: limit, ...project } }) as Factory,
  };
}

const head = (dir: string) => run(dir, 'rev-parse', 'HEAD');
const locked = (dir: string) => git(['show-ref', '--verify', '--quiet', LOCK], { cwd: dir }).code === 0;

test('it refuses, changes nothing and frees the lock: dirty tree, wrong branch, no branch, two branches', async () => {
  const cases: [string, (dir: string) => void, Record<string, unknown>, RegExp][] = [
    ['dirty', (dir) => writeFileSync(join(dir, 'b.txt'), 'changed'), {}, /not clean/],
    ['untracked', (dir) => writeFileSync(join(dir, 'new.txt'), 'n'), {}, /not clean/],
    ['wrong branch', (dir) => run(dir, 'checkout', '-q', 'main'), {}, /not on the working branch/],
    ['no branch', (dir) => run(dir, 'branch', '-q', '-m', 'ticket/7-x', 'ticket/8-x'), {}, /no ticket\/7-\* branch/],
    ['two branches', (dir) => run(dir, 'branch', '-q', 'ticket/7-x-r2', 'ticket/7-x'), {}, /more than one/],
  ];
  for (const [name, setup, project, error] of cases) {
    const dir = repo();
    setup(dir);
    const before = { head: head(dir), status: run(dir, 'status', '--porcelain'), branch: run(dir, 'branch', '--show-current') };
    const fake = fakeGh();
    await assert.rejects(() => merge(['7'], deps(dir, ['node pass.js'], fake, project)), error, name);
    assert.deepEqual({ head: head(dir), status: run(dir, 'status', '--porcelain'), branch: run(dir, 'branch', '--show-current') }, before, name);
    assert.equal(locked(dir), false, name);
    assert.deepEqual(fake.calls(), [], name);
  }
});

test('it merges with --no-ff and the subject, runs the checks against HEAD~1, and adds the label and reads it back', async () => {
  const dir = repo();
  const before = head(dir);
  const fake = fakeGh();
  const out = await merge(['7'], deps(dir, ['node pass.js', 'git rev-parse <base>'], fake));
  assert.equal(out.ok, true);
  assert.equal(out.merged, true);
  assert.equal(run(dir, 'log', '-1', '--format=%s'), `Merge ticket/7-x into ${BASE} (#7)`);
  assert.equal(run(dir, 'rev-parse', 'HEAD^1'), before);
  assert.equal(run(dir, 'rev-parse', 'HEAD^2'), run(dir, 'rev-parse', 'ticket/7-x'));
  assert.deepEqual(out.checks, [
    { command: 'node pass.js', code: 0, output: '' },
    { command: 'git rev-parse <base>', code: 0, output: before },
  ]);
  assert.equal(out.head, run(dir, 'rev-parse', '--short', 'HEAD'));
  assert.deepEqual(fake.calls(), [
    ['issue', 'edit', '7', '-R', 'o/r', '--add-label', 'in-release'],
    ['issue', 'view', '7', '-R', 'o/r', '--json', 'labels'],
  ]);
  assert.equal(locked(dir), false);
});

const copies = (dir: string) => run(dir, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree '));
const inBase = (dir: string) => git(['merge-base', '--is-ancestor', 'ticket/7-x', BASE], { cwd: dir }).code === 0;

test('a passing check moves the working branch to the merge by fast-forward, from a copy that is gone afterwards', async () => {
  const dir = repo();
  const before = head(dir);
  const out = await merge(['7'], deps(dir, ['node pass.js']));
  assert.equal(out.ok, true);
  const tip = run(dir, 'rev-parse', 'HEAD');
  assert.equal(run(dir, 'rev-parse', BASE), tip, 'the working branch is at the merge');
  run(dir, 'merge-base', '--is-ancestor', before, tip);
  assert.equal(run(dir, 'rev-parse', 'HEAD^1'), before, 'a fast-forward: the old tip is the first parent of the merge');
  assert.equal(run(dir, 'status', '--porcelain'), '');
  assert.equal(copies(dir).length, 1, 'the copy of the merge was removed');
});

test('the merge and its checks run in a copy, not in the main folder', async () => {
  const dir = repo();
  writeFileSync(join(dir, 'where.js'), "const { basename, dirname } = require('node:path'); process.exit(basename(dirname(process.cwd())) === 'worktrees' && require('node:fs').existsSync('t.txt') ? 0 : 4);");
  run(dir, 'add', 'where.js');
  run(dir, 'commit', '-q', '-m', 'where');
  // t.txt is only in the merge, so the check passes only if it ran where the merge is, and the main folder has no t.txt yet.
  assert.equal((await merge(['7'], deps(dir, ['node where.js']))).ok, true);
});

test('a failed check leaves the working branch where it was, with no revert commit; the ticket is not merged', async () => {
  const dir = repo();
  const before = head(dir);
  const fake = fakeGh();
  const out = await merge(['7'], deps(dir, ['node pass.js', 'node fail.js'], fake));
  assert.equal(out.ok, false);
  assert.deepEqual(out.failed, { command: 'node fail.js', code: 3, output: 'what failed' });
  assert.equal(out.reverted, undefined);
  assert.equal(out.conflict, undefined);
  assert.equal(head(dir), before);
  assert.equal(run(dir, 'rev-parse', BASE), before);
  assert.equal(run(dir, 'log', '--format=%s', '--grep=^Revert').trim(), '');
  assert.equal(inBase(dir), false);
  assert.equal(run(dir, 'status', '--porcelain'), '');
  assert.equal(copies(dir).length, 1, 'the copy of the merge was removed');
  assert.deepEqual(fake.calls(), []);
  assert.equal(locked(dir), false);
});

test('a check past checkTimeoutMinutes fails with «timed out after N min»: the working branch stays, as with any failed check', async () => {
  const dir = repo();
  const before = head(dir);
  const fake = fakeGh();
  const out = await merge(['7'], deps(dir, ['node pass.js', 'node hang.cjs'], fake, {}, 0.02));
  assert.equal(out.ok, false);
  const failed = out.failed as { command: string; code: number; output: string };
  assert.equal(failed.command, 'node hang.cjs');
  assert.notEqual(failed.code, 0);
  assert.match(failed.output, /timed out after 0\.02 min/);
  assert.match(stopReason(1, out), /timed out after 0\.02 min/);
  assert.equal(run(dir, 'rev-parse', BASE), before);
  assert.equal(inBase(dir), false);
  assert.equal(copies(dir).length, 1, 'the copy of the merge was removed');
  assert.deepEqual(fake.calls(), []);
  assert.equal(locked(dir), false);
});

test('a missing or invalid checkTimeoutMinutes is an error: nothing is merged and the lock is not left', async () => {
  for (const bad of [null, 0, '15']) { // null: a default parameter would turn undefined into the good value
    const dir = repo();
    const before = head(dir);
    const fake = fakeGh();
    await assert.rejects(() => merge(['7'], deps(dir, ['node pass.js'], fake, {}, bad)), /project.checkTimeoutMinutes/, String(bad));
    assert.equal(head(dir), before);
    assert.equal(inBase(dir), false);
    assert.deepEqual(fake.calls(), []);
    assert.equal(locked(dir), false);
  }
});

test('the same merge can be run again after a failed check, and merges when the check passes', async () => {
  const dir = repo();
  const before = head(dir);
  assert.equal((await merge(['7'], deps(dir, ['node fail.js']))).ok, false);
  assert.equal((await merge(['7'], deps(dir, ['node fail.js']))).ok, false, 'again, the same failure and still nothing moved');
  assert.equal(head(dir), before);
  const out = await merge(['7'], deps(dir, ['node pass.js']));
  assert.equal(out.ok, true);
  assert.equal(out.merged, true);
  assert.equal(inBase(dir), true);
});

test('a working branch that moved while the check ran cannot fast-forward: it stops with a message, nothing merged, no label', async () => {
  const dir = repo();
  // The check moves the working branch itself, from the main folder, as another commit would.
  writeFileSync(join(dir, 'move.js'), `require('node:child_process').spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-C', ${JSON.stringify(dir)}, 'commit', '--allow-empty', '-q', '-m', 'moved']);`);
  run(dir, 'add', 'move.js');
  run(dir, 'commit', '-q', '-m', 'mover');
  const fake = fakeGh();
  await assert.rejects(() => merge(['7'], deps(dir, ['node move.js'], fake)), new RegExp(`cannot fast-forward ${BASE.replace('.', '\\.')}`));
  assert.equal(run(dir, 'log', '-1', '--format=%s'), 'moved');
  assert.equal(inBase(dir), false);
  assert.equal(run(dir, 'status', '--porcelain'), '');
  assert.equal(copies(dir).length, 1);
  assert.deepEqual(fake.calls(), []);
  assert.equal(locked(dir), false);
});

test('stopReason names the check that failed, the conflict apart from it, and keeps any other output whole', () => {
  const failed = { command: 'node --test dynamo/tests/', code: 1, output: 'tests 3 fail 1' };
  const check = stopReason(1, { ok: false, branch: 'ticket/7-x', base: 'release/1.0.0', failed });
  assert.match(check, /check `node --test dynamo\/tests\/` failed \(exit 1\) after the merge of ticket\/7-x/);
  assert.match(check, /tests 3 fail 1/);
  assert.match(check, /release\/1\.0\.0 was not moved/);
  const clash = stopReason(1, { ok: false, branch: 'ticket/7-x', base: 'release/1.0.0', conflict: true, files: ['t.txt'], output: 'CONFLICT' });
  assert.match(clash, /conflicts with release\/1\.0\.0 in t\.txt/);
  assert.doesNotMatch(clash, /check/);
  assert.equal(stopReason(1, { ok: false, error: 'boom' }), 'dynamo merge exited 1: {"ok":false,"error":"boom"}');
});

test('a branch already in the base (is-ancestor) is not merged again: with the label there, nothing is written', async () => {
  const dir = repo();
  run(dir, 'merge', '-q', '--no-ff', 'ticket/7-x', '-m', 'merged by hand');
  const before = head(dir);
  const fake = fakeGh();
  const out = await merge(['7'], deps(dir, ['node fail.js'], fake));
  assert.equal(out.ok, true);
  assert.equal(out.merged, false);
  assert.deepEqual(out.checks, []);
  assert.equal(head(dir), before);
  assert.deepEqual(fake.calls().map((c) => c.slice(0, 2)), [['issue', 'view']]);
});

test('a branch already in the base without the label gets the label: it is read, added and read back', async () => {
  const dir = repo();
  run(dir, 'merge', '-q', '--no-ff', 'ticket/7-x', '-m', 'merged by hand');
  const fake = fakeGh(['other']);
  await assert.rejects(() => merge(['7'], deps(dir, ['node fail.js'], fake)), /did not read back/);
  assert.deepEqual(fake.calls().map((c) => c.slice(0, 2)), [['issue', 'view'], ['issue', 'edit'], ['issue', 'view']]);
});

test('a label that does not read back is a failure that says the branch is merged', async () => {
  const dir = repo();
  await assert.rejects(() => merge(['7'], deps(dir, ['node pass.js'], fakeGh(['other']))), /is in release\/1\.0\.0, but the label in-release did not read back/);
  assert.equal(locked(dir), false);
});

test('a conflict is reported apart from a failed check: the files, no checks run, the working branch as it was', async () => {
  const dir = repo();
  writeFileSync(join(dir, 't.txt'), 'other');
  run(dir, 'add', 't.txt');
  run(dir, 'commit', '-q', '-m', 'conflicting');
  const before = head(dir);
  const out = await merge(['7'], deps(dir, ['node fail.js']));
  assert.equal(out.ok, false);
  assert.equal(out.conflict, true);
  assert.deepEqual(out.files, ['t.txt']);
  assert.equal(out.failed, undefined, 'the check did not run');
  assert.equal(head(dir), before);
  assert.equal(run(dir, 'status', '--porcelain'), '');
  assert.equal(copies(dir).length, 1);
  assert.equal(locked(dir), false);
});

test('a second merge while the lock is held fails and changes nothing; the lock is freed after a failure', async () => {
  const dir = repo();
  run(dir, 'update-ref', LOCK, 'HEAD', '');
  const before = head(dir);
  await assert.rejects(() => merge(['7'], deps(dir, ['node pass.js'])), /holds the lock/);
  assert.equal(head(dir), before);
  assert.equal(locked(dir), true, 'the lock of the other merge is not taken away');
  run(dir, 'update-ref', '-d', LOCK);
  assert.equal((await merge(['7'], deps(dir, ['node fail.js']))).ok, false);
  assert.equal(locked(dir), false);
  assert.equal((await merge(['7'], deps(dir, ['node pass.js']))).ok, true, 'the next merge can take the lock');
});

// --- The checks of a merge whose tree is the one Verify passed are not run again.

const tipOf = (dir: string) => run(dir, 'rev-parse', 'ticket/7-x');

test('a merge whose tree is the tree of the commit Verify passed runs no check, moves the working branch and says why', async () => {
  const dir = repo();
  const before = head(dir);
  const fake = fakeGh();
  // fail.js would fail the merge if it ran: the merge passes only because it was skipped.
  const out = await merge(['7', '--verified', tipOf(dir)], deps(dir, ['node fail.js'], fake));
  assert.equal(out.ok, true);
  assert.equal(out.merged, true);
  assert.deepEqual(out.checks, []);
  assert.match(String(out.skipped), /checks were not run/);
  assert.match(String(out.skipped), new RegExp(`tree of ${tipOf(dir).slice(0, 7)}.*Verify passed`));
  assert.notEqual(head(dir), before);
  assert.equal(run(dir, 'rev-parse', BASE), head(dir), 'the working branch moved to the merge');
  assert.equal(run(dir, 'rev-parse', 'HEAD^1'), before);
  assert.equal(inBase(dir), true);
  assert.equal(locked(dir), false);
});

test('a working branch that moved after Verify (the trees differ) runs every check as today', async () => {
  const dir = repo();
  const verified = tipOf(dir);
  writeFileSync(join(dir, 'later.txt'), 'later');
  run(dir, 'add', 'later.txt');
  run(dir, 'commit', '-q', '-m', 'later');
  const before = head(dir);
  const failing = await merge(['7', '--verified', verified], deps(dir, ['node pass.js', 'node fail.js']));
  assert.equal(failing.ok, false);
  assert.deepEqual(failing.failed, { command: 'node fail.js', code: 3, output: 'what failed' });
  assert.equal(head(dir), before);
  const out = await merge(['7', '--verified', verified], deps(dir, ['node pass.js', 'git rev-parse <base>']));
  assert.equal(out.ok, true);
  assert.equal(out.skipped, undefined);
  assert.deepEqual(out.checks, [{ command: 'node pass.js', code: 0, output: '' }, { command: 'git rev-parse <base>', code: 0, output: before }]);
});

test('with no record of what Verify passed (a merge by hand), or one that names no commit, the checks run', async () => {
  const dir = repo();
  const failing = await merge(['7'], deps(dir, ['node fail.js']));
  assert.equal(failing.ok, false);
  assert.deepEqual(failing.failed, { command: 'node fail.js', code: 3, output: 'what failed' });
  const unknown = await merge(['7', '--verified', 'deadbeef'], deps(dir, ['node fail.js']));
  assert.equal(unknown.ok, false, 'a sha that is not a commit of the repository proves nothing');
  const out = await merge(['7'], deps(dir, ['node pass.js']));
  assert.equal(out.ok, true);
  assert.equal(out.skipped, undefined);
  assert.equal((out.checks as unknown[]).length, 1);
});

test('wrong arguments are a usage error', async () => {
  const dir = repo();
  for (const args of [[], ['x'], ['0'], ['7', '8'], ['-7'], ['7', '--verified'], ['7', '--verified', 'xyz'], ['7', '--seen', 'abcdef1'], ['7', '--verified', 'abcdef1', 'x']]) await assert.rejects(() => merge(args, deps(dir, ['node pass.js'])), UsageError, args.join(' '));
  assert.equal(locked(dir), false);
});

test('through the entry point: no arguments exits 2 with one JSON line that gives the usage', () => {
  const r = spawnSync(process.execPath, [DYNAMO, 'merge'], { encoding: 'utf8', env: noGhEnv() });
  assert.equal(r.status, 2, r.stdout);
  const lines = r.stdout.split('\n').filter((l) => l !== '');
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), { ok: false, error: 'usage: merge <n> [--verified <sha>]' });
});

test('two merges asked together in one process wait for each other: the second does not find the lock taken', async () => {
  const dir = repo();
  const fake = fakeGh();
  const [first, second] = await Promise.all([merge(['7'], deps(dir, ['node pass.js'], fake)), merge(['7'], deps(dir, ['node pass.js'], fake))]);
  assert.equal(first.ok, true);
  assert.deepEqual([second.ok, second.merged], [true, false], 'the second finds the branch already merged');
  assert.equal(locked(dir), false);
});
