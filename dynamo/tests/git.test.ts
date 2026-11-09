import { test } from 'node:test';
import assert from 'node:assert/strict';
import { read } from '../cli.ts';
import type { Deps } from '../cli.ts';
import { git } from '../git.ts';
import { scratch } from './helpers.ts';

test('git runs in the folder it is given and returns its code and output', () => {
  const dir = scratch();
  assert.equal(git(['init', '-q'], { cwd: dir }).code, 0);
  assert.deepEqual(git(['rev-parse', '--is-inside-work-tree'], { cwd: dir }), { code: 0, stdout: 'true\n', stderr: '' });
});

test('a git that fails gives its exit code and stderr', () => {
  const r = git(['rev-parse', '--verify', 'no-such-ref'], { cwd: scratch() });
  assert.notEqual(r.code, 0);
  assert.notEqual(r.stderr, '');
});

test('read gives the trimmed output of a git that works, in the folder it is given', () => {
  const dir = scratch();
  git(['init', '-q'], { cwd: dir });
  assert.equal(read({ git } as Deps, ['rev-parse', '--is-inside-work-tree'], dir), 'true');
});

test('read throws «git <args> failed: <stderr>» when the git fails', () => {
  const dir = scratch();
  assert.throws(() => read({ git } as Deps, ['rev-parse', '--verify', 'no-such-ref'], dir), /^Error: git rev-parse --verify no-such-ref failed: .+/);
});
