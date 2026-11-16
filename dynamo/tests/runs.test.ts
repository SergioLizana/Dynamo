import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentResult } from '../agents.ts';
import { builderPrompt, languageOf, readBuilder, readReviewer, reviewerPrompt } from '../briefs.ts';
import type { Loop } from '../loopkit.ts';
import { ticket } from '../loopkit.ts';
import { lastResult, outOfTicket } from '../releases.ts';
import { budgetOf, checksOf, failedChecks, resultComment, rowOf, selectorLimitsOf, timeoutOf, total } from '../runs.ts';
import type { Facts } from '../runs.ts';

// --- The settings of a run (runs.ts).

test('selectorLimitsOf reads the selector budget and time limit only with selectTests true, and names the missing key', () => {
  const ok = { selectTests: true, budgetUsd: { selector: 0.5 }, timeoutMinutes: { selector: 3 } };
  const cases: [string, Record<string, unknown>, RegExp | null][] = [
    ['no budget', { ...ok, budgetUsd: {} }, /no project\.budgetUsd\.selector/],
    ['no budget block', { ...ok, budgetUsd: undefined }, /no project\.budgetUsd\.selector/],
    ['no time limit', { ...ok, timeoutMinutes: {} }, /no project\.timeoutMinutes\.selector/],
    ['neither', { selectTests: true }, /no project\.budgetUsd\.selector/],
    ['budget 0', { ...ok, budgetUsd: { selector: 0 } }, /no project\.budgetUsd\.selector/],
    ['time limit text', { ...ok, timeoutMinutes: { selector: '3' } }, /no project\.timeoutMinutes\.selector/],
    ['both set', ok, null],
  ];
  for (const [name, project, error] of cases) {
    if (error === null) assert.deepEqual(selectorLimitsOf(project), { budget: 0.5, minutes: 3 }, name);
    else assert.throws(() => selectorLimitsOf(project), error, name);
  }
  for (const project of [{}, { selectTests: false }, { selectTests: undefined }]) assert.equal(selectorLimitsOf(project), null);
});

test('budgetOf reads budgetUsd.<agent> of factory.json, a number above 0, and refuses anything else', () => {
  assert.equal(budgetOf({ budgetUsd: { builder: 5 } }, 'builder'), 5);
  for (const bad of [undefined, {}, { builder: 0 }, { builder: -1 }, { builder: '5' }]) {
    assert.throws(() => budgetOf({ budgetUsd: bad }, 'builder'), /no project.budgetUsd.builder/);
  }
});

