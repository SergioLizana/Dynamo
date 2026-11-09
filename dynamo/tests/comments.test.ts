import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastComment, postArgs, readArgs, sameBody } from '../comments.ts';

const list = (...c: unknown[]) => JSON.stringify({ comments: c });

test('postArgs reads the body from stdin; readArgs reads the comments of that one issue', () => {
  assert.deepEqual(postArgs('me/proj', 7), ['issue', 'comment', '7', '-R', 'me/proj', '--body-file', '-']);
  assert.deepEqual(readArgs('me/proj', 7), ['issue', 'view', '7', '-R', 'me/proj', '--json', 'comments']);
});

test('sameBody ignores the line ending of either side', () => {
  assert.equal(sameBody('a\r\nb\r\n', 'a\nb\n'), true);
  assert.equal(sameBody('a\nb\n', 'a\r\nb\r\n'), true);
  assert.equal(sameBody('a\r\n\r\nb', 'a\n\nb'), true);
});

test('sameBody ignores the blank space at the end and nothing else', () => {
  assert.equal(sameBody('a b\n\n', 'a b'), true);
  assert.equal(sameBody('a b  \r\n', 'a b'), true);
  assert.equal(sameBody('a b', 'a  b'), false);
  assert.equal(sameBody('a\n\nb', 'a\nb'), false);
  assert.equal(sameBody(' a', 'a'), false);
});

test('sameBody compares non-ASCII text as it is', () => {
  assert.equal(sameBody('Revisión · añadido ñ\r\n', 'Revisión · añadido ñ\n'), true);
  assert.equal(sameBody('Revisión · ñ', 'Revision . n'), false);
});

test('lastComment gives the body and URL of the last comment', () => {
  const json = list({ body: 'old', url: 'u1' }, { body: 'new ñ ·', url: 'u2' });
  assert.deepEqual(lastComment(json), { body: 'new ñ ·', url: 'u2' });
  assert.deepEqual(lastComment(list({ body: 'x' })), { body: 'x', url: null });
});

test('lastComment gives null when there are no comments', () => {
  assert.equal(lastComment(list()), null);
});

test('lastComment refuses what is not JSON or has no comments list with a body in each', () => {
  assert.throws(() => lastComment('nope'), /JSON/);
  const bad = ['null', '[]', '{}', '{"comments":5}', list({ body: 5 }), list({ body: 'ok' }, {})];
  for (const b of bad) assert.throws(() => lastComment(b), /comments/, b);
});
