// The animated board of the site (site/assets/board.data.js, board.player.js and board.js): three example tickets move at once within
// the limit of three slots and one merge at a time, each ticket takes the route it is told to take, the player takes one beat
// every 4 seconds, rests at the end and starts again, never plays by itself where motion is reduced, the cards slide only where
// motion is allowed, both pages carry the same component, and every text the board names is in both languages.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const repo = resolve(import.meta.dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(repo, 'site', ...parts), 'utf8');

type Move = { id: string; to: string; note: string };
type Data = {
  columns: { id: string; actor: string; runs: string }[];
  running: string[];
  slots: number;
  tickets: { id: string; number: number; level: string }[];
  start: Move[];
  beats: { moves: Move[] }[];
};
type State = { columns: Record<string, string[]>; notes: Record<string, string>; what: string };
type Place = { left: number; top: number };
type Timers = { setTimeout(fn: () => void, ms: number): number; clearTimeout(id: number): void };
type Player = { index(): number; playing(): boolean; go(i: number): void; play(): void; pause(): void };
type Board = {
  BEAT_MS: number;
  END_MS: number;
  SLIDE_MS: number;
  stateAt(data: Data, index: number): State;
  slides(before: Record<string, Place>, after: Record<string, Place>, animate: boolean, turned?: boolean):{ id: string; dx: number; dy: number }[];
  createPlayer(o: { count: number; onChange(i: number): void; timers: Timers }): Player;
};

const site: Record<string, unknown> = {};
runInNewContext(read('assets', 'board.player.js'), { window: { DynamoSite: site } });
runInNewContext(read('assets', 'board.data.js'), { window: { DynamoSite: site } });
const board = site.board as Board;
const data = JSON.parse(JSON.stringify(site.boardData)) as Data;
// Through JSON, so that the arrays are of this realm and not of the context the script ran in
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
const count = data.beats.length + 1;
const states = Array.from({ length: count }, (_, i) => plain(board.stateAt(data, i)) as State);
const columnOf = (state: State, id: string) => Object.keys(state.columns).find((c) => state.columns[c].includes(id));
// The route of a ticket: the columns it is in, one after the other, without repeating the one it stays in
const route = (id: string) => states.map((s) => columnOf(s, id)!).filter((c, i, all) => i === 0 || c !== all[i - 1]);

// Fake timers: `fire()` runs the one timeout that is waiting, and `waits` keeps every delay asked for
function fakeTimers() {
  const waiting = new Map<number, () => void>();
  const waits: number[] = [];
  let next = 1;
  const timers: Timers = {
    setTimeout: (fn, ms) => { waiting.set(next, fn); waits.push(ms); return next++; },
    clearTimeout: (id) => { waiting.delete(id); },
  };
  return { timers, waiting, waits, fire: () => { const [id, fn] = [...waiting][0]; waiting.delete(id); fn(); } };
}

function player() {
  const fake = fakeTimers();
  const p = board.createPlayer({ count, onChange: () => {}, timers: fake.timers });
  return { p, fake };
}

