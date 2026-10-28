// The code rules of CLAUDE.md that a grep can check, over the files of dynamo/ outside tests/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sources = readdirSync(root).filter((n) => n.endsWith('.ts')).sort();
const text = (name: string) => readFileSync(join(root, name), 'utf8');
const imports = (name: string) => [...text(name).matchAll(/^import\s+(type\s+)?[^'"]*from\s*'([^']+)'/gm)]
  .map((m) => ({ type: m[1] !== undefined, from: m[2] }));

test('only exec.ts imports child_process', () => {
  assert.deepEqual(sources.filter((n) => /child_process/.test(text(n))), ['exec.ts']);
});

test('no file of dynamo/ uses any', () => {
  for (const n of sources) assert.doesNotMatch(text(n), /(:\s*any\b|\bas\s+any\b|<any>|any\[\])/, n);
});

test('no file of dynamo/ is over 200 lines', () => {
  for (const n of sources) assert.ok(text(n).split('\n').length <= 201, `${n} has ${text(n).split('\n').length} lines`);
});

test('only the entry point writes the output or sets the exit code', () => {
  for (const n of sources.filter((s) => s !== 'dynamo.ts')) assert.doesNotMatch(text(n), /process\.exit|stdout\.write/, n);
});

test('the frontier is pure: it imports nothing but types', () => {
  assert.ok(imports('frontier.ts').every((i) => i.type), JSON.stringify(imports('frontier.ts')));
});

test('board gets gh, git and the config as parameters: it imports none of their modules', () => {
  const edges = ['./exec.ts', './gh.ts', './git.ts', './factory.ts', 'node:child_process', 'node:fs'];
  const bad = imports('board.ts').filter((i) => !i.type && edges.includes(i.from));
  assert.deepEqual(bad, []);
  assert.deepEqual(imports('tickets.ts').filter((i) => !i.type && edges.includes(i.from)), []);
});
