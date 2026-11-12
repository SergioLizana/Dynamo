// The map of the site (site/map/) against what exists in the repository: every skill, agent, hook and subcommand is a node,
// no node names something that does not exist, every edge joins two nodes, every node has its two texts in both languages, and
// the Archify sources that draw the map hold the same nodes and edges as the data the page renders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const repo = resolve(import.meta.dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(repo, ...parts), 'utf8');

type Node = { id: string; kind: string; name: string; source: string };
type Edge = { from: string; to: string; type: string };
type Map = { nodes: Node[]; edges: Edge[]; edgeTypes: string[] };
type Dictionary = Record<'en' | 'es', Record<string, string>>;

// The page's scripts are classic scripts that write on `window.DynamoSite`; they run here in an empty context.
function load(file: string, site: Record<string, unknown>): void {
  runInNewContext(read('site', 'map', file), { window: { DynamoSite: site }, console });
}

const site: Record<string, unknown> = {};
load('map.data.js', site);
// Through JSON, so that the arrays are of this realm and not of the context the script ran in (deepStrictEqual compares prototypes).
const map = JSON.parse(JSON.stringify(site.map)) as Map;

const dictionary: Dictionary = { en: {}, es: {} };
load('map.i18n.js', { i18n: { register: (d: Dictionary) => { Object.assign(dictionary.en, d.en); Object.assign(dictionary.es, d.es); } } });

const idsOf = (kind: string) => map.nodes.filter((n) => n.kind === kind).map((n) => n.id.slice(kind.length + 1)).sort();

test('every skill of skills/ is a node of the map, and no node is a skill that does not exist', () => {
  const skills = readdirSync(join(repo, 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(repo, 'skills', d.name, 'SKILL.md'))).map((d) => d.name).sort();
  assert.deepEqual(idsOf('skill'), skills);
});

test('every agent of agents/ is a node of the map, and no node is an agent that does not exist', () => {
  const agents = readdirSync(join(repo, 'agents')).filter((n) => n.endsWith('.md')).map((n) => n.slice(0, -3)).sort();
  assert.deepEqual(idsOf('agent'), agents);
});

test('every hook of hooks/hooks.json is a node of the map, and no node is a hook that does not exist', () => {
  const hooks = JSON.parse(read('hooks', 'hooks.json')) as { hooks: Record<string, { hooks: { command: string }[] }[]> };
  const files = Object.values(hooks.hooks).flat().flatMap((entry) => entry.hooks.map((h) => /hooks\/([\w-]+)\.js/.exec(h.command)?.[1] ?? ''));
  assert.ok(files.every((f) => f !== ''), 'every hook command names a file of hooks/');
  assert.deepEqual(idsOf('hook'), [...new Set(files)].sort());
});

