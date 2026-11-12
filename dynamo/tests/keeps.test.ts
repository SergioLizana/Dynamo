// Which stops are kept and where each goes on from (keeps.ts): pure, no process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEPT, builderStopKind, causeOf, checkStopKind, reviewerStopKind } from '../keeps.ts';
import type { StopKind } from '../keeps.ts';
import type { Ending } from '../agents.ts';
import type { Outcome } from '../rounds.ts';

test('each kind of stop of the epic is kept or not, and goes on from its phase', () => {
  const table: [StopKind, boolean, string | null][] = [
    ['build-timeout', true, 'build'], ['build-budget', true, 'build'], ['build-unknown', true, 'build'],
    ['check-failed-last-round', true, 'build'], ['check-did-not-run', true, 'verify'],
    ['review-timeout', true, 'review'], ['review-budget', true, 'review'], ['review-no-verdict', true, 'review'],
    ['infrastructure', false, null],
  ];
  assert.deepEqual(Object.keys(KEPT).sort(), table.map(([k]) => k).sort(), 'every kind is in the table, and nothing else');
  for (const [kind, kept, from] of table) assert.deepEqual(KEPT[kind], { kept, from }, kind);
});

test('a Builder ending in a timeout, a spent budget or an unknown end is a kept kind; any other ending, or a step that is not the Builder\'s, is none', () => {
  const build = (ending: Ending): Outcome => ({ step: 'build', ending, detail: null, needsHuman: false, reason: null });
  const cases: [Outcome, StopKind | null][] = [
    [build('timeout'), 'build-timeout'], [build('budget'), 'build-budget'], [build('unknown'), 'build-unknown'],
    [build('success'), null], [build('error'), null], [build('limit'), null],
    [{ step: 'review', ending: 'timeout', detail: null, verdict: null, report: null }, null],
    [{ step: 'verify', code: 2, output: '' }, null],
  ];
  for (const [outcome, kind] of cases) assert.equal(builderStopKind(outcome), kind, JSON.stringify(outcome));
});

test('a Reviewer with a timeout, a spent budget or no verdict, and a check that did not run, are kept kinds; a verdict, an error and a failed check are not those', () => {
  const review = (ending: Ending, verdict: 'PASS' | 'FAIL' | null = null): Outcome => ({ step: 'review', ending, detail: null, verdict, report: null });
  const reviews: [Outcome, StopKind | null][] = [
    [review('timeout'), 'review-timeout'], [review('budget'), 'review-budget'], [review('unknown'), 'review-no-verdict'],
    [review('success'), 'review-no-verdict'], [review('success', 'FAIL'), null], [review('success', 'PASS'), null],
    [review('error'), null], [review('limit'), null], [{ step: 'build', ending: 'timeout', detail: null, needsHuman: false, reason: null }, null],
  ];
  for (const [outcome, kind] of reviews) assert.equal(reviewerStopKind(outcome), kind, JSON.stringify(outcome));
  const checks: [0 | 1 | 2, StopKind | null][] = [[2, 'check-did-not-run'], [1, 'check-failed-last-round'], [0, null]];
  for (const [code, kind] of checks) assert.equal(checkStopKind({ step: 'verify', code, output: '' }), kind, `exit ${code}`);
});

test('what the resumed Builder is told of why it stopped names the limit that cut it off', () => {
  assert.match(String(causeOf('build-timeout', 30, 3)), /time limit of 30 min/);
  assert.match(String(causeOf('build-budget', 30, 3)), /spent your budget of 3 USD/);
  assert.match(String(causeOf('build-unknown', 30, 3)), /does not know/);
  assert.equal(causeOf('review-timeout', 30, 3), null);
});
