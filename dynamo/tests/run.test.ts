// `dynamo run [n ...]`, a list end to end: a temporary repository, the fake gh with many issues that keep their cards,
// labels, comments and blockers, and the fake claude (Builders that commit in their copies, reviewers that pass), with no
// gh or claude on the PATH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runAgent } from '../claude.ts';
import type { Deps } from '../cli.ts';
import { exec } from '../exec.ts';
import type { Factory } from '../factory.ts';
import { gh } from '../gh.ts';
import { status } from '../status.ts';
import { git } from '../git.ts';
import { LOCK } from '../merging.ts';
import { run } from '../run.ts';
import { fakeClaudeEnv, fakeGhEnv, scratch } from './helpers.ts';

const BASE = 'release/1.0.0';
const options = { Todo: '1', Build: '2', Verify: '3', Review: '4', 'Needs Human': '5', Done: '6' };
const factory = (atOnce: number) => ({
  project: {
    repo: 'o/r', mainBranch: 'main', workingBranch: BASE, doneLabel: 'in-release', checks: ['node pass.js', 'git diff --check <base>'],
    boardOwner: 'o', boardNumber: 1, boardId: 'B', boardName: 'Dynamo', statusFieldId: 'S',
  },
  columns: { todo: 'Todo', needsHuman: 'Needs Human', done: 'Done' },
  options,
  budgetUsd: { builder: 3, reviewer: 1 },
  ticketsAtOnce: atOnce,
  phases: [{ name: 'Build', column: 'Build' }, { name: 'Verify', column: 'Verify' }, { name: 'Review', column: 'Review' }, { name: 'Merge', column: 'Done' }],
}) as unknown as Factory;

const sh = (cwd: string, ...args: string[]) => {
  const r = git(['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd });
  assert.equal(r.code, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

function repo(): string {
  const dir = scratch();
  sh(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, '.gitignore'), '.claude/worktrees/\n');
  writeFileSync(join(dir, 'pass.js'), '');
  sh(dir, 'add', '.');
  sh(dir, 'commit', '-q', '-m', 'A');
  sh(dir, 'checkout', '-q', '-b', BASE);
  return dir;
}

const stream = (structured: unknown) => [
  JSON.stringify({ type: 'system', subtype: 'init', session_id: 's' }),
  JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.5, num_turns: 2, session_id: 's', structured_output: structured }),
].join('\n') + '\n';
const answer = { commit: 'x', needsHuman: false, needsHumanReason: '', published: '', noTrace: '', outOfTicket: '' };
// A Builder of ticket n that commits n.txt, and its reviewer that passes; `extra` goes on the Builder's answer.
const builds = (n: number, extra: Record<string, unknown> = {}) => [
  { agent: 'builder', ticket: n, commit: { file: `${n}.txt`, text: String(n), message: `${n} (#${n})` }, stdout: stream(answer), ...extra },
  { agent: 'reviewer', ticket: n, stdout: stream({ verdict: 'PASS', report: 'VERDICT: PASS' }) },
];

type Call = { agent: string; ticket: number; running: number; cwd: string };

function setup(issues: Record<number, number[]>, answers: Record<string, unknown>[], atOnce = 2) {
  const dir = repo();
  const ghState = scratch();
  const claudeState = scratch();
  const board = {
    boardId: 'B', statusFieldId: 'S', boardName: 'Dynamo', options,
    issues: Object.fromEntries(Object.entries(issues).map(([n, blockedBy]) => [n, { title: `Ticket ${n}`, column: 'Todo', labels: [], comments: [], blockedBy }])),
  };
  writeFileSync(join(ghState, 'board.json'), JSON.stringify(board));
  writeFileSync(join(ghState, 'answers.json'), JSON.stringify([{ args: ['pr', 'list'], stdout: '[]' }]));
  writeFileSync(join(claudeState, 'answers.json'), JSON.stringify(answers));
  const ghEnv = fakeGhEnv(ghState);
  const claudeEnv = { ...fakeClaudeEnv(claudeState), FAKE_CLAUDE_PATH: process.env.PATH ?? process.env.Path };
  const deps: Deps = {
    gh: (args, o) => gh(args, { ...o, env: ghEnv }),
    git: (args, o) => git(['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, ...o }),
    exec,
    factory: () => factory(atOnce),
    agent: (r, o) => runAgent(r, { ...o, env: claudeEnv }),
  };
  const lines = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l)) : []);
  return {
    dir, deps, claudeState,
    ghCalls: (): string[][] => lines(join(ghState, 'calls.jsonl')).map((c) => c.args),
    claudeCalls: (): Call[] => lines(join(claudeState, 'calls.jsonl')),
    issue: (n: number) => JSON.parse(readFileSync(join(ghState, 'board.json'), 'utf8')).issues[n],
  };
}

