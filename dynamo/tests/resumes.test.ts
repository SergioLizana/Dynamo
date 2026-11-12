// A ticket half done by a run that died (resumes.ts): which cards a run takes, who holds a ticket, where it goes on, and the
// file of the ticket read back (holds.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Row } from '../frontier.ts';
import { NO_FILE } from '../frontier.ts';
import type { Hold } from '../holds.ts';
import { holdPath, readHold, writeHold } from '../holds.ts';
import { listOf } from '../lists.ts';
import { heldBy, resumable, stepOf } from '../resumes.ts';
import { scratch } from './helpers.ts';

const row = (number: number, column: string | null, extra: Partial<Row> = {}): Row => ({
  number, title: `T${number}`, state: 'OPEN', column, doneLabel: false, blockers: [], ready: column === 'Todo', why: column === 'Todo' ? null : `in ${column}`, ...extra,
});
const PHASES = ['Build', 'Verify', 'Review', 'Merge'];

test('a card in a phase column with its file is ready; with no file it is not, and the reason says so', () => {
  const out = resumable([row(1, 'Review'), row(2, 'Build'), row(3, 'Todo'), row(4, 'Backlog')], PHASES, (n) => n === 1);
  assert.deepEqual(out.map((r) => [r.number, r.ready]), [[1, true], [2, false], [3, true], [4, false]]);
  assert.equal(out[0].why, null);
  assert.match(String(out[1].why), new RegExp(`^in Build, ${NO_FILE} to go on from \\(\\.claude/worktrees/runs/2\\.json\\)`));
  assert.equal(out[3].why, 'in Backlog', 'a column that is not a phase is as the frontier read it');
});

test('a half-done ticket waits on its blockers as any other; a closed one, or one with the done label and no file, is left alone', () => {
  const open = { number: 9, state: 'OPEN', doneLabel: false };
  const [waits, closed, labelled] = resumable([
    row(1, 'Build', { blockers: [open, { number: 8, state: 'CLOSED', doneLabel: false }] }),
    row(2, 'Review', { state: 'CLOSED', why: 'done (closed)' }),
    row(3, 'Verify', { doneLabel: true, why: 'done (in-release)' }),
  ], PHASES, (n) => n === 1);
  assert.deepEqual([waits.ready, waits.why], [false, 'blocker not done: #9']);
  assert.equal(closed.why, 'done (closed)');
  assert.equal(labelled.why, 'done (in-release)');
});

test('a list with no numbers keeps a card in a phase column with no file, skipped with its reason; it drops one in Backlog', () => {
  const rows = resumable([row(1, 'Todo'), row(2, 'Review'), row(3, 'Backlog')], PHASES, () => false);
  const items = listOf(rows, false);
  assert.deepEqual(items.map((i) => [i.number, i.state]), [[1, 'waiting'], [2, 'skipped']]);
  assert.match(String(items[1].why), /^in Review, with no file of a run/);
  assert.deepEqual(listOf(rows, true).map((i) => i.number), [1, 2, 3]);
});

const hold = (pid: number): Hold => ({
  pid, startedAt: '2026-11-03T10:00:00.000Z', round: 1, phase: 'review', sessions: { builder: null, reviewer: null }, failed: null, spent: [], builder: null, review: null, checks: null, resetsAt: null, stopped: false, asked: false,
});
const NOW = Date.parse('2026-11-03T12:00:00.000Z');
const lock = (pid: number, ageMs: number) => ({ pid, since: '2026-11-03T09:00:00.000Z', heartbeat: new Date(NOW - ageMs).toISOString() });