describe('the three tickets move at once within the limits of dynamo run', () => {
  test('the three tickets wait in Todo at the start and are all Done at the end', () => {
    assert.equal(data.tickets.length, 3);
    assert.deepEqual(states[0].columns.todo, data.tickets.map((t) => t.id));
    assert.deepEqual(states.at(-1)!.columns.done.slice().sort(), data.tickets.map((t) => t.id));
  });

  test('every beat changes one or two cards, and the board has the eight columns', () => {
    assert.equal(data.columns.length, 8);
    data.beats.forEach((beat, i) => assert.ok([1, 2].includes(beat.moves.length), `beat ${i + 1}`));
  });

  test('at most 3 tickets are between Build and Merge, and only one in Merge, after every single move', () => {
    const where: Record<string, string> = {};
    const check = (label: string) => {
      const running = Object.values(where).filter((c) => data.running.includes(c)).length;
      assert.ok(running <= data.slots, `${label}: ${running} running`);
      assert.ok(Object.values(where).filter((c) => c === 'merge').length <= 1, `${label}: two in Merge`);
    };
    data.start.forEach((m) => { where[m.id] = m.to; });
    data.beats.forEach((beat, i) => beat.moves.forEach((m) => { where[m.id] = m.to; check(`beat ${i + 1}, #${m.id}`); }));
    assert.equal(data.slots, 3);
  });

  test('a card that arrives in a column goes on top of it', () => {
    for (const [i, beat] of data.beats.entries()) {
      const last = beat.moves.at(-1)!;
      assert.equal(states[i + 1].columns[last.to][0], last.id, `beat ${i + 1}`);
    }
  });

  test('replaying is the same going back as going forward', () => {
    assert.deepEqual(plain(board.stateAt(data, 7)), states[7]);
    assert.deepEqual(plain(board.stateAt(data, 3)), states[3]);
  });

  const routes: [string, string, string[]][] = [
    ['#1 goes straight from Todo to Done', 'a', ['todo', 'build', 'verify', 'review', 'merge', 'done']],
    ['#2 fails in Verify, goes back to Build and on again', 'b', ['todo', 'build', 'verify', 'build', 'verify', 'review', 'merge', 'done']],
    ['#3 goes from Build to Needs Human, you move it to Todo and it goes on in Build, where it stopped', 'c', ['todo', 'build', 'needs-human', 'todo', 'build', 'verify', 'review', 'merge', 'done']],
  ];
  for (const [name, id, expected] of routes) test(name, () => assert.deepEqual(route(id), expected));

  test('no ticket is blocked, waits for a slot or gets a Reviewer FAIL', () => {
    const notes = new Set([...data.start, ...data.beats.flatMap((b) => b.moves)].map((m) => m.note));
    for (const gone of ['blocked', 'waits', 'failedReview', 'unblocked']) assert.ok(!notes.has(gone), gone);
  });

  test('every card shows a line that changes with its column: PASS in Merge, merged in Done', () => {
    states.forEach((state, i) => {
      for (const id of data.tickets.map((t) => t.id)) {
        const column = columnOf(state, id)!;
        if (column === 'done') assert.equal(state.notes[id], 'merged', `beat ${i} #${id}`);
        if (column === 'merge') assert.equal(state.notes[id], 'pass', `beat ${i} #${id}`);
        if (column === 'needs-human') assert.equal(state.notes[id], 'asks', `beat ${i} #${id}`);
      }
    });
  });
});

describe('the player takes one beat every 4 seconds, rests at the end and starts again', () => {
  test('the beat and the slide are about 4 s and 0.6 s', () => {
    assert.equal(board.BEAT_MS, 4000);
    assert.equal(board.SLIDE_MS, 600);
    assert.ok(board.END_MS >= 3000, 'a few seconds at the end');
  });

  test('playing waits one beat, goes on one beat at a time, and the last beat rests longer before starting again', () => {
    const { p, fake } = player();
    p.play();
    for (let i = 1; i < count; i++) {
      fake.fire();
      assert.equal(p.index(), i);
    }
    fake.fire();
    assert.equal(p.index(), 0, 'after the rest it starts again');
    assert.equal(p.playing(), true);
    assert.deepEqual(fake.waits.slice(0, count), [...Array(count - 1).fill(board.BEAT_MS), board.END_MS, board.BEAT_MS].slice(0, count));
    assert.equal(fake.waits[count - 1], board.END_MS);
  });

  test('a pause stops the beat, and go stays inside the beats', () => {
    const { p, fake } = player();
    p.play();
    assert.equal(p.playing(), true);
    p.pause();
    assert.equal(p.playing(), false);
    assert.equal(fake.waiting.size, 0);
    p.go(99);
    assert.equal(p.index(), count - 1);
    p.go(-4);
    assert.equal(p.index(), 0);
  });
});

describe('the cards slide only where motion is allowed, and only those that changed place', () => {
  const before = { a: { left: 10, top: 10 }, b: { left: 100, top: 40 }, c: { left: 100, top: 90 } };
  const after = { a: { left: 10, top: 10 }, b: { left: 200, top: 12 }, c: { left: 100, top: 40 } };
  test('with motion: the card that left and the one that closed the gap start from where they were', () => {
    assert.deepEqual(plain(board.slides(before, after, true)), [{ id: 'b', dx: -100, dy: 28 }, { id: 'c', dx: 0, dy: 50 }]);
  });
  test('under reduced motion the cards jump: nothing slides', () => {
    assert.deepEqual(plain(board.slides(before, after, false)), []);
  });
  test('on a board turned 90° the shift is given in the card’s own axes: the screen’s (x, y) becomes (y, -x)', () => {
    assert.deepEqual(plain(board.slides(before, after, true, true)), [{ id: 'b', dx: 28, dy: 100 }, { id: 'c', dx: 50, dy: 0 }]);
  });
  test('a card with no place before (not drawn yet) does not slide', () => {
    assert.deepEqual(plain(board.slides({}, after, true)), []);
  });
});

