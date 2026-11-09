import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UsageError } from '../cli.ts';
import { END, endOf, parseChecks, report, withBase, words } from '../checks.ts';
import { verify } from '../verify.ts';
import { execAsync } from '../exec.ts';
import { git } from '../git.ts';
import { DYNAMO, noGhEnv, scratch } from './helpers.ts';
import type { Deps } from '../cli.ts';
import type { Factory } from '../factory.ts';

// --- The pure part (checks.ts): data in, data out.

test('parseChecks accepts a list of commands and refuses anything else, an empty list included', () => {
  assert.deepEqual(parseChecks(['a b', 'c']), ['a b', 'c']);
  for (const bad of [undefined, null, 'a b', [], [''], ['  '], ['a', 3]]) {
    assert.throws(() => parseChecks(bad), /no checks/, JSON.stringify(bad));
  }
});

test('withBase replaces every <base> with the sha, and nothing else', () => {
  assert.equal(withBase('git diff --check <base>', 'abc123'), 'git diff --check abc123');
  assert.equal(withBase('x <base> <base>..HEAD', 'abc'), 'x abc abc..HEAD');
  assert.equal(withBase('node --test dynamo/tests/', 'abc'), 'node --test dynamo/tests/');
  assert.equal(withBase('echo <base>', "$&"), 'echo $&');
});

test('words splits a command into a program and its arguments, with no shell', () => {
  assert.deepEqual(words('claude plugin validate . --strict'), ['claude', 'plugin', 'validate', '.', '--strict']);
  assert.deepEqual(words('  node   --test  x/ '), ['node', '--test', 'x/']);
});

test('endOf gives the end of the output, stdout then stderr, with LF line ends, cut to END characters', () => {
  assert.equal(endOf({ stdout: 'out\r\n', stderr: 'err\r\n' }), 'out\nerr');
  assert.equal(endOf({ stdout: '', stderr: '' }), '');
  const long = endOf({ stdout: 'a'.repeat(1000) + 'THE END\n', stderr: '' });
  assert.equal(long.length, END);
  assert.ok(long.startsWith('…') && long.endsWith('THE END'));
});

test('report is ok only if every check exits 0, and always says what each one did', () => {
  const pass = { command: 'a', code: 0, output: 'fine' };
  const fail = { command: 'b', code: 3, output: 'broke' };
  assert.deepEqual(report('sha', [pass]), { ok: true, base: 'sha', checks: [pass] });
  assert.deepEqual(report('sha', [pass, fail, pass]), { ok: false, base: 'sha', checks: [pass, fail, pass] });
});

// --- The subcommand, on a temporary git repository, with real git and real processes.

