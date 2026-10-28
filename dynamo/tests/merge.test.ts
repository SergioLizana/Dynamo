import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UsageError } from '../cli.ts';
import { exec } from '../exec.ts';
import { gh } from '../gh.ts';
import { git } from '../git.ts';
import { merge } from '../merge.ts';
import { LOCK, hasLabel, refusal, settings, subject, ticketBranches } from '../merging.ts';
import { DYNAMO, fakeGhEnv, noGhEnv, scratch } from './helpers.ts';
import type { Deps } from '../cli.ts';
import type { Options } from '../exec.ts';
import type { Factory } from '../factory.ts';

// --- The pure part (merging.ts): data in, data out.

const s = { repo: 'o/r', base: 'release/1.0.0', main: 'main', doneLabel: 'in-release' };
const fit = { clean: true, current: 'release/1.0.0', branches: ['ticket/7-x'] };

test('settings reads repo, working and main branch and done label, and refuses a config without one', () => {
  assert.deepEqual(settings({ repo: 'o/r', workingBranch: 'release/1.0.0', mainBranch: 'main', doneLabel: 'in-release' }), s);
  for (const key of ['repo', 'workingBranch', 'mainBranch', 'doneLabel']) {
    const project: Record<string, unknown> = { repo: 'o/r', workingBranch: 'w', mainBranch: 'm', doneLabel: 'd', [key]: '' };
    assert.throws(() => settings(project), new RegExp(`project.${key}`));
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

function deps(dir: string, checks: string[], fake = fakeGh(), project: Record<string, unknown> = {}): Deps {
  return {
    gh: (args, o) => gh(args, { ...o, env: fake.env }),
    git: (args, o) => git(['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, ...o }),
    exec,
    factory: () => ({ project: { repo: 'o/r', mainBranch: 'main', workingBranch: BASE, doneLabel: 'in-release', checks, ...project } }) as Factory,
  };
}

const head = (dir: string) => run(dir, 'rev-parse', 'HEAD');
const locked = (dir: string) => git(['show-ref', '--verify', '--quiet', LOCK], { cwd: dir }).code === 0;

test('it refuses, changes nothing and frees the lock: dirty tree, wrong branch, base is main, no branch, two branches', () => {
  const cases: [string, (dir: string) => void, Record<string, unknown>, RegExp][] = [
    ['dirty', (dir) => writeFileSync(join(dir, 'b.txt'), 'changed'), {}, /not clean/],
    ['untracked', (dir) => writeFileSync(join(dir, 'new.txt'), 'n'), {}, /not clean/],
    ['wrong branch', (dir) => run(dir, 'checkout', '-q', 'main'), {}, /not on the working branch/],
    ['base is main', (dir) => run(dir, 'checkout', '-q', 'main'), { workingBranch: 'main' }, /main branch/],
    ['no branch', (dir) => run(dir, 'branch', '-q', '-m', 'ticket/7-x', 'ticket/8-x'), {}, /no ticket\/7-\* branch/],
    ['two branches', (dir) => run(dir, 'branch', '-q', 'ticket/7-x-r2', 'ticket/7-x'), {}, /more than one/],
  ];
  for (const [name, setup, project, error] of cases) {
    const dir = repo();
    setup(dir);
    const before = { head: head(dir), status: run(dir, 'status', '--porcelain'), branch: run(dir, 'branch', '--show-current') };
    const fake = fakeGh();
    assert.throws(() => merge(['7'], deps(dir, ['node pass.js'], fake, project)), error, name);
    assert.deepEqual({ head: head(dir), status: run(dir, 'status', '--porcelain'), branch: run(dir, 'branch', '--show-current') }, before, name);
    assert.equal(locked(dir), false, name);
    assert.deepEqual(fake.calls(), [], name);
  }
});

test('it merges with --no-ff and the subject, runs the checks against HEAD~1, and adds the label and reads it back', () => {
  const dir = repo();
  const before = head(dir);
  const fake = fakeGh();
  const out = merge(['7'], deps(dir, ['node pass.js', 'git rev-parse <base>'], fake));
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

test('a failed check: git revert -m 1 --no-edit HEAD, ok is false with the failing check, no label, lock freed', () => {
  const dir = repo();
  const tree = run(dir, 'rev-parse', 'HEAD^{tree}');
  const fake = fakeGh();
  const out = merge(['7'], deps(dir, ['node pass.js', 'node fail.js'], fake));
  assert.equal(out.ok, false);
  assert.deepEqual(out.failed, { command: 'node fail.js', code: 3, output: 'what failed' });
  assert.equal(out.reverted, true);
  assert.match(run(dir, 'log', '-1', '--format=%s'), /^Revert "Merge ticket\/7-x into/);
  assert.equal(run(dir, 'log', '-1', '--format=%s', 'HEAD~1'), `Merge ticket/7-x into ${BASE} (#7)`);
  assert.equal(run(dir, 'rev-parse', 'HEAD^{tree}'), tree);
  assert.equal(run(dir, 'status', '--porcelain'), '');
  assert.deepEqual(fake.calls(), []);
  assert.equal(locked(dir), false);
});

test('a branch already in the base (is-ancestor) is not merged again: only the label is done', () => {
  const dir = repo();
  run(dir, 'merge', '-q', '--no-ff', 'ticket/7-x', '-m', 'merged by hand');
  const before = head(dir);
  const fake = fakeGh();
  const out = merge(['7'], deps(dir, ['node fail.js'], fake));
  assert.equal(out.ok, true);
  assert.equal(out.merged, false);
  assert.deepEqual(out.checks, []);
  assert.equal(head(dir), before);
  assert.deepEqual(fake.calls().map((c) => c.slice(0, 2)), [['issue', 'edit'], ['issue', 'view']]);
});

test('a label that does not read back is a failure that says the branch is merged', () => {
  const dir = repo();
  assert.throws(() => merge(['7'], deps(dir, ['node pass.js'], fakeGh(['other']))), /is in release\/1\.0\.0, but the label in-release did not read back/);
  assert.equal(locked(dir), false);
});

test('a merge that conflicts is aborted and fails, leaving the base as it was', () => {
  const dir = repo();
  writeFileSync(join(dir, 't.txt'), 'other');
  run(dir, 'add', 't.txt');
  run(dir, 'commit', '-q', '-m', 'conflicting');
  const before = head(dir);
  assert.throws(() => merge(['7'], deps(dir, ['node pass.js'])), /failed \(aborted\)/);
  assert.equal(head(dir), before);
  assert.equal(run(dir, 'status', '--porcelain'), '');
  assert.equal(locked(dir), false);
});

test('a second merge while the lock is held fails and changes nothing; the lock is freed after a failure', () => {
  const dir = repo();
  run(dir, 'update-ref', LOCK, 'HEAD', '');
  const before = head(dir);
  assert.throws(() => merge(['7'], deps(dir, ['node pass.js'])), /holds the lock/);
  assert.equal(head(dir), before);
  assert.equal(locked(dir), true, 'the lock of the other merge is not taken away');
  run(dir, 'update-ref', '-d', LOCK);
  assert.equal(merge(['7'], deps(dir, ['node fail.js'])).ok, false);
  assert.equal(locked(dir), false);
  assert.equal(merge(['7'], deps(dir, ['node pass.js'])).ok, true, 'the next merge can take the lock');
});

test('wrong arguments are a usage error', () => {
  const dir = repo();
  for (const args of [[], ['x'], ['0'], ['7', '8'], ['-7']]) assert.throws(() => merge(args, deps(dir, ['node pass.js'])), UsageError, args.join(' '));
  assert.equal(locked(dir), false);
});

test('through the entry point: no arguments exits 2 with one JSON line that gives the usage', () => {
  const r = spawnSync(process.execPath, [DYNAMO, 'merge'], { encoding: 'utf8', env: noGhEnv() });
  assert.equal(r.status, 2, r.stdout);
  const lines = r.stdout.split('\n').filter((l) => l !== '');
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), { ok: false, error: 'usage: merge <n>' });
});

// --- How it is built (CLAUDE.md, «TypeScript code»).

const imports = (name: string) => [...readFileSync(join(import.meta.dirname, '..', name), 'utf8')
  .matchAll(/^import\s+(type\s+)?[^'"]*from\s*'([^']+)'/gm)].map((m) => ({ type: m[1] !== undefined, from: m[2] }));

test('the logic of the merge is pure: merging.ts imports nothing', () => {
  assert.deepEqual(imports('merging.ts').filter((i) => !i.type), []);
});

test('merge gets gh, git, exec and the config as parameters: it imports none of their modules', () => {
  const edges = ['./exec.ts', './gh.ts', './git.ts', './factory.ts', 'node:child_process', 'node:fs'];
  assert.deepEqual(imports('merge.ts').filter((i) => !i.type && edges.includes(i.from)), []);
});
