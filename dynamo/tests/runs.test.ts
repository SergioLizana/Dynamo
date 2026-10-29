import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentResult } from '../agents.ts';
import { builderPrompt, readBuilder, readReviewer, reviewerPrompt } from '../briefs.ts';
import { readFactory } from '../factory.ts';
import { lastResult, outOfTicket } from '../releases.ts';
import { budgetOf, checksOf, columnsOf, failedChecks, resultComment, rowOf, total } from '../runs.ts';
import type { Facts } from '../runs.ts';

// --- The settings of a run (runs.ts).

test('columnsOf takes the columns of the phases Build, Verify and Review and columns.done and needsHuman', () => {
  const factory = readFactory() as Record<string, unknown>;
  assert.deepEqual(columnsOf(factory), { build: 'Build', verify: 'Verify', review: 'Review', done: 'Done', needsHuman: 'Needs Human' });
  assert.throws(() => columnsOf({ ...factory, phases: [] }), /phases \(Build\)\.column/);
});

test('budgetOf reads budgetUsd.<agent> of factory.json, a number above 0, and refuses anything else', () => {
  const factory = readFactory() as Record<string, unknown>;
  assert.ok(budgetOf(factory, 'builder') > 0);
  assert.ok(budgetOf(factory, 'reviewer') > 0);
  for (const bad of [undefined, {}, { builder: 0 }, { builder: -1 }, { builder: '5' }]) {
    assert.throws(() => budgetOf({ budgetUsd: bad }, 'builder'), /budgetUsd\.builder/);
  }
});

test('rowOf reads the ticket\'s row of dynamo board, and checksOf and failedChecks what dynamo verify returned', () => {
  const out = { ok: true, tickets: [{ number: 7, title: 'T', ready: false, why: 'in Needs Human' }] };
  assert.deepEqual(rowOf(out, 7), { title: 'T', ready: false, why: 'in Needs Human' });
  assert.equal(rowOf(out, 8), null);
  const v = { ok: false, base: 'abc', checks: [{ command: 'a', code: 0, output: '' }, { command: 'b <base>', code: 1, output: 'boom' }] };
  assert.equal(checksOf(v)?.length, 2);
  assert.equal(failedChecks(v), 'b <base> → exit 1: boom');
  assert.equal(checksOf({ ok: false, error: 'no copy' }), null);
  assert.equal(failedChecks({ ok: false, error: 'no copy' }), 'no copy');
});

// --- The result comment.

const facts: Facts = {
  base: 'release/1.0.0', merged: true, rounds: 1,
  checks: [{ command: 'node --test', code: 0, output: '' }, { command: 'git diff --check <base>', code: 0, output: '' }],
  verdict: 'PASS', report: 'VERDICT: PASS\nCheckboxes:\n- [x] one — a.ts:1', spent: [{ cost: 1.25, turns: 10 }, { cost: 0.5, turns: 4 }],
  noTrace: null, outOfTicket: 'the README is old', stop: null,
};

test('the comment starts with «run · », and has Rounds, Checks, Reviewer, Cost and Turns as sums, and Out of the ticket', () => {
  const body = resultComment(facts, 7);
  const lines = body.split('\n');
  assert.equal(lines[0], 'run · PASS and merged into release/1.0.0');
  assert.ok(lines.includes('Rounds: 1/2'));
  assert.ok(lines.includes('Checks: node --test → 0; git diff --check <base> → 0'));
  assert.ok(lines.includes('Reviewer: PASS'));
  assert.ok(lines.includes('  - [x] one — a.ts:1'), 'the reviewer\'s report is kept, indented');
  assert.ok(lines.some((l) => l.startsWith('Cost: 1.7500 USD (the sum of total_cost_usd of 2 agent runs)')));
  assert.ok(lines.includes('Turns: 14 (the sum of num_turns)'));
  assert.ok(lines.includes('Out of the ticket (for the backlog): the README is old'));
  assert.ok(!body.includes('Stopped at'));
  assert.deepEqual(total(facts.spent), { cost: 1.75, turns: 14 });
});