test('timeoutOf reads timeoutMinutes.<agent> of factory.json, a number above 0, and a missing one is an error as budgetUsd is', () => {
  assert.equal(timeoutOf({ timeoutMinutes: { builder: 0.5 } }, 'builder'), 0.5);
  for (const bad of [undefined, {}, { builder: 0 }, { builder: -1 }, { builder: '5' }, { reviewer: 15 }]) {
    assert.throws(() => timeoutOf({ timeoutMinutes: bad }, 'builder'), /no project.timeoutMinutes.builder/);
  }
  assert.throws(() => timeoutOf({}, 'reviewer'), /no project.timeoutMinutes.reviewer/);
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
  checks: [{ command: 'node --test', code: 0, output: '', seconds: 1 }, { command: 'git diff --check <base>', code: 0, output: '', seconds: 0.5 }],
  verifySeconds: [{ round: 1, seconds: 1.5 }], mergeChecks: null, mergeSelector: null, selector: [],
  verdict: 'PASS', report: 'VERDICT: PASS\nCheckboxes:\n- [x] one — a.ts:1', spent: [{ cost: 1.25, turns: 10 }, { cost: 0.5, turns: 4 }],
  noTrace: null, outOfTicket: 'the README is old', stop: null, mergeSkipped: null, removed: [],
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

test('the comment gives the time of Verify in each round and of the checks of the merge, always', () => {
  const lines = (f: Facts) => resultComment(f, 7).split('\n');
  assert.ok(lines(facts).includes('Verify time: round 1 1.5s'));
  assert.ok(lines(facts).includes('Merge checks time: not run'));
  assert.ok(lines({ ...facts, verifySeconds: [] }).includes('Verify time: not run'));
  assert.ok(lines({ ...facts, verifySeconds: [{ round: 1, seconds: 2 }, { round: 2, seconds: 0.25 }] }).includes('Verify time: round 1 2.0s; round 2 0.3s'));
  const merge = [{ command: 'node --test', code: 0, output: '', seconds: 30.1 }, { command: 'git diff --check <base>', code: 0, output: '', seconds: 0.2 }];
  assert.ok(lines({ ...facts, mergeChecks: merge }).includes('Merge checks time: 30.3s (node --test 30.1s; git diff --check <base> 0.2s)'));
  assert.ok(lines({ ...facts, mergeChecks: [], mergeSkipped: 'same tree' }).includes('Merge checks time: skipped'));
});

test('the merge checks time names the merge selector\'s seconds and counts them in its total; with none it is as without', () => {
  const merge = [{ command: 'node --test', code: 0, output: '', seconds: 30.1 }, { command: 'git diff --check <base>', code: 0, output: '', seconds: 0.2 }];
  const skipped = { command: 'git diff --check <base>', code: 0, output: 'skipped by the selector', seconds: 0, skipped: true };
  const cases: [string, Partial<Facts>, string][] = [
    ['selector ran', { mergeChecks: merge, mergeSelector: 2.5 }, 'Merge checks time: 32.8s (selector 2.5s; node --test 30.1s; git diff --check <base> 0.2s)'],
    ['selector ran, one check skipped', { mergeChecks: [merge[0], skipped], mergeSelector: 1.5 }, 'Merge checks time: 31.6s (selector 1.5s; node --test 30.1s; git diff --check <base> 0.0s)'],
    ['no merge selector', { mergeChecks: merge, mergeSelector: null }, 'Merge checks time: 30.3s (node --test 30.1s; git diff --check <base> 0.2s)'],
    ['merge skipped', { mergeChecks: [], mergeSkipped: 'same tree', mergeSelector: null }, 'Merge checks time: skipped'],
  ];
  for (const [name, over, line] of cases) assert.ok(resultComment({ ...facts, ...over }, 7).split('\n').includes(line), name);
});

test('the comment shows a check the selector skipped, and the selector\'s time, cost and turns in each round it ran; with no selector it says nothing of it', () => {
  const lines = (f: Facts) => resultComment(f, 7).split('\n');
  assert.ok(!lines(facts).some((l) => l.startsWith('Selector')));
  const skipped = { command: 'git diff --check <base>', code: 0, output: 'skipped by the selector', seconds: 0, skipped: true };
  const withSelector = lines({ ...facts, checks: [facts.checks![0], skipped], selector: [{ round: 1, seconds: 3.25, cost: 0.0123, turns: 4 }, { round: 2, seconds: 2, cost: null, turns: null }] });
  assert.ok(withSelector.includes('Checks: node --test → 0; git diff --check <base> → skipped by the selector'));
  assert.ok(withSelector.some((l) => l.startsWith('Selector: round 1 3.3s, 0.0123 USD, 4 turns; round 2 2.0s, no cost, no turns')), withSelector.join('\n'));
});

test('a merge that skipped its checks says so in the comment, after Checks; one that ran them says nothing of it', () => {
  assert.ok(!resultComment(facts, 7).includes('Merge checks:'));
  const why = 'the merged tree is the tree of abc1234, which Verify passed: the checks were not run again';
  const lines = resultComment({ ...facts, mergeSkipped: why }, 7).split('\n');
  const at = lines.findIndex((l) => l.startsWith('Checks: '));
  assert.equal(lines[at + 1], `Merge checks: skipped, ${why}`);
  assert.equal(lines[0], 'run · PASS and merged into release/1.0.0');
});

test('what was removed from the copy is named in the comment, after Out of the ticket; with nothing removed the comment says nothing of it', () => {
  assert.ok(!/remov/i.test(resultComment(facts, 7)));
  const lines = resultComment({ ...facts, removed: ['.tmp-measure/', 'notes.txt'] }, 7).split('\n');
  const at = lines.findIndex((l) => l.startsWith('Out of the ticket'));
  assert.equal(lines[at + 1], 'Removed from the copy (git did not track it): .tmp-measure/, notes.txt');
  assert.equal(lastResult([lines.join('\n')])?.head, 'PASS and merged into release/1.0.0');
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
  assert.match(body, /To relaunch: .*\/dynamo:autopilot 7/);
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
const t = { n: 7, title: 'T', repo: 'o/r', base: 'release/1.0.0', copy: '/r/c', branch: 'ticket/7-t', language: 'English' };

test('the prompts name the ticket, base, copy and branch; round 2 adds what failed, the reviewer its previous verdict', () => {
  assert.match(builderPrompt(t, 1, null), /#7 «T» of o\/r\. Base: release\/1\.0\.0\. Round 1 of 2\.[\s\S]*\/r\/c, on the branch ticket\/7-t/);
  assert.match(builderPrompt(t, 2, 'the check failed'), /What failed in round 1, word for word:\nthe check failed$/);
  assert.doesNotMatch(reviewerPrompt(t, null, null), /previous/);
  assert.match(reviewerPrompt(t, 'VERDICT: FAIL', null), /Your previous verdict, word for word:\nVERDICT: FAIL$/);
});

// Talia Web #22 came out in English under a Spanish project: the Builder's answer fields are not «GitHub comments» to it, so
// its agent file did not reach them. The prompt the code builds says the language, whatever the agent file says.
test('the Builder\'s prompt names the documents language for its answer, commits and comments, and keeps numbers and commands', () => {
  const prompt = builderPrompt({ ...t, language: 'Spanish' }, 1, null);
  assert.match(prompt, /`noTrace`, `outOfTicket`\), your commit subjects and your GitHub comments in Spanish/);
  assert.match(prompt, /change no number, `#n`, command or path/);
  assert.match(builderPrompt({ ...t, language: 'Spanish' }, 2, 'x', true), /in Spanish/, 'a resumed, round 2 prompt says it too');
});

test('the language comes from project.documentsLanguage; with none, English; the ticket of a loop carries it', () => {
  assert.equal(languageOf({ documentsLanguage: 'Spanish' }), 'Spanish');
  assert.equal(languageOf({ documentsLanguage: '  ' }), 'English');
  assert.equal(languageOf({}), 'English');
  const loop = { n: 7, title: 'T', deps: { factory: () => ({ project: { documentsLanguage: 'Spanish' }, board: {} }) } } as unknown as Loop;
  const state = { copy: '/r/c', branch: 'ticket/7-t' } as unknown as Parameters<typeof ticket>[3];
  assert.equal(ticket(loop, 'o/r', 'release/1.0.0', state).language, 'Spanish');
});

test('the reviewer\'s prompt carries each command of the check with its exit code, as the proof of the check', () => {
  const prompt = reviewerPrompt(t, null, [{ command: 'node --test dynamo/tests/', code: 0, output: '' }, { command: 'git diff --check <base>', code: 0, output: '' }]);
  assert.match(prompt, /automatic check/);
  assert.match(prompt, /^- node --test dynamo\/tests\/ → exit 0$/m);
  assert.match(prompt, /^- git diff --check <base> → exit 0$/m);
  assert.doesNotMatch(reviewerPrompt(t, null, null), /automatic check/, 'with no result of the check there is nothing to carry');
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

test('a stop at merge does not tell the human to remove the copy and the branch: only the merge is retried; the other stops still do', () => {
  const stop = (stoppedAt: 'merge' | 'review') => resultComment({ ...facts, merged: false, stop: { stoppedAt, reason: 'x', left: 'the copy /r/c and the branch ticket/7-x' } }, 7);
  const merge = stop('merge');
  assert.match(merge, /To relaunch: .*\/dynamo:autopilot 7/);
  assert.doesNotMatch(merge, /git worktree remove|git branch -D/);
  assert.match(stop('review'), /git worktree remove.*git branch -D/s);
});

test('a Builder that asked the human is not told to remove the copy and the branch: it goes on with the comments written after the notice', () => {
  const asked = resultComment({ ...facts, merged: false, stop: { stoppedAt: 'build', reason: 'the Builder needs the human: which one?', left: 'the copy /r/c and the branch ticket/7-x', asked: true } }, 7);
  assert.match(asked, /\nTo relaunch: answer in a comment of this ticket.*\/dynamo:autopilot 7/);
  assert.doesNotMatch(asked, /git worktree remove|git branch -D|remove what/);
  const other = resultComment({ ...facts, merged: false, stop: { stoppedAt: 'build', reason: 'the Builder spent its budget', left: 'the copy /r/c and the branch ticket/7-x', asked: false } }, 7);
  assert.match(other, /git worktree remove.*git branch -D/s);
});

test('a ticket the Reviewer failed in the last round is not told to remove the copy and the branch: its Builder goes on with the verdict and the comments', () => {
  const kept = resultComment({ ...facts, merged: false, stop: { stoppedAt: 'review', reason: "the reviewer's verdict: VERDICT: FAIL", left: 'the copy /r/c and the branch ticket/7-x', asked: true } }, 7);
  assert.match(kept, /\nTo relaunch: .*\/dynamo:autopilot 7/);
  assert.doesNotMatch(kept, /git worktree remove|git branch -D|remove what/);
});
