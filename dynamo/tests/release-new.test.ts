import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UsageError } from '../cli.ts';
import { execAsync } from '../exec.ts';
import { gh } from '../gh.ts';
import { git } from '../git.ts';
import { release } from '../release.ts';
import { releaseNew } from '../release-new.ts';
import { scratch } from './helpers.ts';
import type { Deps } from '../cli.ts';
import type { Factory } from '../factory.ts';

const run = (cwd: string, ...args: string[]) => {
  const r = git(['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd });
  assert.equal(r.code, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

// An origin with `main` tagged `tag` and one commit after the tag; a clone of it. The clone has not fetched that last commit.
function repos(tag: string | null = 'v0.6.0'): { origin: string; dir: string } {
  const origin = scratch();
  run(origin, 'init', '-q', '-b', 'main');
  writeFileSync(join(origin, 'a.txt'), 'a');
  run(origin, 'add', '.');
  run(origin, 'commit', '-q', '-m', 'A');
  if (tag !== null) run(origin, 'tag', tag);
  const dir = scratch();
  run(dir, 'clone', '-q', origin, '.');
  writeFileSync(join(origin, 'b.txt'), 'b');
  run(origin, 'add', '.');
  run(origin, 'commit', '-q', '-m', 'B after the tag');
  return { origin, dir };
}

function deps(dir: string): Deps {
  return {
    gh: (args, o) => gh(args, o),
    git: (args, o) => git(args, { cwd: dir, ...o }),
    exec: execAsync,
    factory: () => ({ project: { repo: 'o/r', mainBranch: 'main' } }) as Factory,
  };
}

const branches = (dir: string) => run(dir, 'branch', '--list', 'release/*');

test('new gives the version of the last tag plus each bump, from origin/main after a fetch', () => {
  for (const [bump, version] of [['patch', '0.6.1'], ['minor', '0.7.0'], ['major', '1.0.0']]) {
    const { origin, dir } = repos();
    const out = releaseNew(['--bump', bump], deps(dir));
    assert.equal(out.ok, true);
    assert.deepEqual([out.version, out.branch, out.dryRun], [version, `release/${version}`, false]);
    assert.equal(run(dir, 'rev-parse', `release/${version}`), run(origin, 'rev-parse', 'main'), 'it starts from the fetched origin/main, not the local main');
    assert.notEqual(run(dir, 'rev-parse', 'main'), run(dir, 'rev-parse', `release/${version}`));
  }
});

test('new with --dry-run says the version and writes nothing, not even a branch', () => {
  const { dir } = repos();
  const before = run(dir, 'for-each-ref');
  const out = releaseNew(['--bump', 'minor', '--dry-run'], deps(dir));
  assert.deepEqual([out.ok, out.branch, out.dryRun], [true, 'release/0.7.0', true]);
  assert.equal(branches(dir), '');
  assert.equal(run(dir, 'for-each-ref'), before);
});

test('new refuses when a release branch above the last tag exists, local or on origin, and writes nothing', () => {
  const { origin, dir } = repos();
  run(dir, 'branch', 'release/0.7.0');
  assert.throws(() => releaseNew(['--bump', 'minor'], deps(dir)), /release\/0\.7\.0 is already open above the last tag v0\.6\.0/);
  assert.equal(branches(dir).replace('*', '').trim(), 'release/0.7.0');
  run(dir, 'branch', '-D', 'release/0.7.0');
  run(origin, 'branch', 'release/0.8.0');
  assert.throws(() => releaseNew(['--bump', 'patch'], deps(dir)), /release\/0\.8\.0 is already open/);
  assert.equal(branches(dir), '');
});

test('new refuses with no tag, and a bump that is not patch, minor or major is a usage error', () => {
  const { dir } = repos(null);
  assert.throws(() => releaseNew(['--bump', 'minor'], deps(dir)), /no tag yet/);
  for (const bad of [[], ['--bump'], ['--bump', 'huge'], ['--bump', 'minor', '--bump', 'major'], ['minor']]) assert.throws(() => releaseNew(bad, deps(dir)), UsageError);
});

test('release routes new to its module', () => {
  const { dir } = repos();
  assert.equal(release(['new', '--bump', 'patch', '--dry-run'], deps(dir)).branch, 'release/0.6.1');
});
