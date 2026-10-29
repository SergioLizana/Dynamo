import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UsageError } from '../cli.ts';
import { copy } from '../copy.ts';
import { branchName, copyPath, parseWorktrees, removal, refuseAdd, slug, titleOf } from '../copies.ts';
import { exec } from '../exec.ts';
import { gh } from '../gh.ts';
import { git } from '../git.ts';
import { fakeGhEnv, scratch } from './helpers.ts';
import type { Deps } from '../cli.ts';
import type { Factory } from '../factory.ts';

// --- The pure part (copies.ts): data in, data out.

test('slug is the title in lower case words joined by «-», without accents or symbols, cut at a whole word', () => {
  assert.equal(slug('dynamo: the copies of a run, one git worktree per ticket'), 'dynamo-the-copies-of-a-run-one-git');
  assert.equal(slug('  Añadir   «Árbol» de   copias!! '), 'anadir-arbol-de-copias');
  assert.equal(slug('x'.repeat(60)), 'x'.repeat(40));
  assert.equal(slug('a-b_c/d'), 'a-b-c-d');
  assert.ok(slug('word '.repeat(30)).length <= 40);
});

test('slug of a title with nothing to keep is «ticket», so a branch never ends in «-»', () => {
  for (const title of ['', '   ', '!!!', '¿?']) assert.equal(slug(title), 'ticket', title);
});

test('branchName is ticket/<n>-<slug>', () => {
  assert.equal(branchName(87, 'The copies of a run'), 'ticket/87-the-copies-of-a-run');
});

test('copyPath puts the copy of ticket n in the gitignored folder of the main folder, with forward slashes', () => {
  assert.equal(copyPath('E:\\Proyectos\\Dynamo', 87), 'E:/Proyectos/Dynamo/.claude/worktrees/ticket-87');
  assert.equal(copyPath('/home/u/repo', 7), '/home/u/repo/.claude/worktrees/ticket-7');
});

test('parseWorktrees reads git\'s porcelain list: path and branch, null for a detached one', () => {
  const text = 'worktree /r\nHEAD aaa\nbranch refs/heads/release/1\n\nworktree /r/.claude/worktrees/ticket-7\nHEAD bbb\nbranch refs/heads/ticket/7-x\n\n'
    + 'worktree /with space/w\nHEAD ccc\ndetached\n';
  assert.deepEqual(parseWorktrees(text), [
    { path: '/r', branch: 'release/1' },
    { path: '/r/.claude/worktrees/ticket-7', branch: 'ticket/7-x' },
    { path: '/with space/w', branch: null },
  ]);
  assert.deepEqual(parseWorktrees(''), []);
});

test('titleOf reads the title of gh JSON and nothing from anything else', () => {
  assert.equal(titleOf('{"title":"A title"}'), 'A title');
  for (const bad of ['{"title":""}', '{"title":3}', '{}', 'not json', '', 'null']) assert.equal(titleOf(bad), null, bad);
});

const add = { n: 7, base: 'release/1', main: 'main', branches: [], copies: [], path: '/r/.claude/worktrees/ticket-7', ignored: true };

test('refuseAdd: base is main, a branch of the ticket exists, a copy exists, folder not ignored; null when fit', () => {
  assert.equal(refuseAdd(add), null);
  assert.match(String(refuseAdd({ ...add, main: add.base })), /main branch/);
  assert.match(String(refuseAdd({ ...add, branches: ['ticket/7-a', 'ticket/7-b'] })), /ticket\/7-a, ticket\/7-b/);
  assert.equal(refuseAdd({ ...add, branches: ['ticket/77-a', 'ticket/8-a'] }), null);
  assert.match(String(refuseAdd({ ...add, copies: [{ path: add.path, branch: null }] })), /copy of ticket 7.*\.claude\/worktrees\/ticket-7/);
  assert.match(String(refuseAdd({ ...add, copies: [{ path: '/elsewhere', branch: 'ticket/7-z' }] })), /\/elsewhere/);
  assert.match(String(refuseAdd({ ...add, ignored: false })), /not ignored/);
});

const rm = { n: 7, base: 'release/1', branches: ['ticket/7-x'], copies: [{ path: '/r/c', branch: 'ticket/7-x' }], merged: ['ticket/7-x'] };

test('removal: the branch and its copy when the branch is in the working branch; only the branch when there is no copy', () => {
  assert.deepEqual(removal(rm), { branch: 'ticket/7-x', copy: '/r/c' });
  assert.deepEqual(removal({ ...rm, copies: [] }), { branch: 'ticket/7-x', copy: null });
});

