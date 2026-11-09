// The lock of a whole `dynamo run` (runlock.ts): who holds it, when a lock is dead, and the heartbeat that keeps it alive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { holderOf, takeLock, STALE_MS } from '../runlock.ts';
import { scratch } from './helpers.ts';

const NOW = Date.parse('2026-11-03T12:00:00Z');
const lock = (pid: number, ageMs: number) => ({ pid, since: '2026-11-03T10:00:00.000Z', heartbeat: new Date(NOW - ageMs).toISOString() });
const alive = () => true;
const dead = () => false;
const content = (file: string) => JSON.parse(readFileSync(file, 'utf8'));

// The pid of a process that has already ended.
const deadPid = () => Number(spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']).stdout.toString());

test('a lock whose pid answers and whose heartbeat is under 5 minutes old holds the run', () => {
  assert.deepEqual(holderOf(lock(42, 30_000), NOW, alive), { pid: 42, since: '2026-11-03T10:00:00.000Z' });
  assert.notEqual(holderOf(lock(42, STALE_MS - 1), NOW, alive), null);
});

test('a dead pid, or a heartbeat 5 minutes old or more, holds nothing', () => {
  assert.equal(holderOf(lock(42, 1000), NOW, dead), null);
  assert.equal(holderOf(lock(42, STALE_MS), NOW, alive), null);
  assert.equal(holderOf(lock(42, 3_600_000), NOW, alive), null);
});

test('a lock that is not what a run writes holds nothing', () => {
  for (const bad of [null, 'x', {}, { pid: 'a', since: 's', heartbeat: 'h' }, { pid: 1, since: 's', heartbeat: 'not a date' }]) assert.equal(holderOf(bad, NOW, alive), null);
});

test('the first run takes the lock and frees it; a second one while it lives gets the holder', () => {
  const file = join(scratch(), 'runs', 'run.json');
  const first = takeLock(file, { pid: process.pid, now: () => NOW });
  assert.ok('release' in first);
  assert.equal(content(file).pid, process.pid);
  const second = takeLock(file, { pid: process.pid + 1, now: () => NOW + 1000 });
  assert.deepEqual(second, { held: { pid: process.pid, since: new Date(NOW).toISOString() } });
  assert.equal(content(file).pid, process.pid, 'the lock of the live run is left alone');
  first.release();
  assert.equal(existsSync(file), false);
});

test('a lock of a dead pid, or of an old heartbeat, is taken over', () => {
  const file = join(scratch(), 'run.json');
  writeFileSync(file, JSON.stringify(lock(deadPid(), 1000)));
  const a = takeLock(file, { pid: process.pid, now: () => NOW });
  assert.ok('release' in a);
  assert.equal(content(file).pid, process.pid);
  a.release();
  writeFileSync(file, JSON.stringify(lock(process.pid, 6 * 60_000)));
  const b = takeLock(file, { pid: process.pid, now: () => NOW });
  assert.ok('release' in b);
  assert.equal(content(file).heartbeat, new Date(NOW).toISOString());
  b.release();
});

test('the heartbeat rewrites the lock on every beat and stops when the lock is released', async () => {
  const file = join(scratch(), 'run.json');
  let t = NOW;
  const taken = takeLock(file, { pid: process.pid, now: () => t, everyMs: 20 });
  assert.ok('release' in taken);
  t = NOW + 90_000;
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(content(file).heartbeat, new Date(t).toISOString());
  assert.equal(content(file).since, new Date(NOW).toISOString());
  taken.release();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(existsSync(file), false, 'a beat after the release does not bring the file back');
});

test('a run does not free a lock that another run took over', () => {
  const file = join(scratch(), 'run.json');
  const taken = takeLock(file, { pid: process.pid, now: () => NOW });
  assert.ok('release' in taken);
  writeFileSync(file, JSON.stringify(lock(process.pid + 7, 0)));
  taken.release();
  assert.equal(content(file).pid, process.pid + 7);
});