const run = (cwd: string, ...args: string[]) => {
  const r = git(['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd });
  assert.equal(r.code, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

// A repository with `main` at C (one commit past where `ticket` left it, at A), and `ticket` checked out with B on it.
// The merge-base of HEAD and main is A: neither main's tip nor HEAD.
function repo(): { dir: string; mergeBase: string; mainTip: string } {
  const dir = scratch();
  run(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'pass.js'), '');
  writeFileSync(join(dir, 'fail.js'), "console.log('what failed'); process.exit(3);");
  writeFileSync(join(dir, 'show.js'), 'console.log("got " + process.argv[2]);');
  run(dir, 'add', '.');
  run(dir, 'commit', '-q', '-m', 'A');
  const mergeBase = run(dir, 'rev-parse', 'HEAD');
  run(dir, 'checkout', '-q', '-b', 'ticket');
  writeFileSync(join(dir, 'b.txt'), 'b');
  run(dir, 'add', 'b.txt');
  run(dir, 'commit', '-q', '-m', 'B');
  run(dir, 'checkout', '-q', 'main');
  writeFileSync(join(dir, 'c.txt'), 'c');
  run(dir, 'add', 'c.txt');
  run(dir, 'commit', '-q', '-m', 'C');
  const mainTip = run(dir, 'rev-parse', 'HEAD');
  run(dir, 'checkout', '-q', 'ticket');
  return { dir, mergeBase, mainTip };
}

const depsWith = (limit: unknown, ...checks: string[]): Deps => ({
  gh: () => { throw new Error('verify does not use gh'); }, git, exec: execAsync,
  factory: () => ({ project: { repo: 'o/r', mainBranch: 'main', checks, checkTimeoutMinutes: limit } }) as Factory,
});
const deps = (...checks: string[]): Deps => depsWith(5, ...checks);

test('a check that passes and one that fails: each has its command, exit code and end of output; ok is false', async () => {
  const { dir } = repo();
  const out = await verify([dir, 'main'], deps('node pass.js', 'node fail.js'));
  assert.equal(out.ok, false);
  assert.deepEqual(out.checks, [
    { command: 'node pass.js', code: 0, output: '' },
    { command: 'node fail.js', code: 3, output: 'what failed' },
  ]);
});

test('when every check passes, ok is true', async () => {
  const { dir } = repo();
  const out = await verify([dir, 'main'], deps('node pass.js', 'git status --short'));
  assert.equal(out.ok, true);
  assert.deepEqual((out.checks as { code: number }[]).map((c) => c.code), [0, 0]);
});

test('a check that cannot start is a failed check (127), not a pass and not a crash', async () => {
  const { dir } = repo();
  const out = await verify([dir, 'main'], deps('no-such-program-here --x'));
  assert.equal(out.ok, false);
  assert.equal((out.checks as { code: number }[])[0].code, 127);
});

test('<base> becomes the merge-base of HEAD and the base, not the base itself', async () => {
  const { dir, mergeBase, mainTip } = repo();
  assert.notEqual(mergeBase, mainTip);
  const out = await verify([dir, 'main'], deps('node show.js <base>'));
  assert.equal(out.base, mergeBase);
  assert.deepEqual(out.checks, [{ command: 'node show.js <base>', code: 0, output: `got ${mergeBase}` }]);
});

test('the checks run in the copy, not in the current folder', async () => {
  const { dir } = repo();
  const out = await verify([dir, 'main'], deps('node show.js here'));
  assert.equal((out.checks as { output: string }[])[0].output, 'got here');
});

// A command that never ends, with a child that never ends either, as a test that hangs.
const HANG = [
  "const { spawn } = require('node:child_process');",
  "spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
  'setInterval(() => {}, 1000);',
].join('\n');

test('a command past checkTimeoutMinutes fails with «timed out after N min» in its output; the ones after it still run', async () => {
  const { dir } = repo();
  writeFileSync(join(dir, 'hang.cjs'), HANG);
  const out = await verify([dir, 'main'], depsWith(0.02, 'node hang.cjs', 'node pass.js'));
  assert.equal(out.ok, false);
  const checks = out.checks as { command: string; code: number; output: string }[];
  assert.notEqual(checks[0].code, 0);
  assert.match(checks[0].output, /timed out after 0.02 min/);
  assert.deepEqual(checks[1], { command: 'node pass.js', code: 0, output: '' });
});

test('a missing or invalid checkTimeoutMinutes is an error, and no command runs', async () => {
  const { dir } = repo();
  for (const bad of [undefined, 0, -3, '15']) {
    await assert.rejects(() => verify([dir, 'main'], depsWith(bad, 'node show.js here')), /project.checkTimeoutMinutes/, String(bad));
  }
});

test('no checks defined: it throws, and it never counts as passed', async () => {
  const { dir } = repo();
  await assert.rejects(() => verify([dir, 'main'], deps()), /no checks/);
});

test('the copy does not exist, or is not a git working tree: it throws', async () => {
  await assert.rejects(() => verify([join(scratch(), 'nope'), 'main'], deps('node pass.js')), /not a git working tree/);
  await assert.rejects(() => verify([scratch(), 'main'], deps('node pass.js')), /not a git working tree/);
});

test('a base that does not exist, or that shares no history with HEAD: it throws', async () => {
  const { dir } = repo();
  await assert.rejects(() => verify([dir, 'no-such-branch'], deps('node pass.js')), /merge-base/);
});

test('wrong arguments are a usage error (exit 2), and so is a base that looks like an option', async () => {
  const { dir } = repo();
  for (const args of [[], [dir], [dir, 'main', 'extra'], [dir, '--all']]) {
    await assert.rejects(() => verify(args, deps('node pass.js')), UsageError, args.join(' '));
  }
});

// --- Through the entry point.

const cli = (...args: string[]) => spawnSync(process.execPath, [DYNAMO, ...args], { encoding: 'utf8', env: noGhEnv() });

test('through the entry point: no arguments exits 2; a copy that does not exist exits 1; each prints one JSON line', () => {
  for (const [args, status] of [[[], 2], [[join(scratch(), 'nope'), 'main'], 1]] as const) {
    const r = cli('verify', ...args);
    assert.equal(r.status, status, r.stdout);
    const lines = r.stdout.split('\n').filter((l) => l !== '');
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).ok, false);
  }
});