test('a ticket is held by a live run when the lock is alive and is its file\'s pid; a dead lock, another pid or its own process holds nothing', () => {
  const alive = () => true;
  assert.deepEqual(heldBy(hold(50), lock(50, 1000), NOW, 1, alive), { pid: 50, since: '2026-11-03T10:00:00.000Z' });
  assert.equal(heldBy(hold(50), lock(50, 6 * 60_000), NOW, 1, alive), null, 'a heartbeat over 5 minutes old');
  assert.equal(heldBy(hold(50), lock(50, 1000), NOW, 1, () => false), null, 'a pid that does not answer');
  assert.equal(heldBy(hold(50), lock(60, 1000), NOW, 1, alive), null, 'the lock is another run\'s');
  assert.equal(heldBy(hold(50), null, NOW, 1, alive), null, 'no lock');
  assert.equal(heldBy(hold(1), lock(1, 1000), NOW, 1, alive), null, 'its own process');
});

test('a ticket goes on from its phase: a new Builder, Verify again (also before the reviewer), the merge', () => {
  assert.deepEqual((['start', 'build', 'check', 'review', 'merge'] as const).map(stepOf), ['build', 'build', 'verify', 'verify', 'merge']);
});

test('the file of a ticket reads back whole; one that is missing, not JSON or not a file of a run is none', () => {
  const dir = scratch();
  assert.equal(readHold(dir, 7), null);
  const full: Hold = {
    ...hold(50), round: 2, failed: 'the check failed', spent: [{ cost: 1.5, turns: 8 }, { cost: null, turns: null }],
    builder: { commit: 'x', needsHuman: false, needsHumanReason: '', published: '', noTrace: 'none', outOfTicket: 'a thing' },
    stopped: true, cause: null, failedCheck: null, resume: null, review: { verdict: 'FAIL', report: 'VERDICT: FAIL' }, checks: [{ command: 'node pass.js', code: 0, output: '' }], sessions: { builder: 'a', reviewer: 'b' },
  };
  writeHold(dir, 7, full);
  assert.deepEqual(readHold(dir, 7), full);

  mkdirSync(join(dir, '.claude', 'worktrees', 'runs'), { recursive: true });
  for (const bad of ['not json', '[]', '{"pid":"1"}', JSON.stringify({ ...full, round: 0 }), JSON.stringify({ ...full, phase: 'lunch' })]) {
    writeFileSync(holdPath(dir, 7), bad);
    assert.equal(readHold(dir, 7), null, bad);
  }
  // What a run wrote before the file kept more than the phase is still a file; what it did not say is empty.
  writeFileSync(holdPath(dir, 7), JSON.stringify({ pid: 5, startedAt: 'T', round: 1, phase: 'build', sessions: { builder: 'a', reviewer: null } }));
  assert.deepEqual(readHold(dir, 7), { pid: 5, startedAt: 'T', round: 1, phase: 'build', sessions: { builder: 'a', reviewer: null }, failed: null, spent: [], builder: null, review: null, checks: null, resetsAt: null, stopped: false, asked: false, cause: null, failedCheck: null, resume: null });
  writeHold(dir, 7, { ...full, resume: 'verify' });
  assert.equal(readHold(dir, 7)?.resume, 'verify');
  writeFileSync(holdPath(dir, 7), JSON.stringify({ ...full, resume: 'merge' }));
  assert.equal(readHold(dir, 7)?.resume, null, 'only review and verify are steps without a Builder');
  // The mark of a Builder that stopped to ask the human is kept; anything but true is not a mark.
  writeHold(dir, 7, { ...full, asked: true });
  assert.equal(readHold(dir, 7)?.asked, true);
  writeFileSync(holdPath(dir, 7), JSON.stringify({ ...full, asked: 'yes' }));
  assert.equal(readHold(dir, 7)?.asked, false);
  // Why a Builder was cut off is kept with it, text or nothing.
  writeHold(dir, 7, { ...full, asked: true, cause: 'the time limit of 30 min cut you off' });
  assert.equal(readHold(dir, 7)?.cause, 'the time limit of 30 min cut you off');
  writeFileSync(holdPath(dir, 7), JSON.stringify({ ...full, asked: true, cause: 5 }));
  assert.equal(readHold(dir, 7)?.cause, null);
});
