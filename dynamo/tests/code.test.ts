// The design rules of the code that a grep can check (what each module imports, no `any`, small files), over the files
// of dynamo/ outside tests/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

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

test('the decisions of the loop are pure: rounds, briefs and runs import nothing but types, each other and the shared helper', () => {
  const allowed = ['./rounds.ts', './cli.ts'];
  for (const name of ['rounds.ts', 'briefs.ts', 'runs.ts']) {
    assert.deepEqual(imports(name).filter((i) => !i.type && !allowed.includes(i.from)), [], name);
  }
  assert.deepEqual(imports('rounds.ts').filter((i) => !i.type), []);
});

test('run gets gh, git, claude and the config as parameters: it imports none of their modules', () => {
  const edges = ['./exec.ts', './gh.ts', './git.ts', './factory.ts', './claude.ts', 'node:child_process'];
  for (const name of ['run.ts', 'loop.ts']) assert.deepEqual(imports(name).filter((i) => !i.type && edges.includes(i.from)), [], name);
});

test('the scheduling of a list is pure: lists.ts imports nothing but types and the frontier', () => {
  assert.deepEqual(imports('lists.ts').filter((i) => !i.type && i.from !== './frontier.ts'), []);
});

test('reading the logs is pure: statuses.ts imports nothing but types and the stream reader of agents.ts', () => {
  assert.deepEqual(imports('statuses.ts').filter((i) => !i.type && i.from !== './agents.ts'), []);
});

test('status reads the log folder only: it imports neither gh, git, exec nor claude', () => {
  const edges = ['./exec.ts', './gh.ts', './git.ts', './claude.ts', 'node:child_process'];
  for (const name of ['status.ts', 'statuses.ts']) assert.deepEqual(imports(name).filter((i) => !i.type && edges.includes(i.from)), [], name);
});

test('the Closes decisions are pure: closes.ts imports nothing', () => {
  assert.deepEqual(imports('closes.ts'), []);
});

test('release check and close and the shared reading of the release get gh, git and the config as parameters: they import none of their modules', () => {
  const edges = ['./exec.ts', './gh.ts', './git.ts', './factory.ts', 'node:child_process', 'node:fs'];
  for (const name of ['release.ts', 'release-check.ts', 'release-close.ts', 'releasing.ts', 'closes.ts']) {
    assert.deepEqual(imports(name).filter((i) => !i.type && edges.includes(i.from)), [], name);
  }
});

test('the version decisions are pure: versions.ts imports nothing', () => {
  assert.deepEqual(imports('versions.ts'), []);
});

test('the logic of the merge is pure: merging.ts imports nothing', () => {
  assert.deepEqual(imports('merging.ts').filter((i) => !i.type), []);
});

test('merge gets gh, git, exec and the config as parameters: it imports none of their modules', () => {
  const edges = ['./exec.ts', './gh.ts', './git.ts', './factory.ts', 'node:child_process', 'node:fs'];
  assert.deepEqual(imports('merge.ts').filter((i) => !i.type && edges.includes(i.from)), []);
});

test('the logic of the checks is pure: checks.ts imports nothing but types', () => {
  assert.ok(imports('checks.ts').every((i) => i.type), JSON.stringify(imports('checks.ts')));
});

test('verify gets git, exec and the config as parameters: it imports none of their modules', () => {
  const edges = ['./exec.ts', './gh.ts', './git.ts', './factory.ts', 'node:child_process', 'node:fs'];
  assert.deepEqual(imports('verify.ts').filter((i) => !i.type && edges.includes(i.from)), []);
});

test('the publish decisions are pure: publishing.ts imports nothing', () => {
  assert.deepEqual(imports('publishing.ts'), []);
});

test('the review decisions are pure: reviewing.ts imports nothing', () => {
  assert.deepEqual(imports('reviewing.ts'), []);
});

test('publish, its two steps and the snapshot get gh, git and the config as parameters: they import none of their modules, nor node:fs', () => {
  const edges = ['./exec.ts', './gh.ts', './git.ts', './factory.ts', 'node:child_process', 'node:fs'];
  for (const file of ['publish.ts', 'publish-clone.ts', 'publish-merged.ts', 'snapshot.ts']) {
    assert.deepEqual(imports(file).filter((i) => !i.type && edges.includes(i.from)), [], file);
  }
});

// Every file of dynamo/ imports only node: modules and files inside dynamo/: nothing from outside, and no package
// (a test may also import the pure logic of the pane in mods/, which only the development repository has).
test('dynamo imports only node: modules and its own files', () => {
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]);
  const all = files(root);
  assert.ok(!all.some((f) => /node_modules|package(-lock)?\.json$/.test(relative(root, f))), 'no packages');
  for (const f of all.filter((n) => /\.[jt]s$/.test(n))) {
    const source = readFileSync(f, 'utf8');
    for (const m of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g)) {
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

// The column names are Dynamo's (columns.ts), and the board's values are the `board` block's: the code reads neither
// `columns` nor `phases` from factory.json, nor an id of the board from `project`.
test('the code reads no columns or phases from factory.json and no board value from project', () => {
  for (const n of sources) {
    assert.doesNotMatch(text(n), /\bfactory\.(columns|phases|options)\b|'(columns|phases)'/, n);
    assert.doesNotMatch(text(n), /\bsetting\(\s*[\w.]*project\s*,\s*'project'\s*,\s*'(boardNumber|boardId|boardName|statusFieldId)'/, n);
  }
});

test('the decisions of setup are pure: setups.ts imports nothing but types, the shared helper, the checks and the names of the columns, and setupsettings.ts and setupci.ts only types', () => {
  assert.deepEqual(imports('setupsettings.ts').filter((i) => !i.type), []);
  assert.deepEqual(imports('setupci.ts').filter((i) => !i.type), []);
  assert.deepEqual(imports('setups.ts').filter((i) => !i.type && !['./cli.ts', './checks.ts', './columns.ts'].includes(i.from)), []);
});

test('setup gets gh, git, exec and its files as parameters: it imports none of their modules', () => {
  const edges = ['./exec.ts', './gh.ts', './git.ts', './factory.ts', './setupfiles.ts', 'node:child_process', 'node:fs'];
  for (const name of ['setup.ts', 'setups.ts', 'setupboard.ts', 'setupsettings.ts', 'setupci.ts', 'setupcommit.ts']) assert.deepEqual(imports(name).filter((i) => !i.type && edges.includes(i.from)), [], name);
});