const moves = (calls: string[][], n: number) => calls
  .filter((c) => c[0] === 'project' && c[1] === 'item-edit' && c[c.indexOf('--url') + 1].endsWith(`/issues/${n}`))
  .map((c) => c[c.indexOf('--value') + 1]);
const branches = (dir: string) => sh(dir, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/ticket/').split('\n').filter((b) => b !== '');
const copies = (dir: string) => sh(dir, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).length - 1;
const mergeOf = (dir: string, n: number) => sh(dir, 'log', '--first-parent', '--format=%H %s', BASE).split('\n').find((l) => l.endsWith(`(#${n})`))?.split(' ')[0] ?? '';

test('never more than N agents at once, and two builds overlap in time', async () => {
  const [a, b] = [join(scratch(), 'a'), join(scratch(), 'b')];
  const f = setup({ 1: [], 2: [], 3: [] }, [
    ...builds(1, { touch: a, waitFor: b }), ...builds(2, { touch: b, waitFor: a }), ...builds(3),
  ]);
  const started = Date.now();
  const out = await run([], f.deps);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.atOnce, 2);
  const calls = f.claudeCalls();
  assert.equal(calls.length, 6);
  assert.equal(Math.max(...calls.map((c) => c.running)), 2, JSON.stringify(calls.map((c) => [c.agent, c.ticket, c.running])));
  // The builders of #1 and #2 each wait for the other to start: had they run one after the other, one would wait 20 s.
  assert.ok(Date.now() - started < 20000);
  assert.equal(calls.filter((c) => c.ticket === 3)[0].agent, 'builder');
  assert.ok(calls.findIndex((c) => c.ticket === 3) > 1, 'the third ticket waits for a free place');
});

