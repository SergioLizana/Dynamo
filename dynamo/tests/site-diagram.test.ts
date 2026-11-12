// How the site shows an archify diagram (site/assets/diagram.js): the address carries the site's active theme (and
// `embed=1` when asked), Live motion is stored before a diagram loads unless motion is reduced, a blocked localStorage
// never breaks the page, and the two pages that show a diagram use the shared helper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const repo = resolve(import.meta.dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(repo, 'site', ...parts), 'utf8');

type Diagram = { url(file: string, embed?: boolean): string; prepare(): void };

function load(opts: { theme?: string; reduced?: boolean; blocked?: boolean }) {
  const stored: Record<string, string> = {};
  const window = {
    DynamoSite: {} as Record<string, unknown>,
    matchMedia: () => ({ matches: !!opts.reduced }),
    localStorage: {
      setItem(key: string, value: string) {
        if (opts.blocked) throw new Error('blocked');
        stored[key] = value;
      },
    },
  };
  const document = { documentElement: { dataset: { theme: opts.theme ?? 'light' } } };
  runInNewContext(read('assets', 'diagram.js'), { window, document, MutationObserver: class { observe() {} } });
  return { diagram: window.DynamoSite.diagram as Diagram, stored };
}

test('the address of a diagram carries the active theme, and embed only when asked', () => {
  assert.equal(load({ theme: 'dark' }).diagram.url('a.html'), 'a.html?theme=dark');
  assert.equal(load({ theme: 'light' }).diagram.url('a.html', true), 'a.html?theme=light&embed=1');
});

test('Live motion is stored before a diagram loads', () => {
  const { diagram, stored } = load({});
  diagram.prepare();
  assert.equal(stored['archify-motion'], 'live');
});

test('under reduced motion nothing is stored', () => {
  const { diagram, stored } = load({ reduced: true });
  diagram.prepare();
  assert.deepEqual(stored, {});
});

test('a blocked localStorage does not throw', () => {
  const { diagram } = load({ blocked: true });
  assert.doesNotThrow(() => diagram.prepare());
});

test('the map and the journey use the shared helper, not their own addresses', () => {
  for (const [page, file] of [['map', 'map.js'], ['journey', 'journey.diagram.js']]) {
    assert.match(read(page, file), /DynamoSite\.diagram|site\.diagram/);
    assert.match(read(page, 'index.html'), /assets\/diagram\.js/);
  }
  assert.match(read('map', 'map.js'), /embed|, true\)/);
});

// A diagram shown in the page (`diagram.mount`): the frame loads the file of the language with the embedded mode and the
// theme, the full screen button toggles the page's class and goes back, and Escape goes back too.
function fakeNode() {
  const attrs: Record<string, string> = {};
  const classes = new Set<string>();
  const handlers: Record<string, (e: unknown) => void> = {};
  return {
    attrs,
    classes,
    handlers,
    getAttribute: (k: string) => attrs[k] ?? null,
    setAttribute(k: string, v: string) {
      attrs[k] = v;
    },
    classList: {
      toggle(c: string, force: boolean) {
        if (force) classes.add(c);
        else classes.delete(c);
      },
      contains: (c: string) => classes.has(c),
    },
    addEventListener(type: string, fn: (e: unknown) => void) {
      handlers[type] = fn;
    },
    style: {} as Record<string, string>,
  };
}

test('mount shows the diagram of the language in the frame and toggles full screen', () => {
  const figure = fakeNode();
  const frame = fakeNode();
  const button = fakeNode();
  const doc = fakeNode();
  const stored: Record<string, string> = {};
  const win = {
    DynamoSite: { i18n: { lang: () => 'es' } } as Record<string, unknown>,
    matchMedia: () => ({ matches: false }),
    localStorage: { setItem: (k: string, v: string) => (stored[k] = v) },
  };
  const document = Object.assign(doc, {
    documentElement: { dataset: { theme: 'dark' } },
    querySelector: () => null,
  });
  figure.addEventListener = ((type: string, fn: (e: unknown) => void) => void (figure.handlers[type] = fn)) as never;
  (figure as Record<string, unknown>).querySelector = (sel: string) => (sel.includes('toggle') ? button : frame);
  runInNewContext(read('assets', 'diagram.js'), { window: win, document, MutationObserver: class { observe() {} } });
  (win.DynamoSite.diagram as { mount(f: unknown, name: string): void }).mount(figure, 'journey.board');
  assert.equal(frame.attrs.src, 'journey.board.es.html?theme=dark&embed=1');
  button.handlers.click({});
  assert.equal(figure.classes.has('diagram--full'), true);
  assert.equal(button.attrs['aria-pressed'], 'true');
  button.handlers.click({});
  assert.equal(figure.classes.has('diagram--full'), false);
  button.handlers.click({});
  doc.handlers.keydown({ key: 'Escape' });
  assert.equal(figure.classes.has('diagram--full'), false);
  assert.equal(button.attrs['aria-pressed'], 'false');
});
