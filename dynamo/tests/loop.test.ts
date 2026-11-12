// One ticket of `dynamo run` end to end (loop.ts): a temporary repository, the fake gh (one issue that keeps its card, labels and comments) and the
// fake claude (a Builder that commits in its copy, a reviewer that answers PASS or FAIL), with no gh or claude on the PATH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runAgent } from '../claude.ts';
import type { Deps } from '../cli.ts';
import { execAsync } from '../exec.ts';
import type { Factory } from '../factory.ts';
import { gh } from '../gh.ts';
import { git } from '../git.ts';
import { writeHold } from '../holds.ts';
import { lastResult } from '../releases.ts';
import { runTicket } from '../loop.ts';
import { OUTAGE_TRIES, OUTAGE_WAIT_MS } from '../rounds.ts';
import { fakeClaudeEnv, fakeGhEnv, scratch } from './helpers.ts';

const BASE = 'release/1.0.0';
const options = { Todo: '1', Build: '2', Verify: '3', Review: '4', Merge: '7', 'Needs Human': '5', Done: '6' };
const factory = {
  project: {
    repo: 'o/r', mainBranch: 'main', doneLabel: 'in-release', checks: ['node pass.js', 'git diff --check <base>'],
    boardOwner: 'o',
    budgetUsd: { builder: 3, reviewer: 1 }, timeoutMinutes: { builder: 5, reviewer: 5 }, checkTimeoutMinutes: 5,
  },
  board: { boardNumber: 1, boardId: 'B', boardName: 'Dynamo', statusFieldId: 'S', options },
} as unknown as Factory;
// The factory with one value of the project replaced; `undefined` removes it.
const withProject = (key: string, value: unknown) => (): Factory => ({ ...factory, project: { ...factory.project, [key]: value } }) as unknown as Factory;

const sh = (cwd: string, ...args: string[]) => {
  const r = git(['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd });
  assert.equal(r.code, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

// `main` with the gitignore of the copies and a check that passes; the working branch one commit past it, checked out.
function repo(): string {
  const dir = scratch();
  sh(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, '.gitignore'), '.claude/worktrees/\n');
  writeFileSync(join(dir, 'pass.js'), '');
  // A check that only fails where the merge is checked (its copy is `merge-<n>`), as a flaky test would after Verify passed.
  writeFileSync(join(dir, 'only-at-merge.js'), "process.stdout.write('flaky'); process.exit(require('node:path').basename(process.cwd()).startsWith('merge-') ? 5 : 0);");
  // A check that fails while two.txt is there and three.txt is not: the second round's Builder fails it, a Builder that goes on fixes it.
  writeFileSync(join(dir, 'two-no-three.js'), "const fs = require('node:fs'); if (fs.existsSync('two.txt') && !fs.existsSync('three.txt')) { process.stdout.write('two without three'); process.exit(1); }");
  sh(dir, 'add', '.');
  sh(dir, 'commit', '-q', '-m', 'A');
  sh(dir, 'checkout', '-q', '-b', BASE);
  writeFileSync(join(dir, 'b.txt'), 'b');
  sh(dir, 'add', 'b.txt');
  sh(dir, 'commit', '-q', '-m', 'B');
  return dir;
}

const conn = (nodes: unknown[]) => ({ totalCount: nodes.length, nodes });
const boardAnswer = (blockers: unknown[], column = 'Todo') => JSON.stringify({ data: { repository: { t7: {
  number: 7, title: 'Run one ticket', state: 'OPEN', labels: conn([]),
  projectItems: conn([{ project: { id: 'B' }, fieldValues: conn([{ name: column, field: { id: 'S' } }]) }]), blockedBy: conn(blockers),
} } } });

// One line of the stream with the answer, as `claude -p --output-format stream-json` ends.
const stream = (structured: unknown, cost: number, turns: number) => [
  JSON.stringify({ type: 'system', subtype: 'init', session_id: 's' }),
  JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: cost, num_turns: turns, session_id: 's', structured_output: structured }),
].join('\n') + '\n';
const built = (file: string) => ({ commit: { file, text: file, message: `${file} (#7)` } });
const builder = { commit: 'x', needsHuman: false, needsHumanReason: '', published: '', noTrace: '', outOfTicket: '' };

type Call = { args: string[]; stdin: string; cwd: string; agent: string; watched?: string };

// `body`: the body of the issue, where its Level: line is; `levels`: what the project sets as `project.levels`.
function setup(answers: Record<string, unknown>[], blockers: unknown[] = [], checks?: string[], own: { body?: string; levels?: unknown } = {}) {
  const dir = repo();
  const ghState = scratch();
  const claudeState = scratch();
  writeFileSync(join(ghState, 'answers.json'), JSON.stringify([{ args: ['api', 'graphql'], stdout: boardAnswer(blockers) }]));
  writeFileSync(join(ghState, 'issue.json'), JSON.stringify({ title: 'Run one ticket', body: own.body, boardName: 'Dynamo', options, column: 'Todo', labels: [], comments: [] }));
  writeFileSync(join(claudeState, 'answers.json'), JSON.stringify(answers.map((a) => ({ ...a, watch: dir }))));
  const ghEnv = fakeGhEnv(ghState);
  const claudeEnv = { ...fakeClaudeEnv(claudeState), FAKE_CLAUDE_PATH: process.env.PATH ?? process.env.Path };
  const deps: Deps = {
    gh: (args, o) => gh(args, { ...o, env: ghEnv }),
    git: (args, o) => git(['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, ...o }),
    exec: execAsync,
    factory: () => ({ ...factory, project: { ...factory.project, ...(checks === undefined ? {} : { checks }), ...(own.levels === undefined ? {} : { levels: own.levels }) } }) as Factory,
    agent: (r, o) => runAgent(r, { ...o, env: claudeEnv }),
  };
  const lines = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l)) : []);
  return {
    dir, deps,
    // The column the board says the card is in: a run that goes on finds it where the run that died left it.
    at: (column: string) => writeFileSync(join(ghState, 'answers.json'), JSON.stringify([{ args: ['api', 'graphql'], stdout: boardAnswer(blockers, column) }])),
    ghCalls: (): string[][] => lines(join(ghState, 'calls.jsonl')).map((c) => c.args),
    claudeCalls: (): Call[] => lines(join(claudeState, 'calls.jsonl')),
    issue: () => JSON.parse(readFileSync(join(ghState, 'issue.json'), 'utf8')),
    // The issue as the fake gh keeps it, replaced: what the board and the issue say after a run died.
    setIssue: (i: unknown) => writeFileSync(join(ghState, 'issue.json'), JSON.stringify(i)),
  };
}

const moves = (calls: string[][]) => calls.filter((c) => c[0] === 'project' && c[1] === 'item-edit').map((c) => c[c.indexOf('--value') + 1]);
const branches = (dir: string) => sh(dir, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/ticket/').split('\n').filter((b) => b !== '');
const logs = (dir: string, attempt = 1) => join(dir, '.claude', 'worktrees', 'logs', '7', `attempt-${attempt}`);
const jsonl = (file: string) => readFileSync(file, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l));
const flag = (c: Call, name: string) => (c.args.includes(name) ? c.args[c.args.indexOf(name) + 1] : undefined);

test('a ready ticket is built, checked, reviewed and merged: cards in order, one comment with cost and turns', async () => {
  const f = setup([
    { agent: 'builder', ...built('built.txt'), stdout: stream(builder, 1.5, 12) },
    { agent: 'reviewer', stdout: stream({ verdict: 'PASS', report: 'VERDICT: PASS\nCheckboxes:\n- [x] it works — built.txt:1' }, 0.25, 3) },
  ]);
  const before = sh(f.dir, 'rev-parse', 'HEAD');

  const out = await runTicket(7, f.deps);

  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.merged, true);
  assert.equal(out.rounds, 1);
  assert.deepEqual([out.cost, out.turns], [1.75, 15]);
  assert.deepEqual(moves(f.ghCalls()), ['Build', 'Verify', 'Review', 'Merge', 'Done']);
  assert.equal(sh(f.dir, 'log', '-1', '--format=%s'), `Merge ticket/7-run-one-ticket into ${BASE} (#7)`);
  assert.equal(sh(f.dir, 'rev-parse', 'HEAD^1'), before);
  assert.equal(readFileSync(join(f.dir, 'built.txt'), 'utf8'), 'built.txt');
  assert.equal(out.head, sh(f.dir, 'rev-parse', '--short', 'HEAD'));
  assert.deepEqual(branches(f.dir), ['ticket/7-run-one-ticket']);
  assert.deepEqual(f.issue().labels, ['in-release']);

  // The logs: one per agent run, in the folder of this attempt, and the main folder stays clean throughout.
  assert.deepEqual(readdirSync(logs(f.dir)).sort(), ['builder-1.jsonl', 'comment.md', 'reviewer-1.jsonl', 'steps.jsonl']);
  assert.equal(out.logs, '.claude/worktrees/logs/7/attempt-1');
  assert.equal(readFileSync(join(logs(f.dir), 'builder-1.jsonl'), 'utf8'), stream(builder, 1.5, 12));
  // Each step is noted in a file of its own: the card at every move, each agent's result, the check, the merge.
  const notes = jsonl(join(logs(f.dir), 'steps.jsonl'));
  assert.deepEqual(notes.map((n) => n.column ?? n.agent ?? n.step), ['start', 'Build', 'builder', 'Verify', 'check', 'Review', 'reviewer', 'Merge', 'Done', 'merged']);
  assert.deepEqual(notes.filter((n) => n.step === 'agent').map((n) => [n.ending, n.cost, n.turns]), [['success', 1.5, 12], ['success', 0.25, 3]]);
  assert.ok(notes.every((n) => n.round === 1 && typeof n.at === 'string'));
  const calls = f.claudeCalls();
  assert.deepEqual(calls.map((c) => c.watched), ['', '']);
  assert.equal(sh(f.dir, 'status', '--porcelain'), '');

  // Neither gets tools by flag: the reviewer is held to read-only tools by its agent file. Both run in the copy.
  const [b, r] = calls;
  assert.deepEqual([b.agent, r.agent], ['builder', 'reviewer']);
  for (const c of [b, r]) assert.ok(!c.args.includes('--tools') && !c.args.includes('--strict-mcp-config'), c.agent);
  assert.equal(flag(b, '--max-budget-usd'), '3');
  assert.equal(flag(r, '--max-budget-usd'), '1');
  const copy = join(f.dir, '.claude', 'worktrees', 'ticket-7');
  assert.deepEqual([b.cwd, r.cwd], [copy, copy]);

  // One comment, the ticket's result for `dynamo report`.
  const comments: string[] = f.issue().comments;
  assert.equal(comments.length, 1);
  const lines = comments[0].split('\n');
  assert.equal(lines[0], `run · PASS and merged into ${BASE}`);
  // A copy with nothing untracked is not named.
  assert.ok(!/remov/i.test(comments[0]), comments[0]);
  assert.ok(lines.some((l) => l.startsWith('Cost: 1.7500 USD')));
  assert.ok(lines.includes('Turns: 15 (the sum of num_turns)'));
  assert.ok(lines.includes('Checks: node pass.js → 0; git diff --check <base> → 0'));
  // The working branch did not move after Verify: the merged tree is the tree Verify passed, so the merge ran no check.
  assert.ok(lines.some((l) => /^Merge checks: skipped, the merged tree is the tree of [0-9a-f]{7}, which Verify passed/.test(l)), comments[0]);
  assert.deepEqual(lastResult(comments)?.rounds, '1/2');
});

