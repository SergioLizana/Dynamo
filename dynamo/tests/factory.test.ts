import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFactory } from '../factory.ts';
import { scratch } from './helpers.ts';

test('readFactory reads .claude/factory.json of this repository', () => {
  const f = readFactory();
  assert.equal(typeof f.project.repo, 'string');
  assert.ok(f.project.checks.includes('node --test dynamo/tests/'));
});

test('readFactory reads the file of the root it is given, and refuses one with no project block', () => {
  const root = scratch();
  mkdirSync(join(root, '.claude'));
  writeFileSync(join(root, '.claude', 'factory.json'), JSON.stringify({ project: { repo: 'o/r', checks: [] } }));
  assert.equal(readFactory(root).project.repo, 'o/r');
  writeFileSync(join(root, '.claude', 'factory.json'), '{}');
  assert.throws(() => readFactory(root), /no project block/);
});

test('readFactory throws when there is no factory.json', () => {
  assert.throws(() => readFactory(scratch()));
});
