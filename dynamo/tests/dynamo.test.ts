import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
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

// Every file of dynamo/ imports only node: modules and files inside dynamo/: nothing from outside, and no package
// (a test may also import the pure logic of the mods/ pane).
test('dynamo imports only node: modules and its own files', () => {
  const root = resolve(import.meta.dirname, '..');
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]);
  const all = files(root);
  assert.ok(!all.some((f) => /node_modules|package(-lock)?\.json$/.test(relative(root, f))), 'no packages');
  for (const f of all.filter((n) => /\.[jt]s$/.test(n))) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (spec.startsWith('node:')) continue;
      assert.ok(spec.startsWith('.'), `${relative(root, f)} imports ${spec}`);
      const target = relative(root, resolve(dirname(f), spec));
      // The one exception: a test may import the pure logic of the mod in mods/ (the dependency points from the test
      // to the mod, never from dynamo/ code to anything outside).
      const modLogic = relative(root, f).startsWith('tests') && /^\.\.[\\/]mods[\\/]/.test(target);
      assert.ok(!target.startsWith('..') || modLogic, `${relative(root, f)} imports ${spec}`);
    }
  }
});
