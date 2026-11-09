import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DYNAMO, noGhEnv } from './helpers.ts';

const run = (...args: string[]) => spawnSync(process.execPath, [DYNAMO, ...args], { encoding: 'utf8', env: noGhEnv() });

function oneJsonLine(stdout: string) {
  const lines = stdout.split('\n').filter((l) => l !== '');
  assert.equal(lines.length, 1, `one line, got: ${stdout}`);
  return JSON.parse(lines[0]);
}

test('an unknown subcommand exits non-zero with one JSON line that says so', () => {
  const r = run('nope');
  assert.notEqual(r.status, 0);
  const out = oneJsonLine(r.stdout);
  assert.equal(out.ok, false);
  assert.match(out.error, /unknown subcommand: nope/);
});

test('no subcommand, or a name that is only a property of objects, is an error too', () => {
  for (const args of [[], ['toString'], ['__proto__']]) {
    const r = run(...args);
    assert.notEqual(r.status, 0, args.join(' '));
    assert.equal(oneJsonLine(r.stdout).ok, false);
  }
});
