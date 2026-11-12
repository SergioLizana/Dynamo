// `dynamo run [n ...]`, a list end to end: a temporary repository, the fake gh with many issues that keep their cards,
// labels, comments and blockers, and the fake claude (Builders that commit in their copies, reviewers that pass), with no
// gh or claude on the PATH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runAgent } from '../claude.ts';
import type { Deps } from '../cli.ts';
import { exit } from '../cli.ts';
import { execAsync } from '../exec.ts';
import type { Factory } from '../factory.ts';
import { gh } from '../gh.ts';
import { status } from '../status.ts';
import { git } from '../git.ts';
import { writeHold } from '../holds.ts';
import { notify } from '../notify.ts';
import { LOCK } from '../merging.ts';
import { checkRepo } from '../repocheck.ts';
import { run } from '../run.ts';
import { fakeClaudeEnv, fakeGhEnv, scratch } from './helpers.ts';

const BASE = 'release/1.0.0';
const options = { Todo: '1', Build: '2', Verify: '3', Review: '4', Merge: '7', 'Needs Human': '5', Done: '6' };
const factory = (atOnce: number) => ({
  project: {
    repo: 'o/r', mainBranch: 'main', doneLabel: 'in-release', checks: ['node pass.js', 'git diff --check <base>'],
    boardOwner: 'o',
    budgetUsd: { builder: 3, reviewer: 1 }, timeoutMinutes: { builder: 5, reviewer: 5 }, checkTimeoutMinutes: 5, ticketsAtOnce: atOnce,
  },
  board: { boardNumber: 1, boardId: 'B', boardName: 'Dynamo', statusFieldId: 'S', options },
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

// `noCard`: the issues that are on no board (an epic).
function setup(issues: Record<number, number[]>, answers: Record<string, unknown>[], atOnce = 2, noCard: number[] = [], columns: Record<number, string> = {}) {
  const dir = repo();
  const ghState = scratch();
  const claudeState = scratch();
  const board = {
    boardId: 'B', statusFieldId: 'S', boardName: 'Dynamo', options,
    issues: Object.fromEntries(Object.entries(issues).map(([n, blockedBy]) => [n, { title: `Ticket ${n}`, column: noCard.includes(Number(n)) ? null : columns[Number(n)] ?? 'Todo', labels: [], comments: [], blockedBy }])),
  };
  writeFileSync(join(ghState, 'board.json'), JSON.stringify(board));
  writeFileSync(join(ghState, 'answers.json'), JSON.stringify([{ args: ['pr', 'list'], stdout: '[]' }]));
  writeFileSync(join(claudeState, 'answers.json'), JSON.stringify(answers));
  const ghEnv = fakeGhEnv(ghState);
  const claudeEnv = { ...fakeClaudeEnv(claudeState), FAKE_CLAUDE_PATH: process.env.PATH ?? process.env.Path };
  const deps: Deps = {
    gh: (args, o) => gh(args, { ...o, env: ghEnv }),
    git: (args, o) => git(['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, ...o }),
    exec: execAsync,
    factory: () => factory(atOnce),
    agent: (r, o) => runAgent(r, { ...o, env: claudeEnv }),
  };
  const lines = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l)) : []);
  return {
    dir, deps, claudeState,
    // GitHub now calls the repository `name`: `repo view` answers it.
    rename: (name: string) => writeFileSync(join(ghState, 'board.json'), JSON.stringify({ ...board, repoName: name })),
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
  const out = await run([], f.deps);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.atOnce, 2);
  const calls = f.claudeCalls();
  assert.equal(calls.length, 6);
  // The builders of #1 and #2 each wait for the other to start, so the one that starts second sees both running: had they
  // run one after the other, no call would see 2. Not a measure of time, which a loaded machine stretches.
  assert.equal(Math.max(...calls.map((c) => c.running)), 2, JSON.stringify(calls.map((c) => [c.agent, c.ticket, c.running])));
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
    assert.deepEqual(moves(f.ghCalls(), n), ['Build', 'Verify', 'Review', 'Merge', 'Done'], `#${n}`);
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

// What claude printed when the agent met the usage limit: a result whose api_error is usage_limit_reached, with when it resets.
const limit = [
  JSON.stringify({ type: 'system', subtype: 'init', session_id: 's' }),
  JSON.stringify({ type: 'result', subtype: 'error_unknown', is_error: true, api_error: 'usage_limit_reached', resetsAt: 1793644800, errors: ['usage limit: resets at 5pm'], total_cost_usd: 0.2, num_turns: 1, session_id: 's' }),
].join('\n') + '\n';

test('an agent that hits the usage limit pauses the list: no round, no Needs Human, the running end, none starts, one comment, exit 1', async () => {
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
  assert.match(String(one.reason), /the Builder hit the usage limit/);
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
  assert.match(comments[0], /"api_error":"usage_limit_reached"/);
  assert.match(comments[0], /^Resets at: 2026-11-02T18:40:00\.000Z$/m);
  assert.match(comments[0], /^Cost so far: 0\.2000 USD in 1 turns \(1 agent runs\)$/m);
  assert.match(comments[0], /To relaunch:.*\/dynamo:autopilot 1/);
  assert.equal(readFileSync(join(f.dir, '.claude', 'worktrees', 'logs', '1', 'attempt-1', 'builder-1.jsonl'), 'utf8'), limit);
});

test('a project.repo that GitHub resolves to another name stops the run before any card moves, naming both names', async () => {
  const f = setup({ 1: [] }, builds(1));
  f.rename('o/renamed');
  const out = await run(['1'], f.deps);

  assert.equal(out.ok, false);
  assert.match(String(out.error), /the repository is now o\/renamed; change project\.repo/);
  assert.match(String(out.error), /o\/r/);
  assert.deepEqual([out.repo, out.current], ['o/r', 'o/renamed']);
  assert.ok(!f.ghCalls().some((c) => c[0] === 'project'), 'no card moved');
  assert.equal(f.issue(1).column, 'Todo');
  assert.equal(f.claudeCalls().length, 0);
  assert.deepEqual(branches(f.dir), []);
});

test('an uncommitted file in the main folder stops the run before any agent or card, exit 1, and the line names it', async () => {
  const f = setup({ 1: [] }, builds(1));
  writeFileSync(join(f.dir, 'notes.txt'), 'x');
  writeFileSync(join(f.dir, 'pass.js'), 'changed');
  const { code, out } = await exit(() => run(['1'], f.deps));

  assert.equal(code, 1);
  assert.equal(out.ok, false);
  assert.deepEqual([...(out.dirty as string[])].sort(), ['notes.txt', 'pass.js']);
  assert.match(String(out.error), /main folder is not clean/);
  assert.match(String(out.error), /notes\.txt/);
  assert.match(String(out.error), /pass\.js/);
  assert.match(String(out.error), /nothing was started/);
  assert.ok(!f.ghCalls().some((c) => c[0] === 'project'), 'no card moved');
  assert.equal(f.issue(1).column, 'Todo');
  assert.equal(f.claudeCalls().length, 0);
  assert.deepEqual(branches(f.dir), []);
  assert.equal(existsSync(join(f.dir, '.claude', 'worktrees', 'run.json')), false, 'the lock is not left');
});

test('a project.repo that is the current name (whatever its case) goes on as before', () => {
  const asked: string[][] = [];
  const deps = {
    factory: () => factory(1),
    gh: (args: string[]) => { asked.push(args); return { code: 0, stdout: JSON.stringify({ nameWithOwner: 'O/R' }), stderr: '' }; },
  } as unknown as Deps;
  assert.equal(checkRepo(deps), null);
  assert.deepEqual(asked[0].slice(0, 3), ['repo', 'view', 'o/r']);
});

test('wrong arguments are a usage error', async () => {
  const f = setup({}, []);
  for (const args of [['x'], ['0'], ['7', '-1']]) await assert.rejects(() => run(args, f.deps), /usage: run \[n \.\.\.\]/, args.join(' '));
});

// The notes of a ticket's steps (steps.jsonl of its log folder), each with the time it was written.
const notesOf = (dir: string, n: number): { step: string; ending?: string; text?: string; at: string }[] => readFileSync(join(dir, '.claude', 'worktrees', 'logs', String(n), 'attempt-1', 'steps.jsonl'), 'utf8')
  .split('\n').filter((l) => l !== '').map((l) => JSON.parse(l));

test('while one ticket\'s check runs (a check that sleeps), another ticket\'s agent past its limit is closed on time', async () => {
  // The first run of the check sleeps 6 s; the next ones (the merge's) pass at once. #2's Builder never ends: 0.05 min = 3 s.
  const dir0 = scratch();
  const marker = join(dir0, 'slept');
  const sleeper = `const fs = require('node:fs'); if (!fs.existsSync(${JSON.stringify(marker)})) { fs.writeFileSync(${JSON.stringify(marker)}, ''); setTimeout(() => {}, 6000); }`;
  const f = setup({ 1: [], 2: [] }, [...builds(1), { agent: 'builder', ticket: 2, waitFor: join(dir0, 'never') }]);
  writeFileSync(join(f.dir, 'sleep.js'), sleeper);
  sh(f.dir, 'add', 'sleep.js');
  sh(f.dir, 'commit', '-q', '-m', 'sleep');
  const deps: Deps = {
    ...f.deps,
    factory: () => {
      const base = factory(2) as unknown as { project: Record<string, unknown> };
      return { ...base, project: { ...base.project, checks: ['node sleep.js'], timeoutMinutes: { builder: 0.05, reviewer: 5 } } } as unknown as Factory;
    },
  };
  const out = await run(['1', '2'], deps);

  const [one, two] = out.tickets as Record<string, unknown>[];
  assert.equal(one.merged, true, JSON.stringify(out));
  assert.equal(two.merged, false);
  const closed = notesOf(f.dir, 2).find((n) => n.step === 'agent' && n.ending === 'timeout');
  const checked = notesOf(f.dir, 1).find((n) => n.step === 'check');
  assert.ok(closed !== undefined && checked !== undefined, 'both happened');
  // Had the check blocked the process, #2's Builder would have been closed only after it: 3 s late at least.
  assert.ok(Date.parse(closed.at) < Date.parse(checked.at) - 1000, `the agent was closed at ${closed.at}, the check ended at ${checked.at}`);
});

const lockFile = (dir: string) => join(dir, '.claude', 'worktrees', 'run.json');
const writeLock = (dir: string, pid: number, ageMs: number) => {
  mkdirSync(dirname(lockFile(dir)), { recursive: true });
  writeFileSync(lockFile(dir), JSON.stringify({ pid, since: '2026-11-03T10:00:00.000Z', heartbeat: new Date(Date.now() - ageMs).toISOString() }));
};

test('a second run with a live lock exits at once, says which pid holds it, and starts nothing', async () => {
  const f = setup({ 1: [] }, builds(1));
  writeLock(f.dir, process.pid, 30_000);
  const out = await run([], f.deps);
  assert.equal(out.ok, false);
  assert.equal(out.pid, process.pid);
  assert.match(String(out.error), new RegExp(`pid ${process.pid} holds the lock since 2026-11-03T10:00:00.000Z`));
  assert.equal(f.claudeCalls().length, 0);
  assert.deepEqual(moves(f.ghCalls(), 1), []);
  assert.equal(JSON.parse(readFileSync(lockFile(f.dir), 'utf8')).pid, process.pid, 'the live run keeps its lock');
});

test('a lock of a dead pid, or of a heartbeat over 5 minutes old, does not stop the run, and the lock is freed at the end', async () => {
  const ended = Number(spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']).stdout.toString());
  for (const [pid, age] of [[ended, 1000], [process.pid, 6 * 60_000]]) {
    const f = setup({ 1: [] }, builds(1));
    writeLock(f.dir, pid, age);
    const out = await run([], f.deps);
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.deepEqual((out.tickets as { ticket: number; merged: boolean }[]).map((t) => [t.ticket, t.merged]), [[1, true]]);
    assert.equal(existsSync(lockFile(f.dir)), false);
  }
});

// The notice goes through a fake edge: the lines it was given. The report is a file of the main folder.
const noticed = (f: ReturnType<typeof setup>) => {
  const lines: string[] = [];
  f.deps.notify = async (line) => { lines.push(line); return null; };
  return lines;
};
const reportFile = (dir: string) => join(dir, '.claude', 'worktrees', 'release-report-release-1.0.0.md');

test('the report is written when the list ends, with a notice that it ended', async () => {
  const f = setup({ 1: [] }, builds(1));
  const lines = noticed(f);
  const out = await run([], f.deps);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(existsSync(reportFile(f.dir)), true);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /the list ended: 1 merged, 0 stopped; report: \.claude\/worktrees\/release-report-release-1\.0\.0\.md/);
});

test('a list that pauses does not write the report; the notice has the ticket, the reset time and the command to go on', async () => {
  const f = setup({ 1: [] }, [{ agent: 'builder', ticket: 1, stdout: limit, code: 1 }]);
  const lines = noticed(f);
  const out = await run(['1'], f.deps);
  assert.deepEqual(out.paused, [1]);
  assert.equal(out.report, null);
  assert.equal(existsSync(reportFile(f.dir)), false);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /paused at the usage limit: #1; resets at 2026-11-02T18:40:00\.000Z; to go on: \/dynamo:autopilot 1$/);
});

test('a run with nothing to do writes no report and sends no notice', async () => {
  const f = setup({ 1: [] }, builds(1), 2, [], { 1: 'Needs Human' });
  const lines = noticed(f);
  const out = await run(['1'], f.deps);
  assert.equal(out.report, null);
  assert.equal(existsSync(reportFile(f.dir)), false);
  assert.deepEqual(lines, []);
  assert.equal((await run([], setup({}, []).deps)).report, null, 'an empty list too');
});

test('a notice that cannot be sent is shown in the line of the list and does not stop it; with no variable behind the edge there is no notice and no error', async () => {
  const f = setup({ 1: [] }, builds(1));
  f.deps.notify = async () => 'the notice could not be sent: down';
  const out = await run([], f.deps);
  assert.equal(out.ok, true);
  assert.equal(out.notice, 'the notice could not be sent: down');
  assert.equal(await notify('a line', {}), null);
});

// --- A ticket half done by a run that died (resumes.ts, holds.ts).
const deadHold = (dir: string, n: number, phase: 'build' | 'check' | 'review' | 'merge', round = 1) => writeHold(dir, n, {
  pid: Number(spawnSync(process.execPath, ['-e', '']).pid), startedAt: '2026-11-03T10:00:00.000Z', round, phase, sessions: { builder: null, reviewer: null },
  failed: null, spent: [], builder: null, review: null, checks: null, resetsAt: null,
});

test('a ticket with no card, one in Backlog and one in a phase column with no file are skipped, by number and in a list with none', async () => {
  const issues = { 1: [], 5: [], 6: [], 7: [] };
  const columns = { 6: 'Backlog', 7: 'Review' };
  // By number: each is skipped with its reason and nothing starts.
  const g = setup(issues, [], 2, [5], columns);
  const named = await run(['5', '6', '7'], g.deps);
  const [five, six, seven] = named.tickets as Record<string, unknown>[];
  assert.deepEqual(five, { ok: false, ticket: 5, skipped: 'no card on the board' });
  assert.deepEqual(six, { ok: false, ticket: 6, skipped: 'in Backlog' });
  assert.match(String(seven.skipped), /^in Review, with no file of a run to go on from \(\.claude\/worktrees\/runs\/7\.json\)/);
  assert.equal(g.claudeCalls().length, 0);

  // With no numbers: only the one in a phase column with no file is reported as skipped; the other two stay out.
  const f = setup(issues, builds(1), 2, [5], columns);
  const all = await run([], f.deps);
  const tickets = all.tickets as Record<string, unknown>[];
  assert.deepEqual(tickets.filter((t) => t.skipped === undefined).map((t) => t.ticket), [1]);
  assert.deepEqual(tickets.filter((t) => t.skipped !== undefined).map((t) => t.ticket), [7]);
  assert.ok(!f.claudeCalls().some((c) => c.ticket !== 1));

  for (const x of [f, g]) {
    for (const n of [5, 6, 7]) assert.deepEqual(moves(x.ghCalls(), n), []);
    assert.deepEqual([5, 6, 7].map((n) => x.issue(n).comments), [[], [], []]);
  }
  assert.equal(f.issue(7).column, 'Review', 'its card stays');
  assert.equal(f.issue(6).column, 'Backlog');
});

test('a list with no numbers takes a card in a phase column that has its file, and goes on from it with the others', async () => {
  const f = setup({ 1: [], 5: [] }, [...builds(1), ...builds(5)], 2, [], { 5: 'Build' });
  deadHold(f.dir, 5, 'build');
  const out = await run([], f.deps);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual((out.tickets as { ticket: number; merged: boolean }[]).map((t) => [t.ticket, t.merged]), [[1, true], [5, true]]);
  assert.equal(f.issue(5).column, 'Done');
  assert.deepEqual(f.issue(5).labels, ['in-release']);
  assert.ok(!existsSync(join(f.dir, '.claude', 'worktrees', 'runs', '5.json')));
});

test('launching dynamo run again over a finished state changes nothing: no agent, no card, label or comment, no branch, no commit', async () => {
  const f = setup({ 1: [], 2: [1] }, [...builds(1), ...builds(2)]);
  const first = await run([], f.deps);
  assert.equal(first.ok, true, JSON.stringify(first));
  const state = () => JSON.stringify([
    sh(f.dir, 'for-each-ref', '--format=%(refname) %(objectname)'), sh(f.dir, 'worktree', 'list', '--porcelain'), sh(f.dir, 'status', '--porcelain'),
    f.issue(1), f.issue(2), existsSync(join(f.dir, '.claude', 'worktrees', 'runs')) ? readdirSync(join(f.dir, '.claude', 'worktrees', 'runs')) : [],
  ]);
  const [before, claude, gh] = [state(), f.claudeCalls().length, f.ghCalls().length];

  for (const args of [[], ['1', '2']]) {
    const again = await run(args, f.deps);
    assert.equal(again.ok, args.length === 0, JSON.stringify(again));
    assert.equal(state(), before, `run ${args.join(' ')}`);
    assert.equal(f.claudeCalls().length, claude, 'no agent');
    const writes = f.ghCalls().slice(gh).filter((c) => (c[0] === 'issue' && c[1] !== 'view') || (c[0] === 'project' && c[1] === 'item-edit'));
    assert.deepEqual(writes, [], 'nothing written on GitHub');
  }
  assert.equal(existsSync(lockFile(f.dir)), false);
});
