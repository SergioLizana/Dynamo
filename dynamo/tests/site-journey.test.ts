// The journey page, «The board at work» (site/journey/): it is titled so in both languages and lives in `journey/`, it shows the
// board and, below it, one prose section per column in the order of the board, each with what happens, who acts, what runs
// there and where the card goes next, and the scroll walk (phases and step blocks) is gone. The diagram section stays.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const repo = resolve(import.meta.dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(repo, 'site', ...parts), 'utf8');

type Dictionary = Record<'en' | 'es', Record<string, string>>;
const dictionary: Dictionary = { en: {}, es: {} };
const i18n = { register: (d: Dictionary) => { Object.assign(dictionary.en, d.en); Object.assign(dictionary.es, d.es); } };
for (const file of [['assets', 'shared.i18n.js'], ['assets', 'board.i18n.js'], ['journey', 'journey.i18n.js']]) {
  runInNewContext(read(...file), { window: { DynamoSite: { i18n } }, console });
}
const both = (key: string) => (['en', 'es'] as const).every((l) => (dictionary[l][key] ?? '').trim() !== '');

const site: Record<string, unknown> = {};
runInNewContext(read('assets', 'board.data.js'), { window: { DynamoSite: site } });
const columns = (JSON.parse(JSON.stringify(site.boardData)) as { columns: { id: string; runs: string }[] }).columns;

// The tiny page journey.js needs: it draws into `[data-columns]` and records every element it makes
type El = { tag: string; attrs: Record<string, string>; children: El[]; text: string };
function el(tag: string): El & Record<string, unknown> {
  const n: El & Record<string, unknown> = {
    tag, attrs: {}, children: [], text: '', className: '',
    setAttribute: (k: string, v: string) => { n.attrs[k] = v; },
    appendChild: (c: El) => { n.children.push(c); return c; },
    append: (...cs: El[]) => { cs.forEach((c) => n.children.push(c)); },
  };
  Object.defineProperty(n, 'textContent', { set: (v: string) => { n.text = v; }, get: () => n.text });
  return n;
}
const walk = (n: El): El[] => [n, ...n.children.flatMap(walk)];

function drawn() {
  const root = el('div');
  const win: Record<string, unknown> = { DynamoSite: { i18n: { apply: () => {} } } };
  const context = { window: win, document: { createElement: el, querySelector: () => root } };
  for (const file of [['assets', 'levels.js'], ['assets', 'board.data.js'], ['journey', 'journey.js']]) runInNewContext(read(...file), context);
  return root;
}

describe('the page', () => {
  const html = read('journey', 'index.html');

  test('is titled «The board at work» in both languages, and its folder is journey/', () => {
    assert.equal(dictionary.en['journey.title'], 'The board at work');
    assert.equal(dictionary.es['journey.title'], 'El tablero en marcha');
    assert.equal(dictionary.en['page.journey.title'], 'The board at work');
    assert.equal(dictionary.es['page.journey.title'], 'El tablero en marcha');
    assert.match(read('assets', 'pages.js'), /href: 'journey\/index\.html'/);
  });

  test('has the board, then the prose of the columns, then the diagram, and not the scroll walk', () => {
    const order = ['data-board', 'data-columns', 'data-diagram-frame'].map((m) => html.indexOf(m));
    assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], order.join());
    assert.doesNotMatch(html, /data-phases|data-follow|journey-board|journey\.steps|data-step/);
  });

  test('every text its HTML names is in both languages', () => {
    assert.deepEqual(Object.keys(dictionary.en).sort(), Object.keys(dictionary.es).sort());
    for (const [, key] of html.matchAll(/data-i18n="([^"]+)"/g)) assert.ok(both(key), key);
    for (const [, pairs] of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
      for (const pair of pairs.split(';')) assert.ok(both(pair.slice(pair.indexOf(':') + 1).trim()), pair);
    }
  });
});

describe('the prose of the columns', () => {
  const root = drawn();
  const sections = root.children;

  test('is one section per column, in the order of the board, eight of them', () => {
    assert.equal(columns.length, 8);
    assert.deepEqual(sections.map((s) => s.attrs['data-column']), columns.map((c) => c.id));
  });

  test('each section has its text for what happens, who acts and where the card goes next, in both languages', () => {
    for (const column of columns) for (const part of ['what', 'who', 'next']) assert.ok(both(`journey.col.${column.id}.${part}`), `${column.id} ${part}`);
  });

  test('the Builder and the Reviewer show their model and effort at every level, the other columns say what runs', () => {
    for (const [i, column] of columns.entries()) {
      const rows = walk(sections[i]).filter((n) => n.tag === 'tr' && n.children.some((c) => c.tag === 'td'));
      const runs = column.runs;
      if (runs === 'builder' || runs === 'reviewer') assert.equal(rows.length, 3, column.id);
      else {
        assert.equal(rows.length, 0, column.id);
        assert.ok(walk(sections[i]).some((n) => n.attrs['data-i18n'] === `journey.line.${runs}`), column.id);
      }
    }
  });

  test('the models and efforts shown are those of the levels', () => {
    const cells = walk(sections[columns.findIndex((c) => c.runs === 'reviewer')]).filter((n) => n.tag === 'td');
    const text = cells.map((c) => walk(c).map((n) => n.text).join(''));
    assert.deepEqual(text.map((t) => t.split(',')[0]), ['sonnet', 'sonnet', 'opus']);
  });
});
