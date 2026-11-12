// The site's logo is Dynamo's own: the three SVGs of the site are the originals of `assets/`, the favicon is only the grid
// of cells, the hero draws the same cells as the logo, the logo has its text alternative in both languages, the accent is
// the logo's teal in both themes, nothing of the old mark is left, and the motion script leaves the sections alone under
// `prefers-reduced-motion: reduce`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const repo = resolve(import.meta.dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(repo, 'site', ...parts), 'utf8');
const names = ['dynamo-logo.svg', 'dynamo-logo-dark.svg', 'dynamo-logo-light.svg'];
const pages = [['index.html', 'assets/'], ['journey/index.html', '../assets/'], ['map/index.html', '../assets/'], ['install/index.html', '../assets/'], ['concepts/index.html', '../assets/']];

type Node = { tag: string; attrs: Record<string, string>; children: Node[]; setAttribute(k: string, v: string | number): void; appendChild(n: Node): Node };
function node(tag: string): Node {
  const n: Node = { tag, attrs: {}, children: [], setAttribute: (k, v) => { n.attrs[k] = String(v); }, appendChild: (c) => { n.children.push(c); return c; } };
  return n;
}

test('the three logo SVGs of the site are the same as the originals', () => {
  for (const name of names) assert.equal(read('assets', name), readFileSync(join(repo, 'assets', name), 'utf8'), name);
});

test('the favicon is a square SVG with the logo\'s cells and no text', () => {
  const svg = read('assets', 'favicon.svg');
  const box = svg.match(/viewBox="[\d.-]+ [\d.-]+ ([\d.]+) ([\d.]+)"/);
  assert.ok(box && box[1] === box[2], 'square');
  const logo = read('assets', 'dynamo-logo.svg');
  for (const points of logo.match(/points="[^"]+"/g) ?? []) assert.ok(svg.includes(points), points);
  assert.equal((svg.match(/<polygon/g) ?? []).length, 3);
  assert.ok(!/class="tx[sa]"|<text/.test(svg));
});

test('the hero draws the same three cells as the logo, with a text alternative', () => {
  const holder = { appendChild: (n: Node) => { drawn.push(n); return n; } };
  const drawn: Node[] = [];
  const document = { createElementNS: (_ns: string, tag: string) => node(tag), querySelectorAll: () => [holder] };
  runInNewContext(read('assets', 'hero-logo.js'), { window: {}, document });
  assert.equal(drawn.length, 1);
  const cells: string[] = [];
  const walk = (n: Node) => { if (n.tag === 'polygon') cells.push(n.attrs.points); n.children.forEach(walk); };
  walk(drawn[0]);
  const logo = read('assets', 'dynamo-logo.svg');
  assert.deepEqual(cells, [...logo.matchAll(/points="([^"]+)"/g)].map((m) => m[1]));
  assert.equal(drawn[0].attrs.role, 'img');
  assert.equal(drawn[0].attrs['data-i18n-attr'], 'aria-label:logo.alt');
});

test('the logo has a text alternative in English and Spanish', () => {
  const dictionary: Record<string, Record<string, string>> = { en: {}, es: {} };
  const i18n = { register: (d: typeof dictionary) => { Object.assign(dictionary.en, d.en); Object.assign(dictionary.es, d.es); } };
  runInNewContext(read('assets', 'shared.i18n.js'), { window: { DynamoSite: { i18n } } });
  for (const code of ['en', 'es']) assert.ok((dictionary[code]['logo.alt'] ?? '').trim().length > 0, code);
});

test('the header shows the dark and the light logo, and every page has the favicon and the hero script where needed', () => {
  const layout = read('assets', 'layout.js');
  assert.ok(layout.includes("'assets/dynamo-logo-' + version + '.svg'") && layout.includes("['dark', 'light']"));
  for (const [page, prefix] of pages) {
    const html = read(page);
    assert.ok(html.includes(`<link rel="icon" type="image/svg+xml" href="${prefix}favicon.svg">`), page);
    assert.ok(html.includes(`src="${prefix}motion.js"`), page);
  }
  assert.match(read('index.html'), /data-hero-logo/);
  assert.match(read('index.html'), /src="assets\/hero-logo\.js"/);
});

test('the accent is the logo\'s teal in both themes and the old mark is gone', () => {
  const tokens = read('assets', 'tokens.css');
  const [light, dark] = tokens.split(':root[data-theme="dark"]');
  assert.match(light, /--color-accent: #0E9F8E;/);
  assert.match(dark, /--color-accent: #2DD4BF;/);
  for (const old of ['#0969da;\n  --color-accent', '--color-accent: #0969da', '--color-accent: #4493f8', '#1f6feb']) assert.ok(!tokens.includes(old), old);
  assert.ok(!existsSync(join(repo, 'site', 'assets', 'logo.svg')));
  assert.ok(!existsSync(join(repo, 'site', 'assets', 'logo.js')));
  assert.ok(!existsSync(join(repo, 'dynamo', 'tests', 'site-logo.test.ts')));
});

function runMotion(reduce: boolean) {
  const classes: string[] = [];
  const section = { classList: { add: (c: string) => classes.push(c) } };
  let observed = 0;
  class Observer { observe() { observed++; } unobserve() {} }
  const window = { matchMedia: () => ({ matches: reduce }), IntersectionObserver: Observer };
  runInNewContext(read('assets', 'motion.js'), { window, IntersectionObserver: Observer, document: { querySelectorAll: () => [section] } });
  return { classes, observed };
}

test('the sections are made to come in only when motion is allowed', () => {
  assert.deepEqual(runMotion(true), { classes: [], observed: 0 });
  assert.deepEqual(runMotion(false), { classes: ['reveal'], observed: 1 });
});