test('a list of 3 tickets with 1 dependency is all merged: the dependent starts when its blocker merges, one merge at a time', async () => {
  const f = setup({ 1: [], 2: [1], 3: [] }, [...builds(1), ...builds(2), ...builds(3)]);
  const out = await run(['1', '2', '3'], f.deps);

  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual((out.tickets as { ticket: number; merged: boolean }[]).map((t) => [t.ticket, t.merged]), [[1, true], [2, true], [3, true]]);
  assert.deepEqual([out.cost, out.turns], [3, 12]);
  for (const n of [1, 2, 3]) {
    assert.deepEqual(moves(f.ghCalls(), n), ['Build', 'Verify', 'Review', 'Verify', 'Done'], `#${n}`);
    assert.deepEqual(f.issue(n).labels, ['in-release']);
    assert.match(f.issue(n).comments[0], /^run · PASS and merged into release\/1\.0\.0\n/);
  }
  // #2 was built from the working branch after #1's merge: its branch starts past that merge.
  assert.notEqual(mergeOf(f.dir, 2), '');
  sh(f.dir, 'merge-base', '--is-ancestor', mergeOf(f.dir, 1), `${mergeOf(f.dir, 2)}^2`);
  const calls = f.claudeCalls();
  assert.ok(calls.findIndex((c) => c.ticket === 2) > calls.findIndex((c) => c.ticket === 1 && c.agent === 'reviewer'));
  // One merge at a time: each merge's first parent is the merge before it, and the lock is free at the end.
  assert.equal(sh(f.dir, 'log', '--first-parent', '--format=%s', `main..${BASE}`).split('\n').length, 3);
  assert.equal(git(['show-ref', '--verify', '--quiet', LOCK], { cwd: f.dir }).code, 1);

  // At the end the copies and branches of the merged tickets are gone, and the report is written, its commands printed.
  assert.deepEqual(out.removed, [1, 2, 3]);
  assert.deepEqual(branches(f.dir), []);
  assert.equal(copies(f.dir), 0);
  const report = readFileSync(join(f.dir, String(out.report)), 'utf8');
  assert.match(report, /Tickets merged into release\/1\.0\.0 since main: 3/);
  assert.match(report, /### Skipped by the run\n\n- none\n/);
  assert.ok((out.commands as string[]).some((c) => c.startsWith('gh pr create -R o/r --base main --head release/1.0.0')));
  assert.ok(!f.ghCalls().some((c) => c[0] === 'pr' && c[1] !== 'list'), 'no PR made');
  assert.equal(sh(f.dir, 'status', '--porcelain'), '');
});

test('a blocked ticket keeps its copy and branch; its dependent is skipped with its card where it was and its reason in the line and the report', async () => {
  const f = setup({ 1: [], 2: [1], 3: [] }, [
    { agent: 'builder', ticket: 1, stdout: stream({ ...answer, commit: null, needsHuman: true, needsHumanReason: 'the ticket contradicts itself' }) },
    ...builds(3),
  ]);
  const out = await run(['1', '2', '3'], f.deps);

  assert.equal(out.ok, false);
  const [one, two, three] = out.tickets as Record<string, unknown>[];
  assert.deepEqual([one.ticket, one.merged, one.stoppedAt], [1, false, 'build']);
  assert.match(String(one.reason), /the Builder needs the human: the ticket contradicts itself/);
  assert.deepEqual(two, { ok: false, ticket: 2, skipped: 'blocker #1 stopped in this run' });
  assert.equal(three.merged, true);
  assert.deepEqual(moves(f.ghCalls(), 1), ['Build', 'Needs Human']);
  assert.deepEqual(moves(f.ghCalls(), 2), []);
  assert.equal(f.issue(2).column, 'Todo');
  assert.deepEqual(f.issue(2).comments, []);
  assert.ok(!f.claudeCalls().some((c) => c.ticket === 2));

  assert.deepEqual([out.removed, out.kept], [[3], [1]]);

  // What the run noted is what `dynamo status` reads back: the stopped ticket with its reason, the skipped one with its own.
  const seen = status(['--json', '--logs', join(f.dir, '.claude', 'worktrees', 'logs')], f.deps);
  assert.deepEqual((seen.rows as { ticket: number; column: string }[]).map((r) => [r.ticket, r.column]), [[1, 'Needs Human'], [3, 'Done']]);
  assert.match(String((seen.blocked as { reason: string }[])[0].reason), /the Builder needs the human: the ticket contradicts itself/);
  assert.deepEqual(seen.skipped, [{ ticket: 2, why: 'blocker #1 stopped in this run' }]);
  assert.deepEqual(branches(f.dir), ['ticket/1-ticket-1']);
  assert.equal(copies(f.dir), 1);
  const report = readFileSync(join(f.dir, String(out.report)), 'utf8');
  assert.match(report, /### Needs Human\n\n- #1 «Ticket 1»\n/);
  assert.match(report, /### Skipped by the run\n\n- #2: blocker #1 stopped in this run\n/);
});

test('with no numbers the list is the open tickets that are ready or wait on it; a merge that finds the lock taken stops', async () => {
  const f = setup({ 1: [], 2: [9], 4: [99], 9: [] }, [...builds(1), ...builds(9)], 1);
  sh(f.dir, 'update-ref', LOCK, 'HEAD');
  const out = await run([], f.deps);

  assert.equal(out.ok, false);
  assert.deepEqual((out.tickets as { ticket: number }[]).map((t) => t.ticket), [1, 2, 9], 'not #4: its blocker #99 is not in the list');
  const [one, nine, two] = [1, 9, 2].map((n) => (out.tickets as Record<string, unknown>[]).find((t) => t.ticket === n));
  assert.deepEqual([one?.merged, one?.stoppedAt], [false, 'merge']);
  assert.match(String(one?.reason), /another merge holds the lock/);
  assert.equal(nine?.stoppedAt, 'merge');
  assert.equal(two?.skipped, 'blocker #9 stopped in this run');
  assert.equal(sh(f.dir, 'log', '--first-parent', '--format=%s', `main..${BASE}`), '', 'nothing merged');
  // N = 1: one agent at a time.
  assert.equal(Math.max(...f.claudeCalls().map((c) => c.running)), 1);
});

// What claude printed when the agent met a limit it has no name for: a result with an error subtype dynamo does not know.
const limit = [
  JSON.stringify({ type: 'system', subtype: 'init', session_id: 's' }),
  JSON.stringify({ type: 'result', subtype: 'error_unknown', is_error: true, errors: ['usage limit: resets at 5pm'], total_cost_usd: 0.2, num_turns: 1, session_id: 's' }),
].join('\n') + '\n';

test('an agent that ends with an unknown error pauses the list: no round, no Needs Human, the running end, none starts, one comment, exit 1', async () => {
  const hold = join(scratch(), 'hold');
  const f = setup({ 1: [], 2: [], 3: [], 4: [1] }, [
    { agent: 'builder', ticket: 1, stdout: limit, code: 1 },
    { agent: 'builder', ticket: 2, commit: { file: '2.txt', text: '2', message: '2 (#2)' }, stdout: stream(answer) },
    { agent: 'reviewer', ticket: 2, waitFor: hold, stdout: stream({ verdict: 'PASS', report: 'VERDICT: PASS' }) },
    ...builds(3),
  ]);
  const running = run(['1', '2', '3', '4'], f.deps);
  // #2 is still in its review when #1 pauses: it is left to end (its reviewer is released only after #1's comment).
  const until = Date.now() + 15000;
  while (f.issue(1).comments.length === 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 25));
  assert.equal(f.issue(1).comments.length, 1);
  writeFileSync(hold, '');
  const out = await running;

  assert.equal(out.ok, false);
  assert.deepEqual(out.paused, [1]);
  const [one, two, three, four] = out.tickets as Record<string, unknown>[];
  assert.deepEqual([one.ticket, one.merged, one.paused, one.stoppedAt, one.rounds], [1, false, true, 'build', 1]);
  assert.match(String(one.reason), /the Builder ended in a way dynamo does not know: usage limit: resets at 5pm/);
  assert.equal(two.merged, true);
  assert.deepEqual(three, { ok: false, ticket: 3, skipped: 'the list paused at #1' });
  assert.deepEqual(four, { ok: false, ticket: 4, skipped: 'blocker #1 paused' });
  assert.deepEqual(out.kept, [1]);

  // No round spent and the card where it was: Build, never Needs Human. The other tickets never started.
  assert.deepEqual(moves(f.ghCalls(), 1), ['Build']);
  assert.equal(f.issue(1).column, 'Build');
  assert.deepEqual([3, 4].map((n) => f.issue(n).column), ['Todo', 'Todo']);
  // Sorted: builders 1 and 2 start at once, so either can reach the fake claude first.
  assert.deepEqual(f.claudeCalls().map((c) => `${c.agent} ${c.ticket}`).sort(), ['builder 1', 'builder 2', 'reviewer 2']);
  assert.equal(f.claudeCalls().filter((c) => c.ticket === 1).length, 1, 'no second round');
  assert.deepEqual(branches(f.dir), ['ticket/1-ticket-1']);

  // One comment on the paused ticket: paused, the raw end of the agent from its log, how to relaunch.
  const comments: string[] = f.issue(1).comments;
  assert.equal(comments.length, 1);
  assert.match(comments[0], /^run · paused\n/);
  assert.match(comments[0], /"subtype":"error_unknown"/);
  assert.match(comments[0], /usage limit: resets at 5pm/);
  assert.match(comments[0], /To relaunch:.*dynamo run 1/);
  assert.equal(readFileSync(join(f.dir, '.claude', 'worktrees', 'logs', '1', 'builder-1.jsonl'), 'utf8'), limit);
});

test('wrong arguments are a usage error', async () => {
  const f = setup({}, []);
  for (const args of [['x'], ['0'], ['7', '-1']]) await assert.rejects(() => run(args, f.deps), /usage: run \[n \.\.\.\]/, args.join(' '));
});
