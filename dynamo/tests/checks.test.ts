import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTimeoutOf, failedTests, runChecks } from '../checks.ts';
import { settings } from '../merging.ts';
import type { Deps } from '../cli.ts';

// --- The shared loop that verify and merge run their checks through.

test('runChecks runs each command in the folder, in order, with <base> replaced, and reports its code and the end of its output', async () => {
  const calls: { command: string[]; args: string[]; cwd: string | undefined; timeoutMs: number | undefined }[] = [];
  const exec: Deps['exec'] = async (command, args, options) => {
    calls.push({ command, args, cwd: options?.cwd, timeoutMs: options?.timeoutMs });
    return { code: command[0] === 'bad' ? 3 : 0, stdout: 'out\r\n', stderr: 'err' };
  };
  const checks = await runChecks(['ok one <base>', 'bad two'], 'abc123', '/copy', exec, 15);
  assert.deepEqual(calls, [
    { command: ['ok'], args: ['one', 'abc123'], cwd: '/copy', timeoutMs: 900000 },
    { command: ['bad'], args: ['two'], cwd: '/copy', timeoutMs: 900000 },
  ]);
  assert.deepEqual(checks, [
    { command: 'ok one <base>', code: 0, output: 'out\nerr' },
    { command: 'bad two', code: 3, output: 'out\nerr' },
  ]);
});

test('a command that timed out fails, with «timed out after N min» first in its output, and the next command still runs', async () => {
  const exec: Deps['exec'] = async (command) => command[0] === 'slow'
    ? { code: 124, stdout: 'partial', stderr: '', timedOut: true }
    : { code: 0, stdout: '', stderr: '' };
  assert.deepEqual(await runChecks(['slow one', 'fast two'], 'abc', '/copy', exec, 15), [
    { command: 'slow one', code: 124, output: 'timed out after 15 min\npartial' },
    { command: 'fast two', code: 0, output: '' },
  ]);
  const odd = await runChecks(['slow'], 'abc', '/copy', async () => ({ code: 0, stdout: '', stderr: '', timedOut: true }), 2);
  assert.notEqual(odd[0].code, 0, 'a timed-out command never counts as passed, whatever code it gave');
});

// The «failing tests:» section of `node --test`, as it prints it, with a long trace under each test.
function nodeReport(names: string[], trace = 400): string {
  const sections = names.map((n, i) => `test at dynamo/tests/f${i}.test.ts:${i + 1}:1\n✖ ${n} (0.5ms)\n  Error: boom\n`
    + Array.from({ length: trace }, (_, k) => `      at frame${k} (node:internal/x:${k}:1)`).join('\n') + '\n');
  return `✖ ${names[0]} (0.5ms)\nℹ tests 9\nℹ fail ${names.length}\n\n✖ failing tests:\n\n${sections.join('\n')}`;
}

test('failedTests names each test the node runner lists as failed, once, with where it is', () => {
  const out = nodeReport(['first test', 'a rule with (parens) in it']);
  assert.deepEqual(failedTests(out), ['dynamo/tests/f0.test.ts:1:1 first test', 'dynamo/tests/f1.test.ts:2:1 a rule with (parens) in it']);
  assert.deepEqual(failedTests('✔ all good (1ms)\nℹ fail 0'), []);
  assert.deepEqual(failedTests(out.replace(/\n/g, '\r\n')).length, 2, 'CRLF output reads the same');
});

test('a failed check with a long output still names each failed test, at the start of what the Builder gets', async () => {
  const stdout = nodeReport(['alpha fails', 'beta fails']);
  assert.ok(stdout.length > 20000, 'the trace is far longer than what is kept of the end');
  const exec: Deps['exec'] = async () => ({ code: 1, stdout, stderr: '' });
  const [check] = await runChecks(['node --test'], 'abc', '/copy', exec, 15);
  assert.equal(check.code, 1);
  assert.match(check.output, /^failed tests \(2\):\n- dynamo\/tests\/f0\.test\.ts:1:1 alpha fails\n- dynamo\/tests\/f1\.test\.ts:2:1 beta fails\n/);
  assert.ok(check.output.length < 1000, 'the output stays short');
});

test('a passing command, or a failure with no test names, keeps its output as it was', async () => {
  const exec: Deps['exec'] = async (command) => ({ code: command[0] === 'bad' ? 2 : 0, stdout: '✖ failing tests:\n\ntest at x:1:1\n✖ named (1ms)\n', stderr: '' });
  const [ok, bad] = await runChecks(['ok', 'bad'], 'abc', '/copy', exec, 15);
  assert.equal(ok.output, '✖ failing tests:\n\ntest at x:1:1\n✖ named (1ms)', 'only a failed command gets the list');
  assert.match(bad.output, /^failed tests \(1\):\n- x:1:1 named\n/);
  const [plain] = await runChecks(['bad'], 'abc', '/copy', async () => ({ code: 1, stdout: 'lint error', stderr: '' }), 15);
  assert.equal(plain.output, 'lint error');
});

test('checkTimeoutOf reads checkTimeoutMinutes of factory.json, a number above 0, and refuses anything else (no default)', () => {
  assert.equal(checkTimeoutOf({ checkTimeoutMinutes: 15 }), 15);
  assert.equal(checkTimeoutOf({ checkTimeoutMinutes: 0.5 }), 0.5);
  for (const bad of [undefined, null, 0, -1, '15', NaN, Infinity, [], {}]) {
    assert.throws(() => checkTimeoutOf({ checkTimeoutMinutes: bad }), /project.checkTimeoutMinutes/, String(bad));
  }
  assert.throws(() => checkTimeoutOf({}), /project.checkTimeoutMinutes/);
});

test('settings reads the project values through the shared setting() and names the one missing', () => {
  const project = { repo: 'o/r', mainBranch: 'main', doneLabel: 'done' };
  assert.deepEqual(settings(project, 'release/1'), { repo: 'o/r', base: 'release/1', main: 'main', doneLabel: 'done' });
  assert.throws(() => settings({ ...project, mainBranch: '' }, 'release/1'), /factory\.json has no project\.mainBranch/);
});
