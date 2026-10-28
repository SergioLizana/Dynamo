import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { comment } from '../comment.ts';
import { UsageError } from '../cli.ts';
import { readFactory } from '../factory.ts';
import type { Deps } from '../cli.ts';
import type { Result } from '../exec.ts';
import { DYNAMO, fakeGhEnv, scratch } from './helpers.ts';

const factory = readFactory();
const repo = String((factory.project as Record<string, unknown>).repo);
const postCall = (n: number) => ['issue', 'comment', String(n), '-R', repo, '--body-file', '-'];
const readCall = (n: number) => ['issue', 'view', String(n), '-R', repo, '--json', 'comments'];

// What `gh issue view --json comments` prints, the last comment being the last body.
const comments = (...bodies: string[]): Result => ({
  code: 0, stderr: '',
  stdout: JSON.stringify({ comments: bodies.map((body, i) => ({ body, url: `https://github.com/${repo}/issues/80#issuecomment-${i + 1}` })) }),
});
const ok: Result = { code: 0, stdout: 'https://github.com/x/y/issues/80#issuecomment-9\n', stderr: '' };

function deps(...answers: Result[]): Deps & { calls: { args: string[]; input?: string }[] } {
  const calls: { args: string[]; input?: string }[] = [];
  const gh = (args: string[], options?: { input?: string }): Result => {
    calls.push({ args, input: options?.input });
    return answers.shift() ?? { code: 1, stdout: '', stderr: 'no answer' };
  };
  const nope = (): Result => { throw new Error('comment uses only gh'); };
  return { gh, git: nope, exec: nope, factory: () => factory, calls };
}

function file(text: string): string {
  const path = join(scratch(), 'body.md');
  writeFileSync(path, text);
  return path;
}

test('comment posts the file as the body and reads the comments of that one issue back', () => {
  const d = deps(ok, comments('an older one', 'hello\n'));
  const out = comment(['80', '--body-file', file('hello\n')], d);
  assert.equal(out.ok, true);
  assert.equal(out.ticket, 80);
  assert.match(String(out.url), /issuecomment-2$/);
  assert.deepEqual(d.calls, [{ args: postCall(80), input: 'hello\n' }, { args: readCall(80), input: undefined }]);
});

test('the last comment read back equals the file whether either side has CRLF or LF', () => {
  const lf = 'one\ntwo\n\nthree\n';
  const crlf = 'one\r\ntwo\r\n\r\nthree\r\n';
  for (const [written, back] of [[crlf, lf], [lf, crlf], [crlf, crlf], [lf, lf]]) {
    assert.equal(comment(['80', '--body-file', file(written)], deps(ok, comments(back))).ok, true);
  }
});

test('non-ASCII text (ñ ·) is posted and compared as it is', () => {
  const text = 'Revisión · añadido ñ\n';
  const d = deps(ok, comments(text));
  assert.equal(comment(['80', '--body-file', file(text)], d).ok, true);
  assert.equal(d.calls[0].input, text);
  assert.equal(comment(['80', '--body-file', file(text)], deps(ok, comments('Revision . anadido n\n'))).ok, false);
});

test('a last comment that differs from the file is a failure that says it was posted', () => {
  const out = comment(['80', '--body-file', file('what I wrote\n')], deps(ok, comments('what I wrote\n', 'someone else, later')));
  assert.equal(out.ok, false);
  assert.equal(out.posted, true);
});

test('only the end of the body is allowed to differ: the lines inside count', () => {
  assert.equal(comment(['80', '--body-file', file('a\n\nb\n')], deps(ok, comments('a\nb\n'))).ok, false);
  assert.equal(comment(['80', '--body-file', file('a b')], deps(ok, comments('a  b'))).ok, false);
  assert.equal(comment(['80', '--body-file', file('a b\n\n')], deps(ok, comments('a b'))).ok, true);
});

test('an issue with no comments after the post is a failure', () => {
  assert.equal(comment(['80', '--body-file', file('x')], deps(ok, comments())).ok, false);
});

test('a post that gh refuses is an error, and nothing is read back', () => {
  const d = deps({ code: 1, stdout: '', stderr: 'Could not add a comment' });
  assert.throws(() => comment(['80', '--body-file', file('x')], d), /Could not add a comment/);
  assert.equal(d.calls.length, 1);
});

test('a read back that cannot be read or is not what gh prints is an error that says the comment was posted', () => {
  assert.throws(() => comment(['80', '--body-file', file('x')], deps(ok, { code: 1, stdout: '', stderr: 'boom' })), /posted.*boom/s);
  assert.throws(() => comment(['80', '--body-file', file('x')], deps(ok, { code: 0, stdout: 'not json', stderr: '' })), /JSON/);
  assert.throws(() => comment(['80', '--body-file', file('x')], deps(ok, { code: 0, stdout: '{"comments":[{"body":5}]}', stderr: '' })), /comments/);
});

test('an empty or missing file posts nothing', () => {
  const d = deps();
  assert.throws(() => comment(['80', '--body-file', file('')], d), /empty/);
  assert.throws(() => comment(['80', '--body-file', file(' \r\n\n')], d), /empty/);
  assert.throws(() => comment(['80', '--body-file', join(scratch(), 'nope.md')], d), /nope\.md/);
  assert.deepEqual(d.calls, []);
});

test('comment refuses wrong arguments as a usage error and calls no gh', () => {
  const d = deps();
  const f = file('x');
  for (const args of [[], ['80'], ['80', '--body-file'], ['80', f], ['80', '--body-file', f, 'x'], ['abc', '--body-file', f],
    ['0', '--body-file', f], ['-1', '--body-file', f], ['--body-file', f, '80'], ['80', '--body-file', '']]) {
    assert.throws(() => comment(args, d), UsageError, args.join(' '));
  }
  assert.deepEqual(d.calls, []);
});

test('comment refuses a config without the repository', () => {
  const d = deps();
  assert.throws(() => comment(['80', '--body-file', file('x')], { ...d, factory: () => ({ project: { ...factory.project, repo: undefined } }) }), /repo/);
});

// Through the program: the fake gh reads the body on stdin as written, and the comment it gives back has the other line ending.
test('dynamo comment posts a CRLF file with ñ · through the fake gh and reads it back', () => {
  const state = scratch();
  const text = 'Revisión · añadido\r\nsegunda línea ñ\r\n';
  const path = file(text);
  writeFileSync(join(state, 'answers.json'), JSON.stringify([
    { args: postCall(80) },
    { args: readCall(80), stdout: comments('Revisión · añadido\nsegunda línea ñ\n').stdout },
  ]));
  const r = spawnSync(process.execPath, [DYNAMO, 'comment', '80', '--body-file', path], { encoding: 'utf8', env: fakeGhEnv(state) });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).ok, true);
  const calls = readFileSync(join(state, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(calls.map((c) => c.args), [postCall(80), readCall(80)]);
  assert.equal(calls[0].stdin, text);
});

test('dynamo comment exits 1 when the last comment is not the file, 2 when called wrong', () => {
  const state = scratch();
  writeFileSync(join(state, 'answers.json'), JSON.stringify([{ args: postCall(80) }, { args: readCall(80), stdout: comments('other').stdout }]));
  const run = (...args: string[]) => spawnSync(process.execPath, [DYNAMO, 'comment', ...args], { encoding: 'utf8', env: fakeGhEnv(state) });
  assert.equal(run('80', '--body-file', file('mine')).status, 1);
  assert.equal(run('80').status, 2);
});
