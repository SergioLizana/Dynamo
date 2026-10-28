import { test } from 'node:test';
import assert from 'node:assert/strict';
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
