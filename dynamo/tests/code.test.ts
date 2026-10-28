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

test('the card and comment decisions are pure: they import nothing but types and the shared helper', () => {
  for (const name of ['cards.ts', 'comments.ts']) {
    assert.deepEqual(imports(name).filter((i) => !i.type && i.from !== './cli.ts'), [], name);
  }
});

test('card and comment get gh and the config as parameters: they import none of their modules', () => {
  const edges = ['./exec.ts', './gh.ts', './git.ts', './factory.ts', 'node:child_process'];
  for (const name of ['card.ts', 'comment.ts', 'cards.ts', 'comments.ts']) {
    assert.deepEqual(imports(name).filter((i) => !i.type && edges.includes(i.from)), [], name);
  }
});

test('the report decisions are pure: they import nothing but types and each other', () => {
  for (const name of ['releases.ts', 'reports.ts']) assert.deepEqual(imports(name).filter((i) => !i.type && i.from !== './releases.ts'), [], name);
});

test('report gets gh, git and the config as parameters: it imports none of their modules', () => {
  const edges = ['./exec.ts', './gh.ts', './git.ts', './factory.ts', 'node:child_process'];
  for (const name of ['report.ts', 'releases.ts', 'reports.ts']) {
    assert.deepEqual(imports(name).filter((i) => !i.type && edges.includes(i.from)), [], name);
  }
});

test('the copy decisions are pure: they import nothing but types, node:path and the branch names of merging.ts', () => {
  assert.deepEqual(imports('copies.ts').filter((i) => !i.type && i.from !== 'node:path' && i.from !== './merging.ts'), []);
  assert.deepEqual(imports('merging.ts').filter((i) => !i.type), []);
});

test('copy gets gh, git and the config as parameters: it imports none of their modules', () => {
  const edges = ['./exec.ts', './gh.ts', './git.ts', './factory.ts', 'node:child_process', 'node:fs'];
  for (const name of ['copy.ts', 'copies.ts']) assert.deepEqual(imports(name).filter((i) => !i.type && edges.includes(i.from)), [], name);
});

test('the agent decisions are pure: agents.ts imports nothing but types', () => {
  assert.deepEqual(imports('agents.ts').filter((i) => !i.type), []);
});

test('claude.ts is reached from the entry point only: a subcommand gets runAgent as a parameter, and agents.ts has no edge', () => {
  const edges = ['./exec.ts', './claude.ts', './gh.ts', './git.ts', './factory.ts', 'node:child_process', 'node:fs'];
  assert.deepEqual(imports('agents.ts').filter((i) => edges.includes(i.from)), []);
  assert.deepEqual(sources.filter((n) => n !== 'claude.ts' && n !== 'dynamo.ts' && imports(n).some((i) => !i.type && i.from === './claude.ts')), []);
});