describe('the pages and the texts', () => {
  const pages: [string, string][] = [['index.html', ''], ['journey/index.html', '../']];

  test('the home page and the journey page carry the same board component, from the shared layer', () => {
    for (const [file, prefix] of pages) {
      const html = read(...file.split('/'));
      assert.match(html, /<div[^>]*data-board(?:>|\s)/, file);
      for (const script of ['board.data.js', 'board.player.js', 'board.i18n.js', 'board.js']) assert.ok(html.includes(`src="${prefix}assets/${script}"`), `${file} ${script}`);
      assert.ok(html.includes(`href="${prefix}assets/board.css"`), file);
    }
  });

  test('every text the board names is in both languages', () => {
    const dictionary: Record<'en' | 'es', Record<string, string>> = { en: {}, es: {} };
    const i18n = { register: (d: typeof dictionary) => { Object.assign(dictionary.en, d.en); Object.assign(dictionary.es, d.es); } };
    for (const file of ['shared.i18n.js', 'board.i18n.js']) runInNewContext(read('assets', file), { window: { DynamoSite: { i18n } } });
    const both = (key: string) => (['en', 'es'] as const).every((l) => (dictionary[l][key] ?? '').trim() !== '');
    assert.deepEqual(Object.keys(dictionary.en).sort(), Object.keys(dictionary.es).sort());
    const keys = [
      ...data.columns.flatMap((c) => [`board.col.${c.id}`, `board.actor.${c.actor}`]),
      ...data.tickets.flatMap((t) => [`board.ticket.${t.id}`, `board.level.${t.level}`]),
      ...[...data.start, ...data.beats.flatMap((b) => b.moves)].map((m) => `board.note.${m.note}`),
      ...states.map((s) => s.what),
      ...['label', 'frame', 'card.open', 'what', 'open', 'close', 'modal'].map((k) => `board.${k}`),
    ];
    for (const key of keys) assert.ok(both(key), key);
  });

  test('the board holds nothing personal and does not name the real web project or link to the development repository', () => {
    // The private name is built piece by piece so that this file, which is published, does not name it itself.
    const forbidden = new RegExp(`${['dynamo', 'develop'].join('-')}|talia|C:\\\\Users|DESKTOP-`, 'i');
    for (const file of [['assets', 'board.js'], ['assets', 'board.player.js'], ['assets', 'board.data.js'], ['assets', 'board.i18n.js'], ['assets', 'board.css'], ['journey', 'index.html'], ['index.html']]) {
      assert.doesNotMatch(read(...file), forbidden, file.join('/'));
    }
  });

  test('the board is drawn with no GitHub logo and no icon file of GitHub', () => {
    for (const file of ['board.js', 'board.css', 'board.i18n.js']) assert.doesNotMatch(read('assets', file), /octicon|github-mark|<path/i, file);
  });
});

test('the map page also carries its diagram in the page, with the full screen button', () => {
  const html = read('map', 'index.html');
  assert.match(html, /<iframe[^>]*data-diagram-frame/);
  assert.match(html, /data-diagram-toggle/);
  assert.match(read('map', 'map.js'), /diagram\.mount\(.*'map\.diagram'\)/);
});

test('the journey diagram is in the page, not behind a link, and its source stays next to the page', () => {
  const html = read('journey', 'index.html');
  assert.match(html, /<iframe[^>]*data-diagram-frame/);
  assert.doesNotMatch(html, /data-diagram-open/);
  for (const lang of ['en', 'es']) {
    assert.ok(read('journey', `journey.board.${lang}.json`).length > 0);
    assert.ok(read('journey', `journey.board.${lang}.html`).length > 0);
  }
});