test('a merged ticket\'s copy is left with nothing git does not track, and the comment names what was removed; committed work stays', async () => {
  const f = setup([
    { agent: 'builder', ...built('built.txt'), touch: '.tmp-measure/run.json', stdout: stream(builder, 1, 2) },
    { agent: 'reviewer', stdout: stream({ verdict: 'PASS', report: 'VERDICT: PASS' }, 0.25, 3) },
  ]);
  const out = await runTicket(7, f.deps);
  assert.equal(out.ok, true, JSON.stringify(out));
  const copy = join(f.dir, '.claude', 'worktrees', 'ticket-7');
  assert.equal(existsSync(join(copy, '.tmp-measure')), false);
  assert.equal(sh(copy, 'status', '--porcelain', '--untracked-files=all'), '');
  assert.equal(readFileSync(join(copy, 'built.txt'), 'utf8'), 'built.txt');
  assert.equal(sh(copy, 'log', '-1', '--format=%s'), 'built.txt (#7)');
  const lines = f.issue().comments[0].split('\n');
  assert.ok(lines.includes('Removed from the copy (git did not track it): .tmp-measure/'), lines.join('\n'));
});

test('a ticket that stops is cleaned too: the untracked file is gone and named, the tracked and committed work stays', async () => {
  const f = setup([
    { agent: 'builder', ...built('built.txt'), touch: 'scratch.txt', stdout: stream({}, 1, 5) }, // an answer that is not the one of its schema: an error, not a kept stop
  ]);
  const out = await runTicket(7, f.deps);
  assert.equal(out.ok, false);
  const copy = join(f.dir, '.claude', 'worktrees', 'ticket-7');
  assert.equal(existsSync(join(copy, 'scratch.txt')), false);
  assert.equal(readFileSync(join(copy, 'built.txt'), 'utf8'), 'built.txt');
  assert.ok(f.issue().comments[0].split('\n').includes('Removed from the copy (git did not track it): scratch.txt'));
});

test('a ticket the reviewer fails twice goes to Needs Human after round 2, on the same copy and branch, not merged', async () => {
  const fail = (n: number) => ({ verdict: 'FAIL', report: `VERDICT: FAIL\nFor the Builder: fix ${n}` });
  const f = setup([
    { agent: 'builder', ...built('one.txt'), stdout: stream(builder, 1, 5) },
    { agent: 'reviewer', stdout: stream(fail(1), 0.5, 2) },
    { agent: 'builder', ...built('two.txt'), stdout: stream({ ...builder, outOfTicket: 'the docs are old' }, 1, 4) },
    { agent: 'reviewer', stdout: stream(fail(2), 0.5, 2) },
  ]);
  const before = sh(f.dir, 'rev-parse', 'HEAD');

  const out = await runTicket(7, f.deps);

  assert.equal(out.ok, false);
  assert.equal(out.merged, false);
  assert.equal(out.rounds, 2);
  assert.equal(out.stoppedAt, 'review');
  assert.deepEqual(moves(f.ghCalls()), ['Build', 'Verify', 'Review', 'Build', 'Verify', 'Review', 'Needs Human']);
  assert.equal(sh(f.dir, 'rev-parse', 'HEAD'), before, 'nothing merged');
  assert.deepEqual(f.issue().labels, []);

  // Round 2 works on the same copy and branch: one ticket/7-* branch, with the commits of both rounds.
  assert.deepEqual(branches(f.dir), ['ticket/7-run-one-ticket']);
  assert.equal(sh(f.dir, 'rev-list', '--count', `${BASE}..ticket/7-run-one-ticket`), '2');
  const calls = f.claudeCalls();
  assert.equal(new Set(calls.map((c) => realpathSync(c.cwd))).size, 1);
  assert.match(calls[2].stdin, /Round 2 of 2[\s\S]*What failed in round 1, word for word:\nthe reviewer's verdict: VERDICT: FAIL\nFor the Builder: fix 1/);
  assert.match(calls[3].stdin, /Your previous verdict, word for word:\nVERDICT: FAIL\nFor the Builder: fix 1/);
  assert.deepEqual(readdirSync(logs(f.dir)).sort(), ['builder-1.jsonl', 'builder-2.jsonl', 'comment.md', 'reviewer-1.jsonl', 'reviewer-2.jsonl', 'steps.jsonl']);
  assert.deepEqual(calls.map((c) => c.watched), ['', '', '', '']);
  assert.equal(sh(f.dir, 'status', '--porcelain'), '');

  const comments: string[] = f.issue().comments;
  assert.equal(comments.length, 1);
  const lines = comments[0].split('\n');
  assert.equal(lines[0], 'run · not merged');
  assert.ok(lines.includes('Rounds: 2/2'));
  assert.ok(lines.includes('Turns: 13 (the sum of num_turns)'));
  assert.ok(lines.includes('Out of the ticket (for the backlog): the docs are old'));
  assert.ok(lines.includes("Reason: the reviewer's verdict: VERDICT: FAIL"));
  assert.ok(lines.includes('Stopped at: review'));
  assert.ok(lines.some((l) => /^Left: the copy .*ticket-7 and the branch ticket\/7-run-one-ticket$/.test(l)));
  assert.equal(lastResult(comments)?.head, 'not merged');
});

test('a check that fails only at the merge sends the ticket to Needs Human naming it; the working branch stays, with no revert', async () => {
  const f = setup([
    { agent: 'builder', ...built('built.txt'), stdout: stream(builder, 1, 5) },
    { agent: 'reviewer', stdout: stream({ verdict: 'PASS', report: 'VERDICT: PASS' }, 0.5, 2) },
  ], [], ['node pass.js', 'node only-at-merge.js']);
  let before = '';
  // The working branch moves after Verify (another ticket merged): the merged tree is not the one Verify passed, so the merge runs the checks.
  const agent = f.deps.agent;
  f.deps.agent = async (r, o) => {
    const done = await agent!(r, o);
    if (r.agent === 'reviewer') {
      writeFileSync(join(f.dir, 'other.txt'), 'another ticket');
      sh(f.dir, 'add', 'other.txt');
      sh(f.dir, 'commit', '-q', '-m', 'another ticket merged');
      before = sh(f.dir, 'rev-parse', 'HEAD'); // where the working branch must stay after the failed merge
    }
    return done;
  };

  const out = await runTicket(7, f.deps);

  assert.notEqual(before, '');
  assert.equal(out.ok, false);
  assert.equal(out.merged, false);
  assert.equal(out.stoppedAt, 'merge');
  assert.match(String(out.reason), /the check `node only-at-merge\.js` failed \(exit 5\) after the merge of ticket\/7-run-one-ticket into release\/1\.0\.0: flaky/);
  assert.deepEqual(moves(f.ghCalls()), ['Build', 'Verify', 'Review', 'Merge', 'Needs Human']);
  assert.equal(sh(f.dir, 'rev-parse', 'HEAD'), before);
  assert.equal(sh(f.dir, 'log', '--format=%s', '--grep=^Revert'), '');
  assert.deepEqual(f.issue().labels, []);
  assert.match(f.issue().comments[0], /^run · not merged\n[\s\S]*Stopped at: merge\n/);
});

const spentBudget = (cost: number) => ({ agent: 'builder', stdout: JSON.stringify({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, total_cost_usd: cost, num_turns: 30, errors: ['Reached maximum budget ($3)'] }) + '\n', code: 1 });
const costsIn = (dir: string) => jsonl(join(dir, 'steps.jsonl')).filter((n) => n.step === 'agent').map((n) => n.cost);

test('a ticket run twice keeps the logs of both attempts, each in its own folder, and its comment and JSON line name the folder of their attempt', async () => {
  const f = setup([spentBudget(3.1), spentBudget(3.2)]);
  const first = await runTicket(7, f.deps);
  // As the human relaunches a stopped ticket: what the first run left (its copy and branch) is removed.
  sh(f.dir, 'worktree', 'remove', '--force', join(f.dir, '.claude', 'worktrees', 'ticket-7'));
  for (const b of branches(f.dir)) sh(f.dir, 'branch', '-D', b);
  const second = await runTicket(7, f.deps);
  assert.equal(first.logs, '.claude/worktrees/logs/7/attempt-1');
  assert.equal(second.logs, '.claude/worktrees/logs/7/attempt-2', JSON.stringify(second));
  assert.deepEqual(readdirSync(join(logs(f.dir), '..')).sort(), ['attempt-1', 'attempt-2']);
  assert.deepEqual(costsIn(logs(f.dir, 1)), [3.1]);
  assert.deepEqual(costsIn(logs(f.dir, 2)), [3.2]);
  assert.ok(existsSync(join(logs(f.dir, 1), 'builder-1.jsonl')) && existsSync(join(logs(f.dir, 2), 'builder-1.jsonl')));
});

test('the next attempt is the latest one plus one, also past nine; names that are not attempts are not counted', async () => {
  const f = setup([spentBudget(3.1)]);
  for (const name of ['attempt-9', 'attempt-10', 'attempt-1d', 'attempt-0']) mkdirSync(join(logs(f.dir), '..', name), { recursive: true });
  writeFileSync(join(logs(f.dir, 10), 'builder-1.jsonl'), 'an earlier attempt');
  const out = await runTicket(7, f.deps);
  assert.equal(out.logs, '.claude/worktrees/logs/7/attempt-11');
  assert.equal(readFileSync(join(logs(f.dir, 10), 'builder-1.jsonl'), 'utf8'), 'an earlier attempt');
  assert.ok(existsSync(join(logs(f.dir, 11), 'builder-1.jsonl')));
});

test('a ticket dynamo board does not give as ready is not started: the JSON line says why, no card moves, no agent', async () => {
  const f = setup([], [{ number: 3, state: 'OPEN', labels: conn([]) }]);
  const out = await runTicket(7, f.deps);
  assert.deepEqual(out, { ok: false, ticket: 7, started: false, why: 'blocker not done: #3' });
  assert.deepEqual(f.ghCalls().map((c) => c.slice(0, 2)), [['api', 'graphql']]);
  assert.deepEqual(f.claudeCalls(), []);
  assert.equal(existsSync(logs(f.dir)), false);
  assert.equal(readHold(f.dir), null, 'a ticket that is not ready writes no file');
});

test('a Builder that spends its budget sends the ticket to Needs Human, stopped at build, without a check or a reviewer', async () => {
  const spent = JSON.stringify({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, total_cost_usd: 3.1, num_turns: 30, errors: ['Reached maximum budget ($3)'] });
  const f = setup([{ agent: 'builder', stdout: spent + '\n', code: 1 }]);
  const out = await runTicket(7, f.deps);
  assert.equal(out.ok, false);
  assert.equal(out.stoppedAt, 'build');
  assert.match(String(out.reason), /the Builder spent its budget \(Reached maximum budget \(\$3\)\)/);
  assert.deepEqual(moves(f.ghCalls()), ['Build', 'Needs Human']);
  assert.equal(readHold(f.dir)?.asked, true, 'a spent budget is a kept stop (keeps.ts): its file stays');
  assert.deepEqual(f.claudeCalls().map((c) => c.agent), ['builder']);
  assert.match(f.issue().comments[0], /^run · not merged\n[\s\S]*Checks: not run\n[\s\S]*Stopped at: build\n/);
});

test('an agent past its time limit with no result ends as timeout: Needs Human with the reason and the log path, no round spent, no retry', async () => {
  for (const [name, answers, limits] of [
    ['builder', [{ agent: 'builder', stdout: '{"type":"system","subtype":"init"}\n', waitFor: 'never' }], { builder: 0.02, reviewer: 5 }],
    ['reviewer', [
      { agent: 'builder', ...built('t.txt'), stdout: stream(builder, 1, 5) },
      { agent: 'reviewer', stdout: '{"type":"system","subtype":"init"}\n', waitFor: 'never' },
    ], { builder: 5, reviewer: 0.02 }],
  ] as const) {
    const f = setup([...answers]);
    const deps: Deps = { ...f.deps, factory: withProject('timeoutMinutes', limits) };

    const out = await runTicket(7, deps);

    const stage = name === 'builder' ? 'build' : 'review';
    assert.deepEqual([out.ok, out.merged, out.rounds, out.stoppedAt, out.paused], [false, false, 1, stage, undefined], name);
    assert.equal(f.claudeCalls().length, answers.length, `${name}: not retried`);
    const log = `.claude/worktrees/logs/7/attempt-1/${name}-1.jsonl`;
    assert.match(String(out.reason), new RegExp(`^the ${name === 'builder' ? 'Builder' : 'reviewer'} ended as timeout: no result after 0\\.02 min.*log: ${log.replaceAll('.', '\\.')}$`), name);
    assert.deepEqual(moves(f.ghCalls()).at(-1), 'Needs Human');
    assert.ok(!moves(f.ghCalls()).includes('Build') || moves(f.ghCalls()).filter((m) => m === 'Build').length === 1, 'no second Builder round');
    const comments: string[] = f.issue().comments;
    assert.equal(comments.length, 1);
    assert.match(comments[0], /^run · not merged\n/);
    assert.ok(comments[0].split('\n').includes('Rounds: 1/2'));
    assert.match(comments[0], new RegExp(`Reason: the .* ended as timeout: no result after 0\\.02 min.*log: ${log.replaceAll('.', '\\.')}\\n`));
    assert.match(comments[0], new RegExp(`Stopped at: ${stage}\\n`));
    assert.ok(readFileSync(join(logs(f.dir), `${name}-1.jsonl`), 'utf8').includes('"subtype":"timeout"'));
    assert.equal(sh(f.dir, 'status', '--porcelain'), '');
  }
});

// What counts as missing or invalid is a pure table (runs.test.ts: budgetOf, timeoutOf; checks.test.ts: checkTimeoutOf); here, one full run each.
test('a factory.json with no timeoutMinutes, checkTimeoutMinutes or budgetUsd is an error before anything is read or moved; the old place of budgetUsd outside project is not read', async () => {
  for (const [name, make] of [
    ['timeoutMinutes', withProject('timeoutMinutes', { builder: 5 })],
    ['checkTimeoutMinutes', withProject('checkTimeoutMinutes', undefined)],
    ['budgetUsd', () => ({ ...withProject('budgetUsd', undefined)(), budgetUsd: { builder: 3, reviewer: 1 } }) as unknown as Factory],
  ] as const) {
    const f = setup([]);
    const deps: Deps = { ...f.deps, factory: make };
    await assert.rejects(() => runTicket(7, deps), new RegExp(`factory\\.json has no project\\.${name}`), name);
    assert.deepEqual(f.ghCalls(), [], name);
    assert.deepEqual(f.claudeCalls(), [], name);
  }
});

// What claude prints at the usage limit: a result whose api_error is usage_limit_reached, with the time the limit resets.
const RESET = '2026-11-03T18:30:00.000Z';
const limitStream = (cost: number, turns: number) => [
  JSON.stringify({ type: 'system', subtype: 'init', session_id: 's' }),
  JSON.stringify({ type: 'result', subtype: 'success', is_error: true, api_error: 'usage_limit_reached', resetsAt: Date.parse(RESET) / 1000, total_cost_usd: cost, num_turns: turns, session_id: 's' }),
].join('\n') + '\n';

test('an agent that hits the usage limit pauses the ticket in round 2 too: the round is kept, the card stays in Review, one comment with the reset time and the cost so far', async () => {
  const f = setup([
    { agent: 'builder', ...built('a.txt'), stdout: stream(builder, 1, 5) },
    { agent: 'reviewer', stdout: stream({ verdict: 'FAIL', report: 'VERDICT: FAIL\nFor the Builder: fix 1' }, 0.5, 3) },
    { agent: 'builder', ...built('b.txt'), stdout: stream(builder, 1, 5) },
    { agent: 'reviewer', stdout: limitStream(0.25, 2), code: 1 },
  ]);
  const out = await runTicket(7, f.deps);

  assert.deepEqual([out.ok, out.merged, out.paused, out.rounds, out.stoppedAt], [false, false, true, 2, 'review']);
  assert.deepEqual(moves(f.ghCalls()), ['Build', 'Verify', 'Review', 'Build', 'Verify', 'Review']);
  assert.equal(f.claudeCalls().length, 4, 'no round spent, no agent after the limit');
  assert.deepEqual(branches(f.dir), ['ticket/7-run-one-ticket']);
  const comments: string[] = f.issue().comments;
  assert.equal(comments.length, 1);
  assert.match(comments[0], /^run · paused\nPaused at: review\nRounds: 2\/2 /);
  assert.ok(comments[0].split('\n').includes(`Resets at: ${RESET}`));
  assert.ok(comments[0].split('\n').includes('Cost so far: 2.7500 USD in 15 turns (4 agent runs)'));
  assert.match(comments[0], /"api_error":"usage_limit_reached"/);
  assert.match(comments[0], /\.claude\/worktrees\/logs\/7\/attempt-1\/reviewer-2\.jsonl/);
  const notes = jsonl(join(logs(f.dir), 'steps.jsonl'));
  assert.equal(notes.at(-1).step, 'paused');
  assert.ok(!notes.some((n) => n.column === 'Needs Human'));
});

test('an agent that hits the usage limit in round 1 pauses the ticket: its card stays in Build, the Builder is not tried again', async () => {
  const f = setup([{ agent: 'builder', stdout: limitStream(0.4, 1), code: 1 }]);
  const out = await runTicket(7, f.deps);

  assert.deepEqual([out.ok, out.merged, out.paused, out.rounds, out.stoppedAt], [false, false, true, 1, 'build']);
  assert.deepEqual(moves(f.ghCalls()), ['Build']);
  assert.equal(f.claudeCalls().length, 1);
  // A pause keeps the file, with the reset time, for the run that goes on.
  assert.deepEqual([readHold(f.dir).round, readHold(f.dir).phase, readHold(f.dir).pid, readHold(f.dir).resetsAt], [1, 'build', process.pid, RESET]);
  const comments: string[] = f.issue().comments;
  assert.equal(comments.length, 1);
  assert.ok(comments[0].split('\n').includes(`Resets at: ${RESET}`));
  assert.ok(comments[0].split('\n').includes('Cost so far: 0.4000 USD in 1 turns (1 agent runs)'));
});

test('any other unknown end of an agent sends the ticket to Needs Human with its reason: no pause, no second try', async () => {
  const other = JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, total_cost_usd: 0.2, num_turns: 1 }) + '\n';
  for (const [name, answers, stage, who] of [
    ['builder', [{ agent: 'builder', stderr: 'boom\n', code: 1 }], 'build', 'Builder'],
    ['reviewer', [
      { agent: 'builder', ...built('t.txt'), stdout: stream(builder, 1, 5) },
      { agent: 'reviewer', stdout: other, code: 1 },
    ], 'review', 'reviewer'],
  ] as const) {
    const f = setup([...answers]);
    const out = await runTicket(7, f.deps);

    assert.deepEqual([out.ok, out.merged, out.paused, out.rounds, out.stoppedAt], [false, false, undefined, 1, stage], name);
    assert.match(String(out.reason), new RegExp(`^the ${who} ended in a way dynamo does not know: `), name);
    assert.equal(moves(f.ghCalls()).at(-1), 'Needs Human', name);
    assert.equal(f.claudeCalls().length, answers.length, `${name}: not tried again`);
    const comments: string[] = f.issue().comments;
    assert.equal(comments.length, 1);
    assert.match(comments[0], /^run · not merged\n/, name);
    assert.match(comments[0], new RegExp(`Reason: the ${who} ended in a way dynamo does not know: `), name);
  }
});

