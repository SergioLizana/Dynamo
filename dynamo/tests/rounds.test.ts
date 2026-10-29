import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROUNDS, next } from '../rounds.ts';
import type { Outcome } from '../rounds.ts';

const built: Outcome = { step: 'build', ending: 'success', detail: null, needsHuman: false, reason: null };
const checked = (code: 0 | 1 | 2, output = ''): Outcome => ({ step: 'verify', code, output });
const reviewed = (verdict: 'PASS' | 'FAIL' | null, report: string | null = null): Outcome => ({ step: 'review', ending: 'success', detail: null, verdict, report });

test('the rounds are two', () => {
  assert.equal(ROUNDS, 2);
});

test('a Builder that ends well goes to the check, a check that passes to the reviewer, a PASS to the merge', () => {
  for (const round of [1, 2]) {
    assert.deepEqual(next(round, built), { go: 'verify' });
    assert.deepEqual(next(round, checked(0)), { go: 'review' });
    assert.deepEqual(next(round, reviewed('PASS', 'VERDICT: PASS')), { go: 'merge' });
  }
});

test('a failed check in round 1 goes to round 2 with what failed; in round 2 to Needs Human, stopped at check', () => {
  assert.deepEqual(next(1, checked(1, 'node --test → exit 1: 2 failing')), {
    go: 'build', round: 2, failed: 'the automatic check failed: node --test → exit 1: 2 failing',
  });
  assert.deepEqual(next(2, checked(1, 'node --test → exit 1: 2 failing')), {
    go: 'needsHuman', stoppedAt: 'check', reason: 'the automatic check failed: node --test → exit 1: 2 failing',
  });
});

test('a check that did not run (exit 2 or an error) is not a pass and not a round: Needs Human in any round', () => {
  for (const round of [1, 2]) {
    assert.deepEqual(next(round, checked(2, 'no checks')), { go: 'needsHuman', stoppedAt: 'check', reason: 'the automatic check did not run: no checks' });
  }
});

test('a reviewer FAIL in round 1 goes to round 2 with its report word for word; in round 2 to Needs Human, stopped at review', () => {
  const report = 'VERDICT: FAIL\nFor the Builder: add the test';
  assert.deepEqual(next(1, reviewed('FAIL', report)), { go: 'build', round: 2, failed: `the reviewer's verdict: ${report}` });
  assert.deepEqual(next(2, reviewed('FAIL', report)), { go: 'needsHuman', stoppedAt: 'review', reason: `the reviewer's verdict: ${report}` });
});

test('a Builder that answers needsHuman goes to Needs Human with its reason, in any round', () => {
  for (const round of [1, 2]) {
    assert.deepEqual(next(round, { ...built, needsHuman: true, reason: 'the ticket contradicts itself' } as Outcome), {
      go: 'needsHuman', stoppedAt: 'build', reason: 'the Builder needs the human: the ticket contradicts itself',
    });
  }
});

test('an exhausted budget goes to Needs Human, the Builder\'s and the reviewer\'s, in any round', () => {
  for (const round of [1, 2]) {
    assert.deepEqual(next(round, { ...built, ending: 'budget', detail: 'Reached maximum budget ($10)' } as Outcome), {
      go: 'needsHuman', stoppedAt: 'build', reason: 'the Builder spent its budget (Reached maximum budget ($10))',
    });
    assert.deepEqual(next(round, { step: 'review', ending: 'budget', detail: null, verdict: null, report: null }), {
      go: 'needsHuman', stoppedAt: 'review', reason: 'the reviewer spent its budget',
    });
  }
});

test('an agent that ends in error, or a reviewer with no verdict, goes to Needs Human', () => {
  assert.deepEqual(next(1, { ...built, ending: 'error', detail: 'claude exited 127' } as Outcome), {
    go: 'needsHuman', stoppedAt: 'build', reason: 'the Builder ended in error: claude exited 127',
  });
  assert.deepEqual(next(1, reviewed(null)), { go: 'needsHuman', stoppedAt: 'review', reason: 'the reviewer gave no verdict' });
});

test('the decision is the verdict field only: a report that says PASS does not merge a FAIL', () => {
  assert.equal(next(2, reviewed('FAIL', 'VERDICT: PASS')).go, 'needsHuman');
  assert.equal(next(1, reviewed('PASS', 'VERDICT: FAIL')).go, 'merge');
});
