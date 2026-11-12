// The home page of the site (site/) against what it renders: the chain's steps name skills that exist and have their texts in
// both languages, every idea taken from someone names who, links to a public repository and says what Dynamo adds, every text
// the page names is in both dictionaries, and «what it gains» is gone with nothing left pointing at it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const repo = resolve(import.meta.dirname, '..', '..');
const site = (...parts: string[]) => join(repo, 'site', ...parts);
const read = (...parts: string[]) => readFileSync(site(...parts), 'utf8');

type Dictionary = Record<'en' | 'es', Record<string, string>>;
type Step = { id: string; command: string | null };
type Origin = { id: string; who: string; url: string; repo: string; ideas: string[] };

// The page's scripts are classic scripts that write on `window.DynamoSite`; they run here in an empty context.
function load(file: string, window: Record<string, unknown>): void {
  runInNewContext(read(file), { window, console });
}

const data: Record<string, unknown> = {};
load('story.data.js', { DynamoSite: data });
// Through JSON, so that the arrays are of this realm and not of the context the script ran in.
const chain = JSON.parse(JSON.stringify(data.chain)) as Step[];
const truth = JSON.parse(JSON.stringify(data.truth)) as { id: string }[];
const origins = JSON.parse(JSON.stringify(data.origins)) as Origin[];

const dictionary: Dictionary = { en: {}, es: {} };
const i18n = { register: (d: Dictionary) => { Object.assign(dictionary.en, d.en); Object.assign(dictionary.es, d.es); } };
for (const file of ['assets/shared.i18n.js', 'assets/board.i18n.js', 'home.i18n.js', 'story.i18n.js']) load(file, { DynamoSite: { i18n } });

const both = (key: string) => ['en', 'es'].every((l) => (dictionary[l as 'en' | 'es'][key] ?? '').trim() !== '');

test('the chain has the five steps in order, each running a skill that exists, the last one being the pull request', () => {
  assert.deepEqual(chain.map((s) => s.id), ['discover', 'spec', 'tickets', 'autopilot', 'pr']);
  for (const step of chain.slice(0, -1)) {
    assert.match(step.command ?? '', /^\/dynamo:[a-z-]+$/);
    assert.ok(existsSync(join(repo, 'skills', (step.command as string).slice('/dynamo:'.length), 'SKILL.md')), step.command as string);
  }
  assert.equal(chain.at(-1)?.command, null);
});

test('every step of the chain has its title and what it gains, in both languages', () => {
  for (const step of chain) for (const part of ['title', 'gains']) assert.ok(both(`chain.step.${step.id}.${part}`), `${step.id} ${part}`);
});

test('every part of the source of truth has its title and its text, in both languages', () => {
  assert.deepEqual(truth.map((t) => t.id), ['decisions', 'state', 'why']);
  for (const item of truth) for (const part of ['title', 'text']) assert.ok(both(`truth.item.${item.id}.${part}`), `${item.id} ${part}`);
});

test('every idea taken names who, links to a public repository of theirs and says what Dynamo adds', () => {
  assert.deepEqual(origins.map((o) => o.who), ['Matt Pocock', 'Lauren Tan']);
  for (const origin of origins) {
    assert.match(origin.url, /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+/);
    assert.ok(origin.repo.length > 0 && origin.url.endsWith(origin.repo.replace('github.com/', '')), origin.repo);
    assert.ok(origin.ideas.length > 0, origin.who);
    for (const id of origin.ideas) for (const part of ['idea', 'adds']) assert.ok(both(`origin.${id}.${part}`), `${id} ${part}`);
  }
});

test('the two dictionaries hold the same keys, and every key the page names exists', () => {
  assert.deepEqual(Object.keys(dictionary.en).sort(), Object.keys(dictionary.es).sort());
  const html = read('index.html');
  for (const [, key] of html.matchAll(/data-i18n="([^"]+)"/g)) assert.ok(both(key), key);
  for (const [, pairs] of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
    for (const pair of pairs.split(';')) assert.ok(both(pair.slice(pair.indexOf(':') + 1).trim()), pair);
  }
});

test('the home page has its parts in order, and the hero\'s call to action goes to «Take it apart»', () => {
  const html = read('index.html');
  const titles = [...html.matchAll(/<section[^>]*aria-labelledby="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(titles, ['hero-title', 'chain-title', 'board-title', 'truth-title', 'origin-title', 'explore-title', 'install-title']);
  const cta = html.match(/<a[^>]*href="#([^"]+)"[^>]*data-i18n="hero\.cta"/);
  assert.ok(cta, 'the call to action is a link to a part of the page');
  assert.match(html, new RegExp(`<section[^>]*id="${cta[1]}"[^>]*aria-labelledby="explore-title"`));
});

test('«what it gains» is gone: no file of it, and nothing links to it', () => {
  const files = readdirSync(site());
  assert.deepEqual(files.filter((f) => f.startsWith('gains')), []);
  for (const file of ['index.html', 'home.css', 'home.i18n.js', 'story.js', 'story.data.js', 'story.i18n.js']) assert.doesNotMatch(read(file), /gains\.(js|data|i18n)|data-slot="gains"|\.gain\b/, file);
  assert.deepEqual(Object.keys(dictionary.en).filter((k) => k.startsWith('gains.')), []);
});

test('«how it compares» is gone: no file of it, nothing of it in the page, the dictionary or the README, and the board has its «What just happened» line', () => {
  const files = readdirSync(site());
  assert.deepEqual(files.filter((f) => f.startsWith('compare')), []);
  const html = read('index.html');
  assert.doesNotMatch(html, /compare/i);
  for (const file of ['home.css', 'home.i18n.js', 'README.md']) assert.doesNotMatch(read(file), /how it compares|compare\.(js|css|data|i18n)|compareAlternatives|data-slot="compare"/i, file);
  assert.deepEqual(Object.keys(dictionary.en).filter((k) => k.startsWith('compare.')), []);
  assert.match(html, /<div[^>]*data-board/);
  assert.ok(both('board.what'));
});