// The working branch moves while the ticket is built: another ticket adds c.txt in the main folder, as a merge would.
function moveBase(dir: string): void {
  writeFileSync(join(dir, 'c.txt'), 'from the base');
  sh(dir, 'add', 'c.txt');
  sh(dir, 'commit', '-q', '-m', 'C');
}

// The Builder of a round that has to bring the base in: it merges it in its copy and keeps its own side of the conflict.
function bringBaseIn(cwd: string): void {
  git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'merge', BASE], { cwd });
  sh(cwd, 'checkout', '--ours', 'c.txt');
  sh(cwd, 'add', 'c.txt');
  sh(cwd, 'commit', '-q', '-m', `Merge ${BASE} into the ticket branch (#7)`);
}

test('a conflict at the merge is one more Builder round in the same copy, then Verify, Review and the merge again', async () => {
  const f = setup([
    { agent: 'builder', ...built('c.txt'), stdout: stream(builder, 1, 5) },
    { agent: 'reviewer', stdout: stream({ verdict: 'PASS', report: 'VERDICT: PASS' }, 0.5, 2) },
    { agent: 'builder', stdout: stream(builder, 1, 4) },
    { agent: 'reviewer', stdout: stream({ verdict: 'PASS', report: 'VERDICT: PASS again' }, 0.5, 2) },
  ]);
  let reviews = 0;
  let builds = 0;
  const inner = f.deps.agent!;
  const deps: Deps = {
    ...f.deps,
    agent: (r, o) => {
      if (r.agent === 'reviewer' && ++reviews === 1) moveBase(f.dir);
      if (r.agent === 'builder' && ++builds === 2) bringBaseIn(r.cwd);
      return inner(r, o);
    },
  };

  const out = await runTicket(7, deps);

  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.merged, true);
  assert.equal(out.rounds, 2);
  assert.deepEqual(moves(f.ghCalls()), ['Build', 'Verify', 'Review', 'Merge', 'Build', 'Verify', 'Review', 'Merge', 'Done']);
  assert.deepEqual(branches(f.dir), ['ticket/7-run-one-ticket']);
  const calls = f.claudeCalls();
  assert.equal(new Set(calls.map((c) => realpathSync(c.cwd))).size, 1, 'the same copy');
  assert.match(calls[2].stdin, /Round 2 of 2[\s\S]*What failed in round 1, word for word:\n[\s\S]*conflict with the base[\s\S]*c\.txt/);
  assert.match(calls[3].stdin, /Your previous verdict, word for word:\nVERDICT: PASS/);
  assert.equal(readFileSync(join(f.dir, 'c.txt'), 'utf8'), 'c.txt');
  assert.equal(sh(f.dir, 'log', '-1', '--format=%s'), `Merge ticket/7-run-one-ticket into ${BASE} (#7)`);
  assert.deepEqual(f.issue().labels, ['in-release']);
  assert.equal(f.issue().comments.length, 1);
  assert.ok(f.issue().comments[0].split('\n').includes('Rounds: 2/2'));
});