test('on Needs Human the comment adds the reason, Stopped at and Left, after Out of the ticket', () => {
  const body = resultComment({
    ...facts, merged: false, rounds: 2, verdict: 'FAIL', report: 'VERDICT: FAIL',
    stop: { stoppedAt: 'review', reason: "the reviewer's verdict: VERDICT: FAIL\nFor the Builder: x", left: 'the copy /r/c and the branch ticket/7-x' },
  }, 7);
  const lines = body.split('\n');
  assert.equal(lines[0], 'run · not merged');
  const at = (prefix: string) => lines.findIndex((l) => l.startsWith(prefix));
  assert.ok(at('Out of the ticket') < at('Reason: ') && at('Reason: ') < at('Stopped at: review') && at('Stopped at: review') < at('Left: the copy /r/c'));
  assert.ok(lines.includes('  For the Builder: x'));
  assert.match(body, /To relaunch: .*dynamo run 7/);
});

test('dynamo report reads the comment as the ticket\'s result: head, rounds and Out of the ticket', () => {
  const merged = lastResult(['an earlier comment', resultComment(facts, 7)]);
  assert.deepEqual({ head: merged?.head, rounds: merged?.rounds }, { head: 'PASS and merged into release/1.0.0', rounds: '1/2' });
  assert.equal(outOfTicket(merged?.out ?? null), 'the README is old');
  const stopped = lastResult([resultComment({ ...facts, merged: false, outOfTicket: '', stop: { stoppedAt: 'build', reason: 'x', left: null } }, 7)]);
  assert.equal(stopped?.head, 'not merged');
  assert.equal(outOfTicket(stopped?.out ?? null), null, 'nothing out of the ticket, and the stop lines are not read as it');
});

// --- What the agents are told and what is taken from their answers (briefs.ts).

const result = (structured: unknown, ending: AgentResult['ending'] = 'success'): AgentResult => ({ ending, structured, cost: 1, turns: 2, session: 's', detail: null });
const answer = { commit: 'abc', needsHuman: false, needsHumanReason: '', published: '', noTrace: '', outOfTicket: 'x' };
const t = { n: 7, title: 'T', repo: 'o/r', base: 'release/1.0.0', copy: '/r/c', branch: 'ticket/7-t' };

test('the prompts name the ticket, base, copy and branch; round 2 adds what failed, the reviewer its previous verdict', () => {
  assert.match(builderPrompt(t, 1, null), /#7 «T» of o\/r\. Base: release\/1\.0\.0\. Round 1 of 2\.[\s\S]*\/r\/c, on the branch ticket\/7-t/);
  assert.match(builderPrompt(t, 2, 'the check failed'), /What failed in round 1, word for word:\nthe check failed$/);
  assert.doesNotMatch(reviewerPrompt(t, null), /previous/);
  assert.match(reviewerPrompt(t, 'VERDICT: FAIL'), /Your previous verdict, word for word:\nVERDICT: FAIL$/);
});

test('readBuilder takes the fields of its schema; an answer of another shape is an error, not a pass', () => {
  assert.deepEqual(readBuilder(result(answer)).outcome, { step: 'build', ending: 'success', detail: null, needsHuman: false, reason: '' });
  assert.deepEqual(readBuilder(result({ ...answer, needsHuman: true, needsHumanReason: 'why' })).outcome,
    { step: 'build', ending: 'success', detail: null, needsHuman: true, reason: 'why' });
  const bad = readBuilder(result({ commit: 'abc' }));
  assert.equal(bad.answer, null);
  assert.deepEqual(bad.outcome, { step: 'build', ending: 'error', detail: 'its answer is not the one of its schema', needsHuman: false, reason: null });
  assert.deepEqual(readBuilder(result(null, 'budget')).outcome, { step: 'build', ending: 'budget', detail: null, needsHuman: false, reason: null });
});

test('readReviewer takes only PASS or FAIL in verdict; anything else is no verdict', () => {
  assert.deepEqual(readReviewer(result({ verdict: 'PASS', report: 'r' })).outcome, { step: 'review', ending: 'success', detail: null, verdict: 'PASS', report: 'r' });
  for (const bad of [{ verdict: 'pass', report: 'r' }, { verdict: 'PASS' }, 'PASS', null]) {
    const o = readReviewer(result(bad)).outcome;
    assert.equal(o.step === 'review' && o.verdict, null, JSON.stringify(bad));
  }
});