test('every subcommand of dynamo/dynamo.ts is a node of the map, and no node is a subcommand that does not exist', () => {
  const entry = read('dynamo', 'dynamo.ts');
  const names = [...entry.slice(entry.indexOf('new Map<string, Subcommand>')).split(']);')[0].matchAll(/\['([\w-]+)',/g)].map((m) => m[1]).sort();
  assert.ok(names.length > 0);
  assert.deepEqual(idsOf('command'), names);
});

test('every node has a unique id, and its source is a file of the repository', () => {
  assert.equal(new Set(map.nodes.map((n) => n.id)).size, map.nodes.length);
  for (const n of map.nodes) assert.ok(existsSync(join(repo, n.source)), `${n.id}: ${n.source} does not exist`);
});

test('every edge joins two nodes of the map with a known type', () => {
  const ids = new Set(map.nodes.map((n) => n.id));
  for (const e of map.edges) {
    assert.ok(ids.has(e.from) && ids.has(e.to), `${e.from} -> ${e.to}`);
    assert.ok(map.edgeTypes.includes(e.type), `${e.from} -> ${e.to}: ${e.type}`);
  }
});

test('a skill launches subcommands and a subcommand launches agents: the launches go from skill to subcommand and from subcommand to subcommand or agent', () => {
  const kind = (id: string) => map.nodes.find((n) => n.id === id)?.kind;
  const launches = map.edges.filter((e) => e.type === 'launches');
  assert.ok(launches.some((e) => kind(e.from) === 'skill' && kind(e.to) === 'command'));
  assert.ok(launches.some((e) => kind(e.from) === 'command' && kind(e.to) === 'agent'));
  for (const e of launches) assert.ok(['skill', 'command'].includes(kind(e.from) ?? ''), `${e.from} launches ${e.to}`);
});

test('every node and every kind and edge type has its texts in English and Spanish, under the same keys', () => {
  assert.deepEqual(Object.keys(dictionary.en).sort(), Object.keys(dictionary.es).sort());
  const keys = [
    ...map.nodes.flatMap((n) => [`map.node.${n.id}.does`, `map.node.${n.id}.when`]),
    ...[...new Set(map.nodes.map((n) => n.kind))].flatMap((k) => [`map.kind.${k}`, `map.kind.${k}.title`, `map.kind.${k}.intro`]),
    ...map.edgeTypes.flatMap((t) => [`map.edge.${t}.out`, `map.edge.${t}.in`]),
  ];
  for (const k of keys) for (const l of ['en', 'es'] as const) assert.ok((dictionary[l][k] ?? '').trim() !== '', `${l}: ${k}`);
});

test('the Archify sources of both languages hold the nodes and edges of the data the page renders', () => {
  const edges = map.edges.map((e) => `${e.from}>${e.to}`).sort();
  const nodes = map.nodes.map((n) => n.id).sort();
  for (const lang of ['en', 'es']) {
    const source = JSON.parse(read('site', 'map', `map.${lang}.archify.json`)) as { meta: { locale: string }; components: { id: string }[]; connections: { from: string; to: string }[] };
    assert.equal(source.meta.locale, lang);
    assert.deepEqual(source.components.map((c) => c.id).sort(), nodes, lang);
    assert.deepEqual(source.connections.map((c) => `${c.from}>${c.to}`).sort(), edges, lang);
  }
});

test('every node says who runs it: a skill the session, an agent its own level, anything else no model', () => {
  const expected: Record<string, string> = { skill: 'session', agent: '', command: 'none', hook: 'none', feature: 'none' };
  for (const n of map.nodes as (Node & { runner?: string })[]) {
    const want = n.kind === 'agent' ? n.id.slice('agent-'.length) : expected[n.kind];
    assert.equal(n.runner, want, n.id);
  }
});

test('the runners, the efforts and the reasons for the levels have their texts in English and Spanish', () => {
  const keys = [
    ...['session', 'builder', 'reviewer', 'none'].map((r) => `map.runner.${r}`),
    ...['low', 'medium', 'high', 'none'].map((e) => `map.effort.${e}`),
    ...['low', 'medium', 'high'].flatMap((l) => ['builder', 'reviewer'].map((a) => `map.level.${l}.${a}.why`)),
    'map.detail.runner', 'map.level.caption', 'map.level.level', 'map.level.model', 'map.level.effort', 'map.level.why', 'map.level.default',
  ];
  for (const k of keys) for (const l of ['en', 'es'] as const) assert.ok((dictionary[l][k] ?? '').trim() !== '', `${l}: ${k}`);
});

test('every node has the takes, leaves and example parts of its detail, in English and Spanish', () => {
  const nodes = map.nodes;
  assert.equal(nodes.length, 28);
  const keys = [
    ...nodes.flatMap((n) => ['takes', 'leaves', 'example'].map((p) => `map.node.${n.id}.${p}`)),
    'map.detail.takes', 'map.detail.leaves', 'map.detail.example', 'map.detail.close',
  ];
  for (const k of keys) for (const l of ['en', 'es'] as const) assert.ok((dictionary[l][k] ?? '').trim() !== '', `${l}: ${k}`);
});
