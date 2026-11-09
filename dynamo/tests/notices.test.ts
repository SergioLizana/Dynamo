// The notice to the human (notices.ts, notify.ts): which end a list had, the line sent, and the edge with no variable set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Item, State } from '../lists.ts';
import { endLine, howEnded, pauseLine } from '../notices.ts';
import { NOTIFY_URL, notify } from '../notify.ts';

const item = (number: number, state: State): Item => ({ number, blockers: [], state, why: null });

test('howEnded: a pause beats everything, a list that ran tickets ended, one that started none is idle', () => {
  assert.equal(howEnded([item(1, 'merged'), item(2, 'paused')]), 'paused');
  assert.equal(howEnded([item(1, 'merged'), item(2, 'skipped')]), 'ended');
  assert.equal(howEnded([item(1, 'blocked')]), 'ended');
  assert.equal(howEnded([item(1, 'skipped'), item(2, 'skipped')]), 'idle');
  assert.equal(howEnded([]), 'idle');
});

test('the line of a pause has the ticket, the reset time and the command to go on', () => {
  const line = pauseLine({ numbers: [3, 5], resetsAt: ['2026-11-03T18:00:00.000Z', null] });
  assert.match(line, /#3, #5/);
  assert.match(line, /resets at 2026-11-03T18:00:00\.000Z/);
  assert.match(line, /to go on: \/dynamo:autopilot 3 5$/);
  assert.match(pauseLine({ numbers: [3], resetsAt: [null] }), /resets at unknown/);
  assert.doesNotMatch(pauseLine({ numbers: [3], resetsAt: [null] }), /\n/);
});

test('the line of the end says the list ended, and where the report is', () => {
  assert.match(endLine(3, 1, '.claude/worktrees/r.md'), /the list ended: 3 merged, 1 stopped; report: \.claude\/worktrees\/r\.md$/);
  assert.match(endLine(1, 0, null), /the list ended: 1 merged, 0 stopped$/);
});

test('notify posts the line to the URL of the variable; a refusal or a failure comes back as text, never thrown', async () => {
  const sent: [string, string][] = [];
  const ok = async (url: string, line: string) => { sent.push([url, line]); return { ok: true, status: 200 }; };
  assert.equal(await notify('hello', { [NOTIFY_URL]: 'https://ntfy.example/topic' }, ok), null);
  assert.deepEqual(sent, [['https://ntfy.example/topic', 'hello']]);
  assert.match(String(await notify('x', { [NOTIFY_URL]: 'u' }, async () => ({ ok: false, status: 500 }))), /status 500/);
  assert.match(String(await notify('x', { [NOTIFY_URL]: 'u' }, async () => { throw new Error('down'); })), /down/);
});

test('with no variable set there is no POST and no error', async () => {
  let posts = 0;
  const spy = async () => { posts++; return { ok: true, status: 200 }; };
  assert.equal(await notify('hello', {}, spy), null);
  assert.equal(await notify('hello', { [NOTIFY_URL]: '' }, spy), null);
  assert.equal(posts, 0);
});
