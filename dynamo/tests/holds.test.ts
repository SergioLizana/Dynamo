// The reset time of the usage limit in the ticket's file (holds.ts): when it still holds the ticket back and when it does not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { holdPath, limitUntil, readHold } from '../holds.ts';
import { scratch } from './helpers.ts';

const NOW = Date.parse('2026-11-03T12:00:00.000Z');

test('limitUntil gives the reset time only while it is still to come', () => {
  assert.equal(limitUntil('2026-11-03T12:00:00.001Z', NOW), '2026-11-03T12:00:00.001Z');
  assert.equal(limitUntil('2026-11-03T12:00:00.000Z', NOW), null);
  assert.equal(limitUntil('2026-11-03T11:00:00.000Z', NOW), null);
  assert.equal(limitUntil(null, NOW), null);
  assert.equal(limitUntil('not a time', NOW), null);
});

test('the file gives back the reset time, and null when it has none or a time that is not text', () => {
  const main = scratch();
  mkdirSync(dirname(holdPath(main, 5)), { recursive: true });
  const base = { pid: 5, startedAt: 'T', round: 1, phase: 'build', sessions: { builder: null, reviewer: null } };
  writeFileSync(holdPath(main, 5), JSON.stringify({ ...base, resetsAt: '2026-11-03T18:30:00.000Z' }));
  assert.equal(readHold(main, 5)?.resetsAt, '2026-11-03T18:30:00.000Z');
  for (const none of [{ resetsAt: null }, { resetsAt: 5 }, {}]) {
    writeFileSync(holdPath(main, 5), JSON.stringify({ ...base, ...none }));
    assert.equal(readHold(main, 5)?.resetsAt, null, JSON.stringify(none));
  }
});
