// The side index of a subpage: its section in view is the last whose top passed the line, it is drawn from the h2 of
// <main> (and not on the home page or on a page of one section), it follows the language through the heading's key,
// and the scroll moves the mark.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const source = readFileSync(join(resolve(import.meta.dirname, '..', '..'), 'site', 'assets', 'toc.js'), 'utf8');

type Node = {
  tag: string; className: string; attrs: Record<string, string>; children: Node[]; textContent: string;
  setAttribute(k: string, v: string): void; getAttribute(k: string): string | null; removeAttribute(k: string): void;
  appendChild(n: Node): Node; insertBefore(n: Node, ref: Node | null): void; classList: { add(c: string): void };
  firstChild: Node | null; getBoundingClientRect(): { top: number };
};
function node(tag: string, top = 0, attrs: Record<string, string> = {}): Node {
  const n: Node = {
    tag, className: '', attrs: { ...attrs }, children: [], textContent: '', firstChild: null,
    setAttribute: (k, v) => { n.attrs[k] = String(v); },
    getAttribute: (k) => n.attrs[k] ?? null,
    removeAttribute: (k) => { delete n.attrs[k]; },
    appendChild: (c) => { n.children.push(c); return c; },
    insertBefore: (c) => { n.children.unshift(c); },
    classList: { add: (c) => { n.className += ' ' + c; } },
    getBoundingClientRect: () => ({ top }),
  };
  return n;
}
const all = (n: Node, tag: string): Node[] => n.children.flatMap((c) => [...(c.tag === tag ? [c] : []), ...all(c, tag)]);

function run(page: string, tops: number[]) {
  const headings = tops.map((top, i) => Object.assign(node('h2', top, { id: `s${i}`, 'data-i18n': `k${i}` }), { id: `s${i}` }));
  const main = node('main');
  Object.assign(main, { querySelectorAll: () => headings });
  const listeners: Record<string, () => void> = {};
  const site: Record<string, unknown> = {};
  const document = { querySelector: () => main, documentElement: { dataset: { page } }, createElement: (t: string) => node(t) };
  const window = {
    DynamoSite: site, innerHeight: 900,
    matchMedia: () => ({ matches: true, addEventListener: () => {} }),
    addEventListener: (name: string, fn: () => void) => { listeners[name] = fn; },
  };
  runInNewContext(source, { window, document });
  return { main, headings, listeners, site };
}

test('the section in view is the last one whose top passed the line, the first when none did', () => {
  const { site } = run('home', []);
  const { currentId } = site.toc as { currentId(s: { id: string; top: number }[], line: number): string };
  const sections = [{ id: 'a', top: -400 }, { id: 'b', top: 100 }, { id: 'c', top: 500 }];
  assert.equal(currentId(sections, 300), 'b');
  assert.equal(currentId(sections, 600), 'c');
  assert.equal(currentId(sections.map((s) => ({ ...s, top: s.top + 1000 })), 300), 'a');
  assert.equal(currentId([], 300), '');
});

test('a subpage gets a link per h2, with the heading\'s own key, and the first is marked', () => {
  const { main } = run('map', [50, 700, 1400]);
  const links = all(main, 'a');
  assert.deepEqual(links.map((l) => l.attrs.href), ['#s0', '#s1', '#s2']);
  assert.deepEqual(links.map((l) => l.attrs['data-i18n']), ['k0', 'k1', 'k2']);
  assert.deepEqual(links.map((l) => l.attrs['aria-current']), ['true', undefined, undefined]);
  assert.ok(main.className.includes('has-toc'));
});

test('scrolling moves the mark to the section in view', () => {
  const { headings, main, listeners } = run('map', [50, 700, 1400]);
  [-900, -200, 500].forEach((top, i) => { headings[i].getBoundingClientRect = () => ({ top }); });
  listeners.scroll();
  assert.deepEqual(all(main, 'a').map((l) => l.attrs['aria-current']), [undefined, 'true', undefined]);
});

test('the home page and a page with a single heading get no index', () => {
  assert.equal(all(run('home', [10, 20, 30]).main, 'nav').length, 0);
  assert.equal(all(run('install', [10]).main, 'nav').length, 0);
  assert.equal(all(run('install', [10, 400]).main, 'nav').length, 1);
});

test('the index texts exist in English and Spanish, and every subpage loads the script', () => {
  const dictionary: Record<string, Record<string, string>> = { en: {}, es: {} };
  const i18n = { register: (d: typeof dictionary) => { Object.assign(dictionary.en, d.en); Object.assign(dictionary.es, d.es); } };
  const shared = readFileSync(join(resolve(import.meta.dirname, '..', '..'), 'site', 'assets', 'shared.i18n.js'), 'utf8');
  runInNewContext(shared, { window: { DynamoSite: { i18n } } });
  for (const code of ['en', 'es']) for (const key of ['toc.label', 'toc.title']) assert.ok((dictionary[code][key] ?? '').trim(), `${code} ${key}`);
  for (const page of ['map', 'install', 'concepts']) {
    const html = readFileSync(join(resolve(import.meta.dirname, '..', '..'), 'site', page, 'index.html'), 'utf8');
    assert.ok(html.includes('<script src="../assets/toc.js" defer></script>'), page);
  }
  // The journey page has none: its board takes the width of the window
  const journey = readFileSync(join(resolve(import.meta.dirname, '..', '..'), 'site', 'journey', 'index.html'), 'utf8');
  assert.ok(!journey.includes('toc.js'), 'journey');
});
