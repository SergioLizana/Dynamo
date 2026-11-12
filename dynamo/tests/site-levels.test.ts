// The site's copy of the levels' models and efforts (site/assets/levels.js) matches the starting values of dynamo/levels.ts,
// and the journey page reads that copy instead of holding its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { STARTING } from '../levels.ts';

const repo = resolve(import.meta.dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(repo, 'site', ...parts), 'utf8');

const site: Record<string, unknown> = {};
runInNewContext(read('assets', 'levels.js'), { window: { DynamoSite: site } });
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

test("the site's models and efforts are the starting values of Dynamo's levels", () => {
  assert.deepEqual(plain(site.levels), plain(STARTING));
});

test("the journey reads the site's one copy of the levels, and holds none of its own", () => {
  const journey = read('journey', 'journey.js');
  assert.match(journey, /site\.levels/);
  assert.doesNotMatch(journey, /model: '/);
});
