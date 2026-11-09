import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exec, execAsync, execToFile } from '../exec.ts';
import { scratch } from './helpers.ts';

// The program the test starts: it starts a child that never ends (inheriting its stderr, as the shell an agent leaves
// behind does), writes both pids to a file and never ends either.
const PROGRAM = `
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'ignore', 'inherit'] });
writeFileSync(process.argv[2], process.pid + ' ' + child.pid);
setInterval(() => {}, 1000);
`;

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function until(condition: () => boolean, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 50));
  }
}

test('execToFile closes the program and the child it left running when its signal aborts', async () => {
  const dir = scratch();
  const script = join(dir, 'program.cjs');
  const pids = join(dir, 'pids.txt');
  writeFileSync(script, PROGRAM);
  const controller = new AbortController();
  const running = execToFile([process.execPath, script], [pids], join(dir, 'out.log'), { signal: controller.signal });
  await until(() => existsSync(pids) && readFileSync(pids, 'utf8').includes(' '), 10000);
  const [parent, child] = readFileSync(pids, 'utf8').split(' ').map(Number);
  assert.ok(alive(parent) && alive(child), 'both run before the close');
  controller.abort();
  const r = await running;
  assert.notEqual(r.code, 0);
  await until(() => !alive(parent) && !alive(child), 5000);
});

test('execToFile with a signal already aborted closes the program as soon as it starts', async () => {
  const dir = scratch();
  const script = join(dir, 'program.cjs');
  writeFileSync(script, PROGRAM);
  const r = await execToFile([process.execPath, script], [join(dir, 'pids.txt')], join(dir, 'out.log'), { signal: AbortSignal.abort() });
  assert.notEqual(r.code, 0);
});

// --- The asynchronous exec with a time limit (the automatic check: verify and merge).

test('execAsync with a limit closes a program that does not end, with the child it left running, and says it timed out', async () => {
  const dir = scratch();
  const script = join(dir, 'program.cjs');
  const pids = join(dir, 'pids.txt');
  writeFileSync(script, PROGRAM);
  const started = Date.now();
  const r = await execAsync([process.execPath, script], [pids], { timeoutMs: 1500 });
  assert.equal(r.timedOut, true);
  assert.equal(r.code, 124);
  assert.ok(Date.now() - started < 20000, 'it came back long before the program would have ended');
  const [parent, child] = readFileSync(pids, 'utf8').split(' ').map(Number);
  await until(() => !alive(parent) && !alive(child), 5000);
});

test('execAsync with a limit that is not reached returns what the program did', async () => {
  const dir = scratch();
  const script = join(dir, 'ok.cjs');
  writeFileSync(script, "process.stdout.write('out' + String.fromCharCode(10)); process.stderr.write('err'); process.exit(3);");
  assert.deepEqual(await execAsync([process.execPath, script], [], { timeoutMs: 60000 }), { code: 3, stdout: 'out\n', stderr: 'err' });
  assert.deepEqual(await execAsync([process.execPath, script], []), { code: 3, stdout: 'out\n', stderr: 'err' }, 'and with no limit at all');
});

test('execAsync gives the program its input and its working folder, and 127 when it cannot start', async () => {
  const dir = scratch();
  const script = join(dir, 'echo.cjs');
  writeFileSync(script, "process.stdin.on('data', (d) => process.stdout.write(process.cwd() + ':' + d));");
  const r = await execAsync([process.execPath, script], [], { timeoutMs: 60000, cwd: dir, input: 'hi' });
  assert.equal(r.code, 0);
  assert.ok(r.stdout.endsWith(':hi'), r.stdout);
  const bad = await execAsync(['no-such-program-here'], [], { timeoutMs: 60000 });
  assert.equal(bad.code, 127);
  assert.match(bad.stderr, /no-such-program-here/);
});

test('execAsync does not block the process: a timer fires while a program runs', async () => {
  const dir = scratch();
  const script = join(dir, 'sleep.cjs');
  writeFileSync(script, 'setTimeout(() => {}, 1500);');
  let ticks = 0;
  const timer = setInterval(() => { ticks += 1; }, 100);
  const r = await execAsync([process.execPath, script], [], { timeoutMs: 60000 });
  clearInterval(timer);
  assert.equal(r.code, 0);
  assert.ok(ticks >= 5, `only ${ticks} ticks of 100 ms in a 1.5 s program`);
});

// Every program dynamo runs (gh, git, claude) gets path conversion off, whichever of the three functions starts it, and
// keeps the rest of the environment it was given.
const PRINT = 'process.stdout.write(String(process.env.MSYS_NO_PATHCONV) + " " + String(process.env.KEPT))';

test('exec, execAsync and execToFile set MSYS_NO_PATHCONV=1 and keep the environment given', async () => {
  const env = { ...process.env, KEPT: 'yes', MSYS_NO_PATHCONV: undefined };
  assert.equal(exec([process.execPath, '-e'], [PRINT], { env }).stdout, '1 yes');
  assert.equal((await execAsync([process.execPath, '-e'], [PRINT], { env })).stdout, '1 yes');
  const file = join(scratch(), 'out.txt');
  await execToFile([process.execPath, '-e'], [PRINT], file, { env });
  assert.equal(readFileSync(file, 'utf8'), '1 yes');
});

test('exec with no env given uses the environment of dynamo, with MSYS_NO_PATHCONV=1 on top', () => {
  assert.equal(exec([process.execPath, '-e'], [PRINT]).stdout, `1 ${process.env.KEPT}`);
});
