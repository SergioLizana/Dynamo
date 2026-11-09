// The tree of this repository must pass the review `dynamo publish` makes of a snapshot: no personal data and no link to the
// private repository in any file that is published. It is run over the files of the checkout (the code and tests of
// `dynamo publish` included), so a later ticket that writes a user path, an email or the private name anywhere in them fails
// here, not at the first publication. Nothing is exempted: no pattern and no file is skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from '../git.ts';
import { textOrNull } from '../disk.ts';
import { PUBLIC_FILES, publishedFiles } from '../publishing.ts';
import type { Finding } from '../reviewing.ts';
import { scanText } from '../reviewing.ts';
import { scratch } from './helpers.ts';

// The private repository, built piece by piece so that this file does not name it as one string.
const PRIVATE_REPO = `SergioLizana/${['dynamo', 'develop'].join('-')}`;
const ROOT = join(import.meta.dirname, '..', '..');

// The files `dynamo publish` would publish from the checkout at `root`: the allowlisted tracked files, and the public CI and
// Dependabot wherever the checkout keeps them (where the tag holds them in development, in place in the public repository).
function publishedIn(root: string): string[] {
  const listing = git(['ls-files', '-z'], { cwd: root });
  assert.equal(listing.code, 0, listing.stderr);
  const extra = [...Object.keys(PUBLIC_FILES), ...Object.values(PUBLIC_FILES)];
  return [...publishedFiles(listing.stdout), ...extra.filter((f) => existsSync(join(root, f)))];
}

function reviewTree(root: string): Finding[] {
  return publishedIn(root).flatMap((file) => {
    const text = textOrNull(join(root, file));
    return text === null ? [] : scanText(file, text, PRIVATE_REPO);
  });
}

test('the files published from this checkout have no personal data and no link to the private repository', () => {
  const findings = reviewTree(ROOT);
  assert.deepEqual(findings, [], findings.map((f) => `${f.file}:${f.line} ${f.kind}`).join('\n'));
});

test('the review of the tree includes the code and the tests of dynamo publish', () => {
  const files = publishedIn(ROOT);
  for (const own of ['dynamo/publish.ts', 'dynamo/reviewing.ts', 'dynamo/snapshot.ts', 'dynamo/tests/publish.test.ts', 'dynamo/tests/tree-review.test.ts']) {
    assert.ok(files.includes(own), `${own} is reviewed`);
  }
});

test('the review of a tree finds a user path in a published file, and ignores one outside the allowlist', () => {
  const dir = scratch();
  const run = (...args: string[]) => assert.equal(git(args, { cwd: dir }).code, 0, args.join(' '));
  run('init', '-q');
  mkdirSync(join(dir, 'guides'));
  mkdirSync(join(dir, 'documentation'));
  writeFileSync(join(dir, 'guides', 'g.md'), `see ${['', 'home', 'bob'].join('/')}\n`);
  writeFileSync(join(dir, 'documentation', 'd.md'), `see ${['', 'home', 'bob'].join('/')}\n`);
  run('add', '-A');
  assert.deepEqual(reviewTree(dir), [{ file: 'guides/g.md', line: 1, kind: 'user path' }]);
});
