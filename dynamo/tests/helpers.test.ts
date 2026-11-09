// The helpers of the tests: the folder scratch() gives, and the removal of the ones a killed suite left.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, realpathSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { removeOldScratch, scratch } from './helpers.ts';

const DAY = 24 * 60 * 60 * 1000;

test('scratch() gives its folder as the system resolves it, with no 8.3 short names', () => {
  const dir = scratch();
  assert.equal(dir, realpathSync.native(dir));
});

test('removeOldScratch removes the claude-dynamo-* folders over a day old and leaves the newer ones and other names', () => {
  const root = scratch();
  const now = Date.now();
  const make = (name: string, ageMs: number) => {
    const dir = join(root, name);
    mkdirSync(dir);
    writeFileSync(join(dir, 'f.txt'), 'x');
    const at = new Date(now - ageMs);
    utimesSync(dir, at, at);
  };
  make('claude-dynamo-old', 2 * DAY);
  make('claude-dynamo-new', DAY / 2);
  make('other-old', 2 * DAY);
  assert.deepEqual(removeOldScratch(root, now, DAY), ['claude-dynamo-old']);
  assert.ok(!existsSync(join(root, 'claude-dynamo-old')));
  assert.ok(existsSync(join(root, 'claude-dynamo-new')));
  assert.ok(existsSync(join(root, 'other-old')));
});