test('a conflict at the merge in the last round sends the ticket to Needs Human, stopped at merge, with the working branch where it was', async () => {
  const fail = { verdict: 'FAIL', report: 'VERDICT: FAIL\nFor the Builder: fix it' };
  const f = setup([
    { agent: 'builder', ...built('c.txt'), stdout: stream(builder, 1, 5) },
    { agent: 'reviewer', stdout: stream(fail, 0.5, 2) },
    { agent: 'builder', ...built('d.txt'), stdout: stream(builder, 1, 4) },
    { agent: 'reviewer', stdout: stream({ verdict: 'PASS', report: 'VERDICT: PASS' }, 0.5, 2) },
  ]);
  let reviews = 0;
  const inner = f.deps.agent!;
  const deps: Deps = { ...f.deps, agent: (r, o) => { if (r.agent === 'reviewer' && ++reviews === 2) moveBase(f.dir); return inner(r, o); } };

  const out = await runTicket(7, deps);
  const after = sh(f.dir, 'rev-parse', 'HEAD');

  assert.equal(out.ok, false);
  assert.equal(out.merged, false);
  assert.equal(out.rounds, 2);
  assert.equal(out.stoppedAt, 'merge');
  assert.match(String(out.reason), /conflicts with release\/1\.0\.0 in c\.txt/);
  assert.deepEqual(moves(f.ghCalls()), ['Build', 'Verify', 'Review', 'Build', 'Verify', 'Review', 'Merge', 'Needs Human']);
  assert.equal(sh(f.dir, 'log', '-1', '--format=%s'), 'C');
  assert.equal(sh(f.dir, 'rev-parse', 'HEAD'), after);
  assert.equal(f.claudeCalls().length, 4, 'no third Builder round');
  assert.deepEqual(f.issue().labels, []);
});

// The file that says the ticket is held by a run (holds.ts): what it holds while each agent runs, and that it is gone at the end.
const held = (dir: string) => join(dir, '.claude', 'worktrees', 'runs', '7.json');
const readHold = (dir: string) => (existsSync(held(dir)) ? JSON.parse(readFileSync(held(dir), 'utf8')) : null);

test('while a ticket runs its file has the pid, start time, round, phase and conversations, follows them, and is gone once it is merged', async () => {
  const fail = { verdict: 'FAIL', report: 'VERDICT: FAIL\nFor the Builder: fix 1' };
  const f = setup([
    { agent: 'builder', ...built('one.txt'), stdout: stream(builder, 1, 5) },
    { agent: 'reviewer', stdout: stream(fail, 0.5, 2) },
    { agent: 'builder', ...built('two.txt'), stdout: stream(builder, 1, 5) },
    { agent: 'reviewer', stdout: stream({ verdict: 'PASS', report: 'VERDICT: PASS' }, 0.5, 2) },
  ]);
  // What the file says while each agent runs, and the session each was given.
  const seen: { agent: string; hold: Record<string, unknown>; session: string }[] = [];
  const deps: Deps = { ...f.deps, agent: (r, o) => {
    seen.push({ agent: r.agent, hold: readHold(f.dir), session: r.session });
    return f.deps.agent!(r, o);
  } };

  const out = await runTicket(7, deps);

  assert.equal(out.merged, true, JSON.stringify(out));
  assert.deepEqual(seen.map((s) => [s.agent, s.hold.round, s.hold.phase]), [['builder', 1, 'build'], ['reviewer', 1, 'review'], ['builder', 2, 'build'], ['reviewer', 2, 'review']]);
  for (const s of seen) {
    assert.equal(s.hold.pid, process.pid);
    assert.ok(!Number.isNaN(Date.parse(String(s.hold.startedAt))));
    assert.equal((s.hold.sessions as Record<string, string>)[s.agent], s.session);
  }
  assert.equal(new Set(seen.map((s) => s.hold.startedAt)).size, 1);
  assert.deepEqual(seen[1].hold.sessions, { builder: seen[0].session, reviewer: seen[1].session });
  assert.equal(readHold(f.dir), null);
});

test('the files of the runs are ignored by git', () => {
  const r = git(['check-ignore', '.claude/worktrees/runs/1.json'], { cwd: join(import.meta.dirname, '..', '..') });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trim(), '.claude/worktrees/runs/1.json');
});

// --- A ticket half done by a run that died goes on from the phase of its file (resumes.ts).
const ghWrites = (calls: string[][]) => calls.filter((c) => (c[0] === 'issue' && (c[1] === 'edit' || c[1] === 'comment')) || (c[0] === 'project' && c[1] === 'item-edit'));
const PASSED = { verdict: 'PASS', report: 'VERDICT: PASS' };
// The pid of a process that has ended: the run that died.
const deadPid = (): number => Number(spawnSync(process.execPath, ['-e', '']).pid);
// The file of the ticket as the run that died left it: the same, with that run's pid, and with the usage limit reset by the time
// a run goes on (before it, the ticket is not started: see `diesAt`).
function dies(dir: string): void {
  writeFileSync(held(dir), `${JSON.stringify({ ...readHold(dir), pid: deadPid(), resetsAt: null })}\n`);
}
const copiesOf = (dir: string) => sh(dir, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).slice(1);

test('a ticket held by a live run is refused with «#7 is held by the run of pid N since T»: nothing is moved or started', async () => {
  const f = setup([]);
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  try {
    const since = '2026-11-03T10:00:00.000Z';
    mkdirSync(join(f.dir, '.claude', 'worktrees', 'runs'), { recursive: true });
    writeFileSync(join(f.dir, '.claude', 'worktrees', 'run.json'), JSON.stringify({ pid: child.pid, since, heartbeat: new Date().toISOString() }));
    writeHold(f.dir, 7, { pid: Number(child.pid), startedAt: since, round: 1, phase: 'review', sessions: { builder: null, reviewer: null }, failed: null, spent: [], builder: null, review: null, checks: null, resetsAt: null, stopped: false });

    const out = await runTicket(7, f.deps);

    assert.deepEqual([out.ok, out.started, out.why], [false, false, `#7 is held by the run of pid ${child.pid} since ${since}`]);
    assert.deepEqual(f.ghCalls(), []);
    assert.deepEqual(f.claudeCalls(), []);
    assert.equal(readHold(f.dir).pid, child.pid, 'its file is untouched');
  } finally {
    child.kill();
  }
});