test('removal keeps both and says why: not merged, no branch, more than one branch', () => {
  assert.match(String((removal({ ...rm, merged: [] }) as { why: string }).why), /ticket\/7-x is not merged into release\/1.*kept/);
  assert.match(String((removal({ ...rm, branches: [], copies: [], merged: [] }) as { why: string }).why), /nothing of ticket 7/);
  assert.match(String((removal({ ...rm, branches: [], merged: [] }) as { why: string }).why), /no ticket\/7-\* branch/);
  assert.match(String((removal({ ...rm, branches: ['ticket/7-x', 'ticket/7-y'], merged: ['ticket/7-x', 'ticket/7-y'] }) as { why: string }).why), /more than one/);
});

// --- The subcommand, on a temporary git repository and the fake gh.

const BASE = 'release/1.0.0';
const run = (cwd: string, ...args: string[]) => {
  const r = git(['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd });
  assert.equal(r.code, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

// `main` at A with the gitignore of the copies; the working branch one commit past it (B), checked out.
function repo(ignore = '.claude/worktrees/\n'): string {
  const dir = scratch();
  run(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, '.gitignore'), ignore);
  run(dir, 'add', '.');
  run(dir, 'commit', '-q', '-m', 'A');
  run(dir, 'checkout', '-q', '-b', BASE);
  writeFileSync(join(dir, 'b.txt'), 'b');
  run(dir, 'add', 'b.txt');
  run(dir, 'commit', '-q', '-m', 'B');
  return dir;
}

function deps(dir: string, title = 'The copies of a run', project: Record<string, unknown> = {}): Deps {
  const state = scratch();
  writeFileSync(join(state, 'answers.json'), JSON.stringify([{ args: ['issue', 'view'], stdout: JSON.stringify({ title }) }]));
  const env = fakeGhEnv(state);
  return {
    gh: (args, o) => gh(args, { ...o, env }),
    git: (args, o) => git(['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, ...o }),
    exec,
    factory: () => ({ project: { repo: 'o/r', mainBranch: 'main', workingBranch: BASE, doneLabel: 'in-release', checks: [], ...project } }) as Factory,
  };
}

const ticketBranchesOf = (dir: string) => run(dir, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/ticket/');
const listed = (dir: string) => run(dir, 'worktree', 'list', '--porcelain');
const snapshot = (dir: string) => ({ worktrees: listed(dir), branches: run(dir, 'branch', '--list'), status: run(dir, 'status', '--porcelain') });

test('add makes the copy at the tip of the working branch, on ticket/<n>-<slug>, and the main folder shows nothing', () => {
  const dir = repo();
  run(dir, 'checkout', '-q', 'main'); // the base moves on without the main folder being on it
  const tip = run(dir, 'rev-parse', BASE);
  const out = copy(['add', '7'], deps(dir));
  assert.equal(out.ok, true);
  assert.equal(out.branch, 'ticket/7-the-copies-of-a-run');
  assert.equal(out.base, BASE);
  const path = String(out.path);
  assert.ok(existsSync(join(path, 'b.txt')), 'the copy has the files of the base');
  assert.equal(run(path, 'rev-parse', 'HEAD'), tip);
  assert.equal(run(path, 'branch', '--show-current'), out.branch);
  assert.equal(out.commit, run(path, 'rev-parse', '--short', 'HEAD'));
  assert.match(listed(dir), /\.claude\/worktrees\/ticket-7\n/);
  assert.equal(run(dir, 'status', '--porcelain'), '');
  assert.equal(run(dir, 'branch', '--show-current'), 'main');
});

test('add works from inside a copy too: the new copy is in the folder of the main folder', () => {
  const dir = repo();
  const first = String(copy(['add', '7'], deps(dir)).path);
  const out = copy(['add', '8'], deps(first));
  assert.equal(join(String(out.path)), join(first, '..', 'ticket-8'));
});

test('add makes no copy when a branch of the ticket exists, and says which', () => {
  const dir = repo();
  run(dir, 'branch', 'ticket/7-old');
  const before = snapshot(dir);
  assert.throws(() => copy(['add', '7'], deps(dir)), /ticket\/7-old/);
  assert.deepEqual(snapshot(dir), before);
  assert.equal(existsSync(join(dir, '.claude', 'worktrees', 'ticket-7')), false);
  run(dir, 'branch', 'ticket/77-other'); // another ticket's branch is not ticket 7's
  run(dir, 'branch', '-m', 'ticket/7-old', 'ticket/8-old');
  assert.equal(copy(['add', '7'], deps(dir)).ok, true);
});

test('add makes no copy when a copy of the ticket exists, and says which', () => {
  const dir = repo();
  const path = String(copy(['add', '7'], deps(dir)).path);
  const before = snapshot(dir);
  assert.throws(() => copy(['add', '7'], deps(dir)), /ticket\/7-the-copies-of-a-run/); // its branch
  run(dir, 'worktree', 'remove', '--force', path);
  run(dir, 'branch', '-q', '-D', 'ticket/7-the-copies-of-a-run');
  run(dir, 'worktree', 'add', '-q', '--detach', path, BASE); // a copy of the ticket's folder with no branch
  const detached = snapshot(dir);
  assert.throws(() => copy(['add', '7'], deps(dir)), /copy of ticket 7.*ticket-7/);
  assert.deepEqual(snapshot(dir), detached);
  assert.notDeepEqual(before, detached);
});

test('add refuses the main branch as the base and a folder that git would show, and makes nothing', () => {
  const dir = repo();
  assert.throws(() => copy(['add', '7'], deps(dir, 'T', { workingBranch: 'main' })), /main branch/);
  const loose = repo('# nothing ignored\n');
  assert.throws(() => copy(['add', '7'], deps(loose)), /not ignored/);
  assert.equal(existsSync(join(loose, '.claude', 'worktrees')), false);
  assert.equal(ticketBranchesOf(loose), '');
});

test('add reports a ticket without a readable title, and a base that is not a branch, without leaving a copy', () => {
  const dir = repo();
  assert.throws(() => copy(['add', '7'], deps(dir, '')), /title/);
  assert.throws(() => copy(['add', '7'], deps(dir, 'T', { workingBranch: 'release/9.9.9' })), /release\/9\.9\.9/);
  assert.equal(ticketBranchesOf(dir), '');
  assert.equal(run(dir, 'worktree', 'list').split('\n').length, 1);
});

// A copy of ticket 7 with a commit, and the working branch moved on to contain it or not.
function built(): { dir: string; path: string; branch: string } {
  const dir = repo();
  const made = copy(['add', '7'], deps(dir));
  const path = String(made.path);
  writeFileSync(join(path, 't.txt'), 't');
  run(path, 'add', 't.txt');
  run(path, 'commit', '-q', '-m', 'T');
  return { dir, path, branch: String(made.branch) };
}

test('remove deletes the copy and the branch when the branch is in the working branch', () => {
  const { dir, path, branch } = built();
  run(dir, 'merge', '-q', '--no-ff', branch, '-m', 'merge');
  const out = copy(['remove', '7'], deps(dir));
  assert.deepEqual({ ok: out.ok, branch: out.branch, removedCopy: out.removedCopy }, { ok: true, branch, removedCopy: true });
  assert.equal(existsSync(path), false);
  assert.equal(ticketBranchesOf(dir), '');
  assert.equal(run(dir, 'worktree', 'list').split('\n').length, 1);
  assert.equal(run(dir, 'status', '--porcelain'), '');
});

test('remove works from the main folder on another branch than the working one', () => {
  const { dir, branch } = built();
  run(dir, 'merge', '-q', '--no-ff', branch, '-m', 'merge');
  run(dir, 'checkout', '-q', 'main');
  assert.equal(copy(['remove', '7'], deps(dir)).ok, true);
  assert.equal(ticketBranchesOf(dir), '');
});

test('remove keeps the copy and the branch when the branch is not in the working branch, and says why', () => {
  const { dir, path, branch } = built();
  const before = snapshot(dir);
  assert.throws(() => copy(['remove', '7'], deps(dir)), new RegExp(`${branch} is not merged into ${BASE.replace('.', '\\.')}.*kept`));
  assert.deepEqual(snapshot(dir), before);
  assert.ok(existsSync(join(path, 't.txt')));
});

test('remove deletes only the branch when its copy is already gone, and says there was no copy', () => {
  const { dir, path, branch } = built();
  run(dir, 'merge', '-q', '--no-ff', branch, '-m', 'merge');
  run(dir, 'worktree', 'remove', path);
  const out = copy(['remove', '7'], deps(dir));
  assert.deepEqual({ ok: out.ok, removedCopy: out.removedCopy }, { ok: true, removedCopy: false });
  assert.equal(ticketBranchesOf(dir), '');
});

test('remove keeps a copy with changes that were never committed, even if its branch is in the working branch', () => {
  const dir = repo();
  const made = copy(['add', '7'], deps(dir)); // no commit: the branch is the working branch's tip
  writeFileSync(join(String(made.path), 'work.txt'), 'the Builder\'s work');
  assert.throws(() => copy(['remove', '7'], deps(dir)), /kept/);
  assert.equal(readFileSync(join(String(made.path), 'work.txt'), 'utf8'), 'the Builder\'s work');
  assert.equal(ticketBranchesOf(dir), String(made.branch));
});

test('remove of a ticket with no branch and no copy says there is nothing, and of another ticket removes nothing', () => {
  const { dir, branch } = built();
  run(dir, 'merge', '-q', '--no-ff', branch, '-m', 'merge');
  assert.throws(() => copy(['remove', '8'], deps(dir)), /nothing of ticket 8/);
  assert.equal(ticketBranchesOf(dir), branch);
});

test('copy is called wrong: no action, an unknown one, a number that is not a ticket', () => {
  const dir = repo();
  for (const args of [[], ['add'], ['make', '7'], ['add', 'x'], ['add', '0'], ['remove', '7', '8'], ['add', '07']]) {
    assert.throws(() => copy(args, deps(dir)), UsageError, args.join(' '));
  }
});
