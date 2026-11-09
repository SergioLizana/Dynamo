import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gh } from '../gh.ts';
import { fakeGhEnv, noGhEnv, scratch } from './helpers.ts';

test('gh runs the command in DYNAMO_GH with the arguments and stdin, and returns its code and output', () => {
  const state = scratch();
  writeFileSync(join(state, 'answers.json'), JSON.stringify([{ args: ['issue', 'view', '78'], stdout: '{"n":78}\n' }]));
  const r = gh(['issue', 'view', '78', '--json', 'title'], { env: fakeGhEnv(state), input: 'a body' });
  assert.deepEqual(r, { code: 0, stdout: '{"n":78}\n', stderr: '' });
  const calls = readFileSync(join(state, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(calls, [{ args: ['issue', 'view', '78', '--json', 'title'], stdin: 'a body' }]);
});

test('a gh that fails gives its exit code and stderr', () => {
  const r = gh(['pr', 'list'], { env: fakeGhEnv(scratch()) });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /fake gh: not handled: pr list/);
});

test('with no gh on the PATH and no DYNAMO_GH, gh fails with 127 instead of throwing', () => {
  const r = gh(['--version'], { env: noGhEnv() });
  assert.equal(r.code, 127);
  assert.match(r.stderr, /^gh: /);
});
