import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFactory } from '../factory.ts';
import { scratch } from './helpers.ts';

function rootWith(text: string): string {
  const root = scratch();
  mkdirSync(join(root, '.claude'));
  writeFileSync(join(root, '.claude', 'factory.json'), text);
  return root;
}

test('readFactory reads the file of the root it is given, and refuses one with no project block', () => {
  const root = rootWith(JSON.stringify({ version: 1, project: { repo: 'o/r', checks: [] } }));
  assert.equal(readFactory(root).project.repo, 'o/r');
  writeFileSync(join(root, '.claude', 'factory.json'), '{"version":1}');
  assert.throws(() => readFactory(root), /no project block/);
});

test('readFactory throws when there is no factory.json', () => {
  assert.throws(() => readFactory(scratch()));
});

test('readFactory refuses a factory.json with no version, and says which version it reads', () => {
  const root = rootWith(JSON.stringify({ project: { repo: 'o/r', checks: [] } }));
  assert.throws(() => readFactory(root), /no version.*reads version 1/s);
});

test('readFactory refuses a factory.json of another version, and says which version it reads', () => {
  const root = rootWith(JSON.stringify({ version: 2, project: { repo: 'o/r', checks: [] } }));
  assert.throws(() => readFactory(root), /version 2.*reads version 1/s);
});
