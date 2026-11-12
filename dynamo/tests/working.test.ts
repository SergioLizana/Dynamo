import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { releaseBranchOf } from '../versions.ts';
import { releaseBranch } from '../working.ts';
import { git } from '../git.ts';
import { scratch } from './helpers.ts';
import type { Deps } from '../cli.ts';

// --- The pure part (versions.ts): what git printed in, the branch out.

test('releaseBranchOf is the greatest release branch above the last tag, comparing numbers (0.10.0 is after 0.9.0)', () => {
  const branches = 'release/0.3.0\nrelease/0.9.0\nrelease/0.10.0\nrelease/0.4.0\nmain\nrelease/0.10';
  assert.equal(releaseBranchOf(branches, 'v0.3.0\nv0.4.0\nv0.9.0\nnot-a-version'), 'release/0.10.0');
  assert.equal(releaseBranchOf('release/0.9.0\nrelease/0.10.0', 'v0.2.0'), 'release/0.10.0');
  assert.equal(releaseBranchOf('release/0.1.0', ''), 'release/0.1.0', 'with no tag, any release branch counts');
});

test('releaseBranchOf counts a branch of origin, and a branch below or at the last tag is not the working branch', () => {
  assert.equal(releaseBranchOf('release/0.4.0\norigin/release/0.5.0\norigin/HEAD', 'v0.4.0'), 'release/0.5.0');
  assert.equal(releaseBranchOf('release/0.5.0\norigin/release/0.5.0', 'v0.4.0'), 'release/0.5.0');
  assert.throws(() => releaseBranchOf('release/0.4.0\norigin/release/0.3.0', 'v0.4.0'), /above the last tag v0\.4\.0.*run \/dynamo:new-release <patch\|minor\|major>/);
});

test('releaseBranchOf with no branch above the last tag says which branch to create: the next minor, or release/0.1.0 with no tag', () => {
  assert.throws(() => releaseBranchOf('main\nticket/1-x', 'v0.4.2'), /run \/dynamo:new-release <patch\|minor\|major>/);
  assert.throws(() => releaseBranchOf('', ''), /above no tag.*create release\/0\.1\.0/);
});

// --- Read from git, on a temporary repository.

const run = (cwd: string, ...args: string[]) => {
  const r = git(['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd });
  assert.equal(r.code, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

function repo(): string {
  const dir = scratch();
  run(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'a.txt'), 'a');
  run(dir, 'add', '.');
  run(dir, 'commit', '-q', '-m', 'A');
  return dir;
}

const depsOf = (dir: string): Deps => ({
  gh: () => { throw new Error('the working branch does not use gh'); },
  git: (args, o) => git(args, { cwd: dir, ...o }),
  exec: () => { throw new Error('the working branch does not run programs'); },
  factory: () => { throw new Error('the working branch is not in factory.json'); },
});

test('with several release branches and tags, the greatest branch above the last tag is the working branch', () => {
  const dir = repo();
  for (const v of ['0.1.0', '0.2.0', '0.10.0', '0.9.0', '0.11.0']) run(dir, 'branch', `release/${v}`);
  for (const v of ['0.1.0', '0.2.0', '0.9.0']) run(dir, 'tag', `v${v}`);
  run(dir, 'branch', 'ticket/1-x');
  assert.equal(releaseBranch(depsOf(dir)), 'release/0.11.0');
  run(dir, 'branch', '-D', 'release/0.11.0');
  assert.equal(releaseBranch(depsOf(dir)), 'release/0.10.0');
  run(dir, 'tag', 'v0.10.0');
  assert.throws(() => releaseBranch(depsOf(dir)), /above the last tag v0\.10\.0.*run \/dynamo:new-release <patch\|minor\|major>/);
});

test('a release branch that exists only on origin counts as the working branch', () => {
  const origin = repo();
  run(origin, 'tag', 'v0.4.0');
  run(origin, 'branch', 'release/0.4.0');
  const dir = scratch();
  run(dir, 'clone', '-q', origin, '.');
  assert.throws(() => releaseBranch(depsOf(dir)), /run \/dynamo:new-release <patch\|minor\|major>/);
  run(origin, 'branch', 'release/0.5.0');
  run(dir, 'fetch', '-q', 'origin');
  assert.equal(run(dir, 'branch', '--list', 'release/0.5.0'), '', 'there is no local branch');
  assert.equal(releaseBranch(depsOf(dir)), 'release/0.5.0');
});

test('with no release branch above the last tag the error names the branch to create', () => {
  const dir = repo();
  assert.throws(() => releaseBranch(depsOf(dir)), /create release\/0\.1\.0/);
  run(dir, 'tag', 'v0.4.0');
  run(dir, 'branch', 'release/0.4.0');
  assert.throws(() => releaseBranch(depsOf(dir)), /above the last tag v0\.4\.0.*run \/dynamo:new-release <patch\|minor\|major>/);
});