test('a dead run\'s ticket in its Review phase reuses its branch and copy: Verify again, the reviewer from the start, the merge', async () => {
  const f = setup([
    { agent: 'builder', ...built('built.txt'), stdout: stream(builder, 1, 5) },
    { agent: 'reviewer', stdout: limitStream(0.25, 2), code: 1 },
    { agent: 'reviewer', stdout: stream(PASSED, 0.5, 3) },
  ]);
  const first = await runTicket(7, f.deps);
  assert.equal(first.paused, true, JSON.stringify(first));
  const copy = copiesOf(f.dir);
  assert.equal(readHold(f.dir).phase, 'review');
  dies(f.dir);
  f.at('Review');

  const out = await runTicket(7, f.deps);

  assert.equal(out.merged, true, JSON.stringify(out));
  assert.deepEqual([out.rounds, out.cost, out.turns], [1, 1.75, 10], 'the cost of both runs');
  assert.deepEqual(branches(f.dir), ['ticket/7-run-one-ticket']);
  assert.equal(copy.length, 1);
  assert.deepEqual(copiesOf(f.dir), copy, 'the same copy');
  // One Builder in all; the reviewer twice, the second from the start with the check that Verify ran again in its prompt.
  const calls = f.claudeCalls();
  assert.deepEqual(calls.map((c) => c.agent), ['builder', 'reviewer', 'reviewer']);
  assert.equal(calls[1].cwd, calls[2].cwd);
  assert.match(calls[2].stdin, /node pass\.js → exit 0/);
  assert.deepEqual(moves(f.ghCalls()), ['Build', 'Verify', 'Review', 'Verify', 'Review', 'Merge', 'Done']);
  assert.equal(readHold(f.dir), null);
  assert.match(sh(f.dir, 'log', '-1', '--format=%s'), /^Merge ticket\/7-run-one-ticket into release\/1\.0\.0 \(#7\)$/);
  const comments: string[] = f.issue().comments;
  assert.equal(comments.length, 2);
  assert.match(comments[1], /^run · PASS and merged into release\/1\.0\.0\n/);
  assert.match(comments[1], /Cost: 1\.7500 USD \(the sum of total_cost_usd of 3 agent runs\)/);
  assert.ok(jsonl(join(logs(f.dir), 'steps.jsonl')).some((n) => n.step === 'resumed'));
});

test('a ticket stopped at merge keeps its copy, branch and file; relaunched, it runs only the merge: no Builder, no Reviewer', async () => {
  const f = setup([
    { agent: 'builder', ...built('built.txt'), stdout: stream(builder, 1, 5) },
    { agent: 'reviewer', stdout: stream(PASSED, 0.5, 2) },
  ], [], ['node pass.js', 'node only-at-merge.js']);
  const inner = f.deps.agent!;
  // The working branch moves after the review, so the merge runs the checks, and one fails there.
  f.deps.agent = async (r, o) => {
    const done = await inner(r, o);
    if (r.agent === 'reviewer') {
      writeFileSync(join(f.dir, 'other.txt'), 'another ticket');
      sh(f.dir, 'add', 'other.txt');
      sh(f.dir, 'commit', '-q', '-m', 'another ticket merged');
    }
    return done;
  };

  const first = await runTicket(7, f.deps);

  assert.equal(first.stoppedAt, 'merge', JSON.stringify(first));
  assert.deepEqual(branches(f.dir), ['ticket/7-run-one-ticket'], 'its branch is kept');
  const copy = copiesOf(f.dir);
  assert.equal(copy.length, 1, 'its copy is kept');
  assert.deepEqual([readHold(f.dir).phase, readHold(f.dir).round], ['merge', 1], 'the file of its stop is kept');
  const comment: string = f.issue().comments[0];
  assert.match(comment, /\nTo relaunch: /);
  assert.doesNotMatch(comment, /git worktree remove|git branch -D/);
  assert.match(comment, /\/dynamo:autopilot 7/);

  // The human fixes what stopped the merge (here, the check that failed there) and launches the ticket again.
  const calls = f.claudeCalls().length;
  f.deps.agent = inner;
  f.deps.factory = () => ({ ...factory, project: { ...factory.project, checks: ['node pass.js'] } }) as Factory;
  dies(f.dir);
  const before = f.ghCalls().length;
  const out = await runTicket(7, f.deps);

  assert.equal(out.merged, true, JSON.stringify(out));
  assert.equal(f.claudeCalls().length, calls, 'no Builder and no Reviewer is started');
  assert.deepEqual(moves(f.ghCalls().slice(before)), ['Merge', 'Done']);
  assert.deepEqual(branches(f.dir), ['ticket/7-run-one-ticket']);
  assert.deepEqual(copiesOf(f.dir), copy, 'the same copy');
  assert.equal(readHold(f.dir), null);
  assert.ok(jsonl(join(logs(f.dir), 'steps.jsonl')).some((n) => n.step === 'resumed'));
});

test('a ticket stopped at merge whose copy and branch the human removed starts anew: round 1, a new copy, a new attempt; its kept file is ignored', async () => {
  const f = setup([
    { agent: 'builder', ...built('built.txt'), stdout: stream(builder, 1, 5) },
    { agent: 'reviewer', stdout: stream(PASSED, 0.5, 2) },
    { agent: 'builder', ...built('again.txt'), stdout: stream(builder, 2, 6) },
    { agent: 'reviewer', stdout: stream(PASSED, 0.25, 3) },
  ], [], ['node pass.js', 'node only-at-merge.js']);
  const inner = f.deps.agent!;
  f.deps.agent = async (r, o) => {
    const done = await inner(r, o);
    if (r.agent === 'reviewer') {
      writeFileSync(join(f.dir, 'other.txt'), 'another ticket');
      sh(f.dir, 'add', 'other.txt');
      sh(f.dir, 'commit', '-q', '-m', 'another ticket merged');
    }
    return done;
  };
  assert.equal((await runTicket(7, f.deps)).stoppedAt, 'merge');
  assert.ok(readHold(f.dir) !== null, 'its file is kept');

  // The human removes the copy and the branch, as to start from zero, and launches the ticket again.
  sh(f.dir, 'worktree', 'remove', '--force', copiesOf(f.dir)[0].slice('worktree '.length));
  for (const b of branches(f.dir)) sh(f.dir, 'branch', '-D', b);
  f.deps.agent = inner;
  f.deps.factory = () => ({ ...factory, project: { ...factory.project, checks: ['node pass.js'] } }) as Factory;
  dies(f.dir);
  const calls = f.claudeCalls().length, before = f.ghCalls().length;
  const out = await runTicket(7, f.deps);

  assert.equal(out.merged, true, JSON.stringify(out));
  assert.equal(out.rounds, 1);
  assert.equal(out.logs, '.claude/worktrees/logs/7/attempt-2');
  const agents = f.claudeCalls().slice(calls);
  assert.deepEqual(agents.map((c) => c.agent), ['builder', 'reviewer'], 'a new Builder and a new Reviewer');
  assert.equal(flag(agents[0], '--resume'), undefined, 'the Builder is new: nothing of the stopped one is resumed');
  assert.match(agents[0].stdin, /Round 1 of 2/);
  assert.deepEqual(moves(f.ghCalls().slice(before)), ['Build', 'Verify', 'Review', 'Merge', 'Done']);
  assert.equal(readFileSync(join(f.dir, 'again.txt'), 'utf8'), 'again.txt', 'the new Builder\'s work is what is merged');
  assert.equal(readHold(f.dir), null);
  assert.ok(!jsonl(join(logs(f.dir, 2), 'steps.jsonl')).some((n) => n.step === 'resumed'));
});

test('a dead run\'s ticket in its Builder phase resumes the Builder\'s conversation by the id in its file, told to go on where it left it', async () => {
  const fail = { verdict: 'FAIL', report: 'VERDICT: FAIL\nFor the Builder: fix 1' };
  const f = setup([
    { agent: 'builder', ...built('one.txt'), stdout: stream(builder, 1, 5) },
    { agent: 'reviewer', stdout: stream(fail, 0.5, 2) },
    { agent: 'builder', stdout: limitStream(0.4, 1), code: 1 },
    { agent: 'builder', ...built('two.txt'), stdout: stream(builder, 1, 5) },
    { agent: 'reviewer', stdout: stream(PASSED, 0.5, 2) },
  ]);
  assert.equal((await runTicket(7, f.deps)).paused, true);
  assert.deepEqual([readHold(f.dir).round, readHold(f.dir).phase], [2, 'build']);
  const id = readHold(f.dir).sessions.builder;
  assert.ok(typeof id === 'string' && id !== '');
  const copy = copiesOf(f.dir);
  dies(f.dir);
  f.at('Build');

  const out = await runTicket(7, f.deps);

  assert.equal(out.merged, true, JSON.stringify(out));
  assert.equal(out.rounds, 2);
  assert.deepEqual(copiesOf(f.dir), copy);
  const builders = f.claudeCalls().filter((c) => c.agent === 'builder');
  assert.equal(builders.length, 3, 'one Builder resumed, no new one');
  assert.equal(builders[1].cwd, builders[2].cwd, 'the same copy');
  assert.equal(flag(builders[2], '--resume'), id, 'the id of the ticket\'s file');
  assert.equal(flag(builders[2], '--session-id'), undefined);
  assert.match(builders[2].stdin, /Go on where you left it/);
  assert.doesNotMatch(builders[2].stdin, /Round 2 of 2/, 'its conversation already has the ticket');
  assert.equal(flag(builders[1], '--resume'), undefined, 'the first Builder of the round is new');
  assert.equal(readFileSync(join(f.dir, 'two.txt'), 'utf8'), 'two.txt');
});

test('a dead run\'s ticket in its Builder phase whose resume fails gets a new Builder on the same copy, told it was cut off and, in round 2, what failed', async () => {
  const fail = { verdict: 'FAIL', report: 'VERDICT: FAIL\nFor the Builder: fix 1' };
  const f = setup([
    { agent: 'builder', ...built('one.txt'), stdout: stream(builder, 1, 5) },
    { agent: 'reviewer', stdout: stream(fail, 0.5, 2) },
    { agent: 'builder', stdout: limitStream(0.4, 1), code: 1 },
    { agent: 'builder', stderr: 'No conversation found with session ID', code: 1 },
    { agent: 'builder', ...built('two.txt'), stdout: stream(builder, 1, 5) },
    { agent: 'reviewer', stdout: stream(PASSED, 0.5, 2) },
  ]);
  assert.equal((await runTicket(7, f.deps)).paused, true);
  assert.deepEqual([readHold(f.dir).round, readHold(f.dir).phase], [2, 'build']);
  const id = readHold(f.dir).sessions.builder;
  const copy = copiesOf(f.dir);
  dies(f.dir);
  f.at('Build');

  const out = await runTicket(7, f.deps);

  assert.equal(out.merged, true, JSON.stringify(out));
  assert.equal(out.rounds, 2);
  assert.deepEqual(copiesOf(f.dir), copy);
  const builders = f.claudeCalls().filter((c) => c.agent === 'builder');
  assert.equal(builders.length, 4);
  assert.equal(flag(builders[2], '--resume'), id, 'it first tries to resume');
  assert.equal(flag(builders[3], '--resume'), undefined, 'then a new Builder');
  assert.notEqual(flag(builders[3], '--session-id'), id);
  assert.equal(builders[2].cwd, builders[3].cwd, 'the same copy');
  assert.match(builders[3].stdin, /Round 2 of 2/);
  assert.match(builders[3].stdin, /cut off/);
  assert.match(builders[3].stdin, /What failed in round 1, word for word:\nthe reviewer's verdict: VERDICT: FAIL\nFor the Builder: fix 1/);
  assert.doesNotMatch(builders[1].stdin, /cut off/);
  assert.equal(readFileSync(join(f.dir, 'two.txt'), 'utf8'), 'two.txt');
  assert.ok(jsonl(join(logs(f.dir), 'steps.jsonl')).some((n) => n.step === 'resume-failed'));
});

// The shape of the stream of a resumed agent first reports the background shell its previous session left, with a result
// of its own (0 turns, no cost, origin `task-notification`) that is not the agent's end.
const noticeLines = [
  JSON.stringify({ type: 'system', subtype: 'task_notification', session_id: 's', status: 'completed' }),
  JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0, num_turns: 0, session_id: 's', result: '', origin: { kind: 'task-notification' } }),
].join('\n') + '\n';

test('a resumed Builder whose stream starts with a task notification\'s result goes on with its real answer: no new Builder, then Verify, Review and the merge', async () => {
  const f = setup([
    { agent: 'builder', stdout: limitStream(0.4, 1), code: 1 },
    { agent: 'builder', ...built('one.txt'), stdout: stream(builder, 1, 5).replace('\n', `\n${noticeLines}`) },
    { agent: 'reviewer', stdout: stream(PASSED, 0.5, 2) },
  ]);
  assert.equal((await runTicket(7, f.deps)).paused, true);
  const id = readHold(f.dir).sessions.builder;
  assert.ok(typeof id === 'string' && id !== '');
  dies(f.dir);
  f.at('Build');

  const out = await runTicket(7, f.deps);

  assert.equal(out.merged, true, JSON.stringify(out));
  const builders = f.claudeCalls().filter((c) => c.agent === 'builder');
  assert.equal(builders.length, 2, 'one Builder resumed, no new one');
  assert.equal(flag(builders[1], '--resume'), id);
  assert.ok(!jsonl(join(logs(f.dir), 'steps.jsonl')).some((n) => n.step === 'resume-failed'), 'the resume did not fail');
  assert.deepEqual(moves(f.ghCalls()).slice(-4), ['Verify', 'Review', 'Merge', 'Done']);
  assert.equal(readFileSync(join(f.dir, 'one.txt'), 'utf8'), 'one.txt');
  // The turns and cost are the real result's (5 turns, 1 USD) and the reviewer's, plus the first run cut by the limit; the notification adds none.
  assert.deepEqual([out.cost, out.turns], [1.9, 8]);
  const agents = jsonl(join(logs(f.dir), 'steps.jsonl')).filter((n) => n.step === 'agent');
  assert.deepEqual(agents.map((n) => [n.ending, n.cost, n.turns]), [['limit', 0.4, 1], ['success', 1, 5], ['success', 0.5, 2]]);
});

test('a Builder whose only result is a task notification\'s is not a success: the ticket goes to Needs Human with the stream having no result', async () => {
  // A new Builder (a resumed one would first be followed by a new Builder, loop.ts, and end the same way if it answered the same).
  const f = setup([{ agent: 'builder', stdout: stream(builder, 1, 5).split('\n')[0] + `\n${noticeLines}` }]);

  const out = await runTicket(7, f.deps);

  assert.deepEqual([out.ok, out.merged, out.paused, out.stoppedAt], [false, false, undefined, 'build']);
  assert.match(String(out.reason), /^the Builder ended in a way dynamo does not know: the stream has no result line/);
  assert.equal(moves(f.ghCalls()).at(-1), 'Needs Human');
  assert.equal(f.claudeCalls().length, 1, 'no second try');
  const comments: string[] = f.issue().comments;
  assert.equal(comments.length, 1);
  assert.match(comments[0], /Reason: the Builder ended in a way dynamo does not know: the stream has no result line/);
});

test('the merge of a branch already in the base does only what is missing: the label, the card, the comment', async () => {
  const cases: { name: string; labels: string[]; column: string; comment: boolean; writes: string[] }[] = [
    { name: 'all missing', labels: [], column: 'Merge', comment: false, writes: ['issue edit', 'item-edit Done', 'issue comment'] },
    { name: 'label there', labels: ['in-release'], column: 'Merge', comment: false, writes: ['item-edit Done', 'issue comment'] },
    { name: 'label and comment there', labels: ['in-release'], column: 'Merge', comment: true, writes: ['item-edit Done'] },
    { name: 'comment there', labels: [], column: 'Merge', comment: true, writes: ['issue edit', 'item-edit Done'] },
  ];
  for (const c of cases) {
    const f = setup([
      { agent: 'builder', ...built('built.txt'), stdout: stream(builder, 1, 5) },
      { agent: 'reviewer', stdout: stream(PASSED, 0.5, 3) },
    ]);
    assert.equal((await runTicket(7, f.deps)).merged, true, c.name);
    // The run died after `dynamo merge` took the branch into the base and before the rest: what the board and the issue say now.
    writeHold(f.dir, 7, { pid: deadPid(), startedAt: '2026-11-03T10:00:00.000Z', round: 1, phase: 'merge', sessions: { builder: null, reviewer: null }, failed: null, spent: [{ cost: 1.5, turns: 8 }], builder: null, review: PASSED, checks: null, resetsAt: null, stopped: false });
    f.setIssue({ ...f.issue(), labels: c.labels, column: c.column, comments: c.comment ? ['run · PASS and merged into release/1.0.0\nCost: 0'] : [] });
    f.at(c.column);
    const before = [sh(f.dir, 'rev-parse', 'HEAD'), f.claudeCalls().length, f.ghCalls().length] as const;

    const out = await runTicket(7, f.deps);

    assert.equal(out.merged, true, `${c.name}: ${JSON.stringify(out)}`);
    assert.equal(sh(f.dir, 'rev-parse', 'HEAD'), before[0], `${c.name}: not merged again`);
    assert.equal(f.claudeCalls().length, before[1], `${c.name}: no agent`);
    const writes = ghWrites(f.ghCalls().slice(before[2])).map((w) => (w[0] === 'issue' ? `issue ${w[1]}` : `item-edit ${w[w.indexOf('--value') + 1]}`));
    assert.deepEqual(writes.sort(), [...c.writes].sort(), c.name);
    const after = f.issue();
    assert.deepEqual([after.labels, after.column, after.comments.filter((x: string) => x.startsWith('run · PASS and merged')).length], [['in-release'], 'Done', 1], c.name);
    assert.equal(readHold(f.dir), null, c.name);
  }
});

// --- The file keeps the reset time of the usage limit, and a run launched before it launches no agent (holds.ts, `limitUntil`).
const diesAt = (dir: string, resetsAt: string | null): void => writeFileSync(held(dir), `${JSON.stringify({ ...readHold(dir), pid: deadPid(), resetsAt })}\n`);

test('a run launched before the reset time launches no agent, moves no card and says when the limit resets', async () => {
  const f = setup([{ agent: 'builder', stdout: limitStream(0.4, 1), code: 1 }]);
  assert.equal((await runTicket(7, f.deps)).paused, true);
  const later = '2999-01-01T00:00:00.000Z';
  diesAt(f.dir, later);
  const before = [f.claudeCalls().length, f.ghCalls().length, copiesOf(f.dir), branches(f.dir)];

  const out = await runTicket(7, f.deps);

  assert.deepEqual([out.ok, out.started, out.merged], [false, false, undefined], JSON.stringify(out));
  assert.equal(out.resetsAt, later);
  assert.match(String(out.why), /^#7 paused by the usage limit, which resets at 2999-01-01T00:00:00\.000Z$/);
  assert.deepEqual([f.claudeCalls().length, f.ghCalls().length, copiesOf(f.dir), branches(f.dir)], before, 'no agent, no gh call, no copy');
  assert.equal(readHold(f.dir).resetsAt, later, 'its file is left as it was');
});

test('a run launched after the reset time goes on: the agents are launched and the ticket merges', async () => {
  const f = setup([
    { agent: 'builder', stdout: limitStream(0.4, 1), code: 1 },
    { agent: 'builder', ...built('x.txt'), stdout: stream(builder, 1, 5) },
    { agent: 'reviewer', stdout: stream(PASSED, 0.5, 2) },
  ]);
  assert.equal((await runTicket(7, f.deps)).paused, true);
  diesAt(f.dir, '2000-01-01T00:00:00.000Z');
  f.at('Build');

  const out = await runTicket(7, f.deps);

  assert.equal(out.merged, true, JSON.stringify(out));
  assert.deepEqual(f.claudeCalls().map((c) => c.agent), ['builder', 'builder', 'reviewer']);
  assert.equal(readHold(f.dir), null);
});

// --- An outage of the permission check while the Builder works: it is waited for and the same Builder goes on.

const outageLine = JSON.stringify({ type: 'system', subtype: 'permission_denied', decision_reason_type: 'classifier', decision_reason: 'Classifier unavailable' }) + '\n';
const gaveUp = { ...builder, needsHuman: true, needsHumanReason: 'every Bash call failed' };

test('a Builder that asks for the human during an outage goes on with its conversation after a wait: no round spent, then Verify, Review and the merge', async () => {
  const f = setup([
    { agent: 'builder', ...built('one.txt'), stdout: outageLine + stream(gaveUp, 1, 5) },
    { agent: 'builder', stdout: stream(builder, 0.5, 2) },
    { agent: 'reviewer', stdout: stream(PASSED, 0.5, 2) },
  ]);
  const waits: number[] = [];

  const out = await runTicket(7, { ...f.deps, wait: async (ms) => { waits.push(ms); } });

  assert.equal(out.merged, true, JSON.stringify(out));
  assert.equal(out.rounds, 1);
  assert.deepEqual(waits, [OUTAGE_WAIT_MS]);
  assert.equal(out.cost, 2, 'every run of the Builder is counted');
  const builders = f.claudeCalls().filter((c) => c.agent === 'builder');
  assert.equal(builders.length, 2);
  assert.equal(builders[0].cwd, builders[1].cwd, 'the same copy');
  assert.equal(flag(builders[1], '--resume'), flag(builders[0], '--session-id'), 'the same conversation');
  assert.match(builders[1].stdin, /permission check is back/);
  assert.ok(!moves(f.ghCalls()).includes('Needs Human'));
  assert.equal(jsonl(join(logs(f.dir), 'steps.jsonl')).filter((n) => n.step === 'outage').length, 1);
});

test('an outage that does not end stops the ticket after its tries, with the Builder\'s reason', async () => {
  const f = setup(Array.from({ length: OUTAGE_TRIES + 1 }, () => ({ agent: 'builder', stdout: outageLine + stream(gaveUp, 1, 5) })));
  const waits: number[] = [];

  const out = await runTicket(7, { ...f.deps, wait: async (ms) => { waits.push(ms); } });

  assert.equal(out.merged, false);
  assert.match(String(out.reason), /every Bash call failed/);
  assert.equal(waits.length, OUTAGE_TRIES);
  assert.equal(f.claudeCalls().filter((c) => c.agent === 'builder').length, OUTAGE_TRIES + 1);
  assert.ok(moves(f.ghCalls()).includes('Needs Human'));
});

test('a Builder that asks for the human with no outage is not waited for', async () => {
  const f = setup([{ agent: 'builder', stdout: stream(gaveUp, 1, 5) }]);
  const waits: number[] = [];

  const out = await runTicket(7, { ...f.deps, wait: async (ms) => { waits.push(ms); } });

  assert.equal(out.merged, false);
  assert.deepEqual(waits, []);
  assert.equal(f.claudeCalls().filter((c) => c.agent === 'builder').length, 1);
});

// The model and effort each call of an agent was launched with, as claude was given them.
const launched = (calls: Call[]) => calls.map((c) => [c.agent, flag(c, '--model'), flag(c, '--effort')]);

// The table of levels (low, medium, high, no Level: line, a project's own values) is proven in levels.test.ts.
test('a ticket that fails review keeps its level in its next round: both rounds launch with the values of that level', async () => {
  const fail = { verdict: 'FAIL', report: 'VERDICT: FAIL\nFor the Builder: fix 1' };
  const f = setup([
    { agent: 'builder', ...built('one.txt'), stdout: stream(builder, 1, 5) },
    { agent: 'reviewer', stdout: stream(fail, 0.5, 2) },
    { agent: 'builder', ...built('two.txt'), stdout: stream(builder, 1, 4) },
    { agent: 'reviewer', stdout: stream({ verdict: 'PASS', report: 'VERDICT: PASS' }, 0.5, 2) },
  ], [], undefined, { body: 'Level: low' });
  const out = await runTicket(7, f.deps);
  assert.equal(out.merged, true, JSON.stringify(out));
  assert.equal(out.rounds, 2);
  const calls = f.claudeCalls();
  assert.deepEqual(calls.map((c) => c.agent), ['builder', 'reviewer', 'builder', 'reviewer']);
  assert.deepEqual(launched(calls), [['builder', 'sonnet', 'low'], ['reviewer', 'sonnet', 'medium'], ['builder', 'sonnet', 'low'], ['reviewer', 'sonnet', 'medium']]);
});

// The reinforcement of a project's Builder: `.claude/dynamo/builder.md`, committed in the project (so every copy has it).
function reinforce(dir: string, text: string, agent: 'builder' | 'reviewer' = 'builder'): void {
  mkdirSync(join(dir, '.claude', 'dynamo'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'dynamo', `${agent}.md`), text);
  sh(dir, 'add', `.claude/dynamo/${agent}.md`);
  sh(dir, 'commit', '-q', '-m', `Reinforce the ${agent}`);
}
const agentsOf = (c: Call) => JSON.parse(flag(c, '--agents') ?? 'null');
const passing = [
  { agent: 'builder', ...built('built.txt'), stdout: stream(builder, 1, 2) },
  { agent: 'reviewer', stdout: stream({ verdict: 'PASS', report: 'VERDICT: PASS' }, 0.2, 1) },
];

// With a file for one agent, the other is launched with no --agents (also the case of no file at all); the merge of the file is in reinforce.test.ts.
test("with a reinforcement file the Builder gets Dynamo's tools plus the file's, and Dynamo's text, the heading and the file's rules; its model, effort and removed tools change nothing", async () => {
  const f = setup(passing, [], undefined, { body: 'Level: low' });
  reinforce(f.dir, '---\nmodel: opus\neffort: max\ndisallowedTools: Bash, Edit\ntools: mcp__browser__open, Agent(page-checker)\n---\nCheck the page in the browser.\n');
  const out = await runTicket(7, f.deps);
  assert.equal(out.merged, true, JSON.stringify(out));
  const [b, r] = f.claudeCalls();
  assert.deepEqual([flag(b, '--model'), flag(b, '--effort')], ['sonnet', 'low']);
  assert.deepEqual(Object.keys(agentsOf(b)['dynamo:builder']).sort(), ['description', 'prompt', 'tools']);
  assert.ok(agentsOf(b)['dynamo:builder'].tools.includes('Bash') && agentsOf(b)['dynamo:builder'].tools.includes('Edit'));
  const own = readFileSync(join(import.meta.dirname, '..', '..', 'agents', 'builder.md'), 'utf8').replace(/\r/g, '');
  const [, front, ...rest] = own.split(/^---$/m);
  const tools = /^tools:(.*)$/m.exec(front)?.[1].split(',').map((t) => t.trim());
  const agent = agentsOf(b)['dynamo:builder'];
  assert.deepEqual(agent.tools, [...(tools ?? []), 'mcp__browser__open', 'Agent(page-checker)']);
  assert.ok(agent.prompt.startsWith(rest.join('---').slice(1).trimEnd()), "Dynamo's text comes first");
  assert.ok(agent.prompt.endsWith('\n\n## Rules of this project: they add to the rules above, never override them\n\nCheck the page in the browser.\n'));
  assert.equal(flag(b, '--agent'), 'dynamo:builder');
  assert.equal(flag(b, '--mcp-config'), undefined);
  assert.equal(flag(r, '--agents'), undefined, 'the Reviewer has no file of its own here');
});

test("with a reinforcement file the Reviewer gets Dynamo's tools plus the file's, and Dynamo's text, the heading and the file's rules", async () => {
  const f = setup(passing);
  reinforce(f.dir, '---\ntools: mcp__browser__open, Agent(page-checker)\n---\nLook at the page in the browser.\n', 'reviewer');
  const out = await runTicket(7, f.deps);
  assert.equal(out.merged, true, JSON.stringify(out));
  const [b, r] = f.claudeCalls();
  assert.equal(flag(b, '--agents'), undefined, 'the Builder has no file of its own here');
  const own = readFileSync(join(import.meta.dirname, '..', '..', 'agents', 'reviewer.md'), 'utf8').replace(/\r/g, '');
  const [, front, ...rest] = own.split(/^---$/m);
  const tools = /^tools:(.*)$/m.exec(front)?.[1].split(',').map((t) => t.trim());
  const agent = agentsOf(r)['dynamo:reviewer'];
  assert.deepEqual(agent.tools, [...(tools ?? []), 'mcp__browser__open', 'Agent(page-checker)']);
  assert.ok(agent.prompt.startsWith(rest.join('---').slice(1).trimEnd()), "Dynamo's text comes first");
  assert.ok(agent.prompt.endsWith('\n\n## Rules of this project: they add to the rules above, never override them\n\nLook at the page in the browser.\n'));
  assert.equal(flag(r, '--agent'), 'dynamo:reviewer');
});

test('a Reviewer reinforcement that asks for Write stops the run with its reason and launches no agent', async () => {
  const f = setup(passing);
  reinforce(f.dir, '---\ntools: mcp__browser__open, Write\n---\nRules.\n', 'reviewer');
  const out = await runTicket(7, f.deps);
  assert.equal(out.merged, false);
  assert.match(String(out.reason), /reviewer\.md asks for Write.*must not change what it judges/);
  assert.deepEqual(f.claudeCalls(), []);
  assert.deepEqual(moves(f.ghCalls()), ['Build', 'Needs Human']);
});

// --- A Builder that asked the human goes on with the answer (a stop that keeps its conversation).
const asks = { ...builder, needsHuman: true, needsHumanReason: 'which of the two options?' };

test('a Builder that asks the human keeps its conversation, copy and branch; relaunched, it is resumed with the comments written after the notice', async () => {
  const f = setup([
    { agent: 'builder', ...built('one.txt'), stdout: stream(asks, 1, 3) },
    { agent: 'builder', ...built('two.txt'), stdout: stream(builder, 1, 5) },
    { agent: 'reviewer', stdout: stream(PASSED, 0.5, 2) },
  ]);
  f.setIssue({ ...f.issue(), comments: ['an old comment, before the run'] });

  const first = await runTicket(7, f.deps);

  assert.equal(first.stoppedAt, 'build', JSON.stringify(first));
  assert.deepEqual(branches(f.dir), ['ticket/7-run-one-ticket'], 'its branch is kept');
  const copy = copiesOf(f.dir);
  assert.equal(copy.length, 1, 'its copy is kept');
  const id = readHold(f.dir).sessions.builder;
  assert.ok(typeof id === 'string' && id !== '', 'the file of its stop keeps the id of its conversation');
  assert.equal(f.issue().column, 'Needs Human');
  const notice: string = f.issue().comments[1];
  assert.match(notice, /^run · not merged\n/);
  assert.match(notice, /\nTo relaunch: /);
  assert.doesNotMatch(notice, /git worktree remove|git branch -D|remove what/);
  assert.match(notice, /\/dynamo:autopilot 7/);

  // The human answers in a comment and launches the ticket again.
  f.setIssue({ ...f.issue(), comments: [...f.issue().comments, 'Take the second option.', 'And keep it small.'] });
  dies(f.dir);
  const out = await runTicket(7, f.deps);

  assert.equal(out.merged, true, JSON.stringify(out));
  assert.deepEqual(copiesOf(f.dir), copy, 'the same copy');
  const builders = f.claudeCalls().filter((c) => c.agent === 'builder');
  assert.equal(builders.length, 2, 'one Builder resumed, no new one');
  assert.equal(flag(builders[1], '--resume'), id, 'the conversation it asked in');
  assert.equal(flag(builders[1], '--session-id'), undefined);
  assert.match(builders[1].stdin, /Take the second option\./);
  assert.match(builders[1].stdin, /And keep it small\./);
  assert.doesNotMatch(builders[1].stdin, /an old comment|Reason: /, 'only what was written after the notice');
  assert.equal(readFileSync(join(f.dir, 'two.txt'), 'utf8'), 'two.txt');
  assert.equal(readHold(f.dir), null, 'the ticket ended');
});

test('a Builder that asked, whose conversation cannot be resumed, gets a new Builder on the same copy with the comments written after the notice', async () => {
  const f = setup([
    { agent: 'builder', ...built('one.txt'), stdout: stream(asks, 1, 3) },
    { agent: 'builder', stdout: 'no stream here\n', code: 1 },
    { agent: 'builder', ...built('two.txt'), stdout: stream(builder, 1, 5) },
    { agent: 'reviewer', stdout: stream(PASSED, 0.5, 2) },
  ]);
  await runTicket(7, f.deps);
  const id = readHold(f.dir).sessions.builder;
  f.setIssue({ ...f.issue(), comments: [...f.issue().comments, 'Take the second option.'] });
  dies(f.dir);

  const out = await runTicket(7, f.deps);

  assert.equal(out.merged, true, JSON.stringify(out));
  const builders = f.claudeCalls().filter((c) => c.agent === 'builder');
  assert.equal(flag(builders[1], '--resume'), id, 'it first tries to resume');
  assert.equal(flag(builders[2], '--resume'), undefined, 'then a new Builder');
  assert.equal(builders[1].cwd, builders[2].cwd, 'on the same copy');
  assert.match(builders[2].stdin, /Take the second option\./);
});

test('a Builder stopped by anything but its question or a kept stop does not keep its conversation: the copy is cleaned and the file removed as before', async () => {
  const f = setup([{ agent: 'builder', ...built('one.txt'), touch: 'scratch.txt', stdout: stream({}, 1, 5) }]);
  const out = await runTicket(7, f.deps);
  assert.equal(out.stoppedAt, 'build', JSON.stringify(out));
  assert.equal(readHold(f.dir), null);
  assert.match(f.issue().comments[0], /git worktree remove.*git branch -D/s);
});

// --- A Builder goes on after the Reviewer's last failure (a stop that keeps its conversation).
test('a ticket the Reviewer fails in the last round keeps its Builder\'s conversation; relaunched, the Builder is resumed with the failure and the comments written after the notice', async () => {
  const fail = (n: number) => ({ verdict: 'FAIL', report: `VERDICT: FAIL\nFor the Builder: fix ${n}` });
  const f = setup([
    { agent: 'builder', ...built('one.txt'), stdout: stream(builder, 1, 5) },
    { agent: 'reviewer', stdout: stream(fail(1), 0.5, 2) },
    { agent: 'builder', ...built('two.txt'), stdout: stream(builder, 1, 4) },
    { agent: 'reviewer', stdout: stream(fail(2), 0.5, 2) },
    { agent: 'builder', ...built('three.txt'), stdout: stream(builder, 1, 3) },
    { agent: 'reviewer', stdout: stream(PASSED, 0.5, 2) },
  ]);
  f.setIssue({ ...f.issue(), comments: ['an old comment, before the run'] });

  const first = await runTicket(7, f.deps);

  assert.equal(first.stoppedAt, 'review', JSON.stringify(first));
  assert.deepEqual(branches(f.dir), ['ticket/7-run-one-ticket'], 'its branch is kept');
  const copy = copiesOf(f.dir);
  assert.equal(copy.length, 1, 'its copy is kept');
  const id = readHold(f.dir).sessions.builder;
  assert.ok(typeof id === 'string' && id !== '', 'the file of its stop keeps the id of the Builder\'s conversation');
  assert.equal(f.issue().column, 'Needs Human');
  const notice: string = f.issue().comments[1];
  assert.match(notice, /\nTo relaunch: /);
  assert.doesNotMatch(notice, /git worktree remove|git branch -D|remove what/);
  assert.match(notice, /\/dynamo:autopilot 7/);

  f.setIssue({ ...f.issue(), comments: [...f.issue().comments, 'The second point is a false alarm.'] });
  dies(f.dir);
  const out = await runTicket(7, f.deps);

  assert.equal(out.merged, true, JSON.stringify(out));
  assert.deepEqual(copiesOf(f.dir), copy, 'the same copy');
  const builders = f.claudeCalls().filter((c) => c.agent === 'builder');
  assert.equal(builders.length, 3, 'one Builder resumed, no new one');
  assert.equal(flag(builders[2], '--resume'), id, 'the conversation of the last round');
  assert.equal(flag(builders[2], '--session-id'), undefined);
  assert.match(builders[2].stdin, /VERDICT: FAIL\nFor the Builder: fix 2/);
  assert.match(builders[2].stdin, /The second point is a false alarm\./);
  assert.doesNotMatch(builders[2].stdin, /an old comment|fix 1/, 'only the last failure and what was written after the notice');
  assert.equal(readHold(f.dir), null, 'the ticket ended');
});

// --- A Builder goes on after the check's last failure (a stop that keeps its conversation).
test('a check failed in the last round keeps the Builder\'s conversation; relaunched, the Builder is resumed with the output of the check and the comments written after the notice', async () => {
  const f = setup([
    { agent: 'builder', ...built('one.txt'), stdout: stream(builder, 1, 5) },
    { agent: 'reviewer', stdout: stream({ verdict: 'FAIL', report: 'VERDICT: FAIL\nFor the Builder: fix 1' }, 0.5, 2) },
    { agent: 'builder', ...built('two.txt'), stdout: stream(builder, 1, 4) },
    { agent: 'builder', ...built('three.txt'), stdout: stream(builder, 1, 3) },
    { agent: 'reviewer', stdout: stream(PASSED, 0.5, 2) },
  ], [], ['node two-no-three.js']);
  f.setIssue({ ...f.issue(), comments: ['an old comment, before the run'] });

  const first = await runTicket(7, f.deps);

  assert.equal(first.stoppedAt, 'check', JSON.stringify(first));
  assert.deepEqual(branches(f.dir), ['ticket/7-run-one-ticket'], 'its branch is kept');
  const copy = copiesOf(f.dir);
  assert.equal(copy.length, 1, 'its copy is kept');
  const id = readHold(f.dir).sessions.builder;
  assert.ok(typeof id === 'string' && id !== '', 'the file of its stop keeps the id of the Builder\'s conversation');
  assert.equal(f.issue().column, 'Needs Human');
  const notice: string = f.issue().comments[1];
  assert.match(notice, /\nTo relaunch, going on with the Builder: /);
  assert.match(notice, /the output of the check/);
  assert.match(notice, /To start anew instead: remove what «Left» names/, 'both ways are offered');

  f.setIssue({ ...f.issue(), comments: [...f.issue().comments, 'Mind the second file.'] });
  dies(f.dir);
  const out = await runTicket(7, f.deps);

  assert.equal(out.merged, true, JSON.stringify(out));
  assert.deepEqual(copiesOf(f.dir), copy, 'the same copy');
  const builders = f.claudeCalls().filter((c) => c.agent === 'builder');
  assert.equal(builders.length, 3, 'one Builder resumed, no new one');
  assert.equal(flag(builders[2], '--resume'), id, 'the conversation of the last round');
  assert.equal(flag(builders[2], '--session-id'), undefined);
  assert.match(builders[2].stdin, /automatic check failed/i);
  assert.match(builders[2].stdin, /two without three/);
  assert.match(builders[2].stdin, /Mind the second file\./);
  assert.doesNotMatch(builders[2].stdin, /an old comment|fix 1/, 'only the output of the check and what was written after the notice');
  assert.equal(readHold(f.dir), null, 'the ticket ended');
});

// --- A Reviewer with no result, or a check that did not run, goes on from its own step with no Builder.
test('a Reviewer that gave no verdict is kept; relaunched, only a new Reviewer runs, on the same commit and copy', async () => {
  const f = setup([
    { agent: 'builder', ...built('one.txt'), stdout: stream(builder, 1, 5) },
    { agent: 'reviewer', stdout: stream({}, 0.5, 2) },
    { agent: 'reviewer', stdout: stream(PASSED, 0.5, 2) },
  ]);
  const first = await runTicket(7, f.deps);
  assert.equal(first.stoppedAt, 'review', JSON.stringify(first));
  assert.equal(readHold(f.dir)?.resume, 'review', 'its file stays and names the step');
  assert.equal(copiesOf(f.dir).length, 1, 'its copy is kept');
  assert.match(f.issue().comments[0], /\nTo relaunch: .*only a new Reviewer runs, on the same commit \(no Builder\)/s);
  assert.doesNotMatch(f.issue().comments[0], /git worktree remove|git branch -D/);
  const head = sh(copiesOf(f.dir)[0].slice('worktree '.length), 'rev-parse', 'HEAD');

  dies(f.dir);
  const out = await runTicket(7, f.deps);

  assert.equal(out.merged, true, JSON.stringify(out));
  assert.deepEqual(f.claudeCalls().map((c) => c.agent), ['builder', 'reviewer', 'reviewer'], 'no second Builder');
  assert.equal(f.claudeCalls()[2].cwd, f.claudeCalls()[1].cwd, 'the same copy');
  assert.equal(flag(f.claudeCalls()[2], '--resume'), undefined, 'a new Reviewer, not the old conversation');
  assert.equal(sh(f.dir, 'rev-parse', 'ticket/7-run-one-ticket'), head, 'the same commit');
  assert.equal(readHold(f.dir), null, 'the ticket ended');
});

test('a check that did not run is kept; relaunched, the ticket goes on from Verify with no Builder', async () => {
  const f = setup([
    { agent: 'builder', ...built('one.txt'), stdout: stream(builder, 1, 5) },
    { agent: 'reviewer', stdout: stream(PASSED, 0.5, 2) },
  ]);
  const good = f.deps.factory;
  f.deps.factory = () => ({ ...good(), project: { ...good().project, checks: [] } }) as Factory;
  const first = await runTicket(7, f.deps);
  assert.equal(first.stoppedAt, 'check', JSON.stringify(first));
  assert.match(String(first.reason), /did not run/);
  assert.equal(readHold(f.dir)?.resume, 'verify');
  assert.match(f.issue().comments[0], /\nTo relaunch: .*goes on from Verify \(no Builder\)/s);

  f.deps.factory = good;
  dies(f.dir);
  const out = await runTicket(7, f.deps);

  assert.equal(out.merged, true, JSON.stringify(out));
  assert.deepEqual(f.claudeCalls().map((c) => c.agent), ['builder', 'reviewer'], 'no second Builder');
  assert.equal(readHold(f.dir), null);
});


test('a Builder the Reviewer failed in the last round, whose conversation cannot be resumed, gets a new Builder on the same copy with the verdict and the comments', async () => {
  const fail = (n: number) => ({ verdict: 'FAIL', report: `VERDICT: FAIL\nFor the Builder: fix ${n}` });
  const f = setup([
    { agent: 'builder', ...built('one.txt'), stdout: stream(builder, 1, 5) },
    { agent: 'reviewer', stdout: stream(fail(1), 0.5, 2) },
    { agent: 'builder', ...built('two.txt'), stdout: stream(builder, 1, 4) },
    { agent: 'reviewer', stdout: stream(fail(2), 0.5, 2) },
    { agent: 'builder', stdout: 'no stream here\n', code: 1 },
    { agent: 'builder', ...built('three.txt'), stdout: stream(builder, 1, 3) },
    { agent: 'reviewer', stdout: stream(PASSED, 0.5, 2) },
  ]);
  await runTicket(7, f.deps);
  f.setIssue({ ...f.issue(), comments: [...f.issue().comments, 'Ignore the second point.'] });
  dies(f.dir);

  const out = await runTicket(7, f.deps);

  assert.equal(out.merged, true, JSON.stringify(out));
  const builders = f.claudeCalls().filter((c) => c.agent === 'builder');
  assert.equal(builders.length, 4);
  assert.notEqual(flag(builders[2], '--resume'), undefined, 'it first tries to resume');
  assert.equal(flag(builders[3], '--resume'), undefined, 'then a new Builder');
  assert.equal(builders[2].cwd, builders[3].cwd, 'on the same copy');
  assert.match(builders[3].stdin, /VERDICT: FAIL\nFor the Builder: fix 2/);
  assert.match(builders[3].stdin, /Ignore the second point\./);
});

// --- A Builder cut off by a time limit, a spent budget or an unknown end is a kept stop (keeps.ts): its relaunch goes on.
const cutTimeout = { agent: 'builder', stdout: '{"type":"system","subtype":"init"}\n', waitFor: 'never' };
const cuts = [
  { name: 'time limit', first: [cutTimeout], cause: /the time limit of 0\.02 min cut you off/, limits: { builder: 0.02, reviewer: 5 }, round: 1 },
  { name: 'spent budget', first: [spentBudget(3.1)], cause: /you spent your budget of 3 USD/, limits: undefined, round: 1 },
  { name: 'unknown end', first: [{ agent: 'builder', stdout: 'no stream here\n', code: 1 }], cause: /ended in a way dynamo does not know/, limits: undefined, round: 1 },
  // In round 2 the Builder is cut off after the Reviewer failed round 1: the relaunch keeps the round.
  { name: 'time limit in round 2', first: [{ agent: 'builder', ...built('one.txt'), stdout: stream(builder, 1, 5) }, { agent: 'reviewer', stdout: stream({ verdict: 'FAIL', report: 'VERDICT: FAIL\nfix it' }, 0.5, 2) }, cutTimeout], cause: /the time limit of 0\.02 min cut you off/, limits: { builder: 0.02, reviewer: 5 }, round: 2 },
];

for (const c of cuts) {
  test(`a Builder stopped by a ${c.name} keeps its copy, branch, file and session; relaunched, it is resumed in the same round, told why and the comments after the notice`, async () => {
    const f = setup([
      ...c.first,
      { agent: 'builder', ...built('two.txt'), stdout: stream(builder, 1, 5) },
      { agent: 'reviewer', stdout: stream(PASSED, 0.5, 2) },
    ]);
    f.setIssue({ ...f.issue(), comments: ['an old comment, before the run'] });

    const first = await runTicket(7, c.limits === undefined ? f.deps : { ...f.deps, factory: withProject('timeoutMinutes', c.limits) });

    assert.equal(first.stoppedAt, 'build', JSON.stringify(first));
    assert.deepEqual(branches(f.dir), ['ticket/7-run-one-ticket'], 'its branch is kept');
    const copy = copiesOf(f.dir);
    assert.equal(copy.length, 1, 'its copy is kept');
    const hold = readHold(f.dir);
    assert.equal(hold?.round, c.round, 'its file keeps the round');
    const id = hold?.sessions.builder;
    assert.ok(typeof id === 'string' && id !== '', 'its file keeps the Builder\'s session');
    assert.equal(f.issue().column, 'Needs Human');
    const notice: string = f.issue().comments.at(-1);
    assert.match(notice, /\nTo relaunch, going on where the Builder was cut off: .*\/dynamo:autopilot 7/);
    assert.match(notice, /\nTo start anew instead: remove what «Left» names \(`git worktree remove`, then `git branch -D`\)/);

    f.setIssue({ ...f.issue(), comments: [...f.issue().comments, 'Mind the second file.'] });
    dies(f.dir);
    const out = await runTicket(7, f.deps);

    assert.equal(out.merged, true, JSON.stringify(out));
    assert.equal(out.rounds, c.round, 'going on spent no round');
    assert.deepEqual(copiesOf(f.dir), copy, 'the same copy');
    const builders = f.claudeCalls().filter((b) => b.agent === 'builder');
    const resumed = builders.at(-1) as Call;
    assert.equal(builders.length, c.round + 1, 'one Builder resumed, no new one');
    assert.equal(flag(resumed, '--resume'), id, 'the same session id');
    assert.equal(flag(resumed, '--session-id'), undefined);
    assert.match(resumed.stdin, c.cause);
    assert.match(resumed.stdin, /without exploring again/);
    assert.match(resumed.stdin, /Mind the second file\./);
    assert.doesNotMatch(resumed.stdin, /an old comment|Reason: /, 'only what was written after the notice');
    assert.equal(readFileSync(join(f.dir, 'two.txt'), 'utf8'), 'two.txt');
    assert.equal(readHold(f.dir), null, 'the ticket ended');
  });
}

test('a Builder stopped by a time limit whose conversation cannot be resumed gets a new Builder on the same copy, told that it may already hold work', async () => {
  const f = setup([
    cutTimeout,
    { agent: 'builder', stdout: 'no stream here\n', code: 1 },
    { agent: 'builder', ...built('two.txt'), stdout: stream(builder, 1, 5) },
    { agent: 'reviewer', stdout: stream(PASSED, 0.5, 2) },
  ]);
  await runTicket(7, { ...f.deps, factory: withProject('timeoutMinutes', { builder: 0.02, reviewer: 5 }) });
  const id = readHold(f.dir).sessions.builder;
  dies(f.dir);

  const out = await runTicket(7, f.deps);

  assert.equal(out.merged, true, JSON.stringify(out));
  const builders = f.claudeCalls().filter((b) => b.agent === 'builder');
  assert.equal(flag(builders[1], '--resume'), id, 'it first tries to resume');
  assert.equal(flag(builders[2], '--resume'), undefined, 'then a new Builder');
  assert.equal(builders[1].cwd, builders[2].cwd, 'on the same copy');
  assert.match(builders[2].stdin, /may already hold the work|the copy holds its work/);
  assert.match(builders[2].stdin, /time limit of 0\.02 min/);
});

test('a ticket stopped by a time limit whose copy and branch the human removed starts anew: a new copy and Builder, round 1', async () => {
  const f = setup([cutTimeout, { agent: 'builder', ...built('two.txt'), stdout: stream(builder, 1, 5) }, { agent: 'reviewer', stdout: stream(PASSED, 0.5, 2) }]);
  await runTicket(7, { ...f.deps, factory: withProject('timeoutMinutes', { builder: 0.02, reviewer: 5 }) });
  sh(f.dir, 'worktree', 'remove', '--force', copiesOf(f.dir)[0].slice('worktree '.length));
  for (const b of branches(f.dir)) sh(f.dir, 'branch', '-D', b);

  const out = await runTicket(7, f.deps);

  assert.equal(out.merged, true, JSON.stringify(out));
  const builders = f.claudeCalls().filter((b) => b.agent === 'builder');
  assert.equal(flag(builders[1], '--resume'), undefined, 'the Builder is new');
  assert.doesNotMatch(builders[1].stdin, /cut you off/);
});
