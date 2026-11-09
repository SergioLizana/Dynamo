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

function setup(answers: Record<string, unknown>[], blockers: unknown[] = [], checks?: string[]) {
  const dir = repo();
  const ghState = scratch();
  const claudeState = scratch();
  writeFileSync(join(ghState, 'answers.json'), JSON.stringify([{ args: ['api', 'graphql'], stdout: boardAnswer(blockers) }]));
  writeFileSync(join(ghState, 'issue.json'), JSON.stringify({ title: 'Run one ticket', boardName: 'Dynamo', options, column: 'Todo', labels: [], comments: [] }));
  writeFileSync(join(claudeState, 'answers.json'), JSON.stringify(answers.map((a) => ({ ...a, watch: dir }))));
  const ghEnv = fakeGhEnv(ghState);
  const claudeEnv = { ...fakeClaudeEnv(claudeState), FAKE_CLAUDE_PATH: process.env.PATH ?? process.env.Path };
  const deps: Deps = {
    gh: (args, o) => gh(args, { ...o, env: ghEnv }),
    git: (args, o) => git(['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, ...o }),
    exec: execAsync,
    factory: () => (checks === undefined ? factory : { ...factory, project: { ...factory.project, checks } } as Factory),
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
const logs = (dir: string) => join(dir, '.claude', 'worktrees', 'logs', '7');
const jsonl = (file: string) => readFileSync(file, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l));
const flag = (c: Call, name: string) => (c.args.includes(name) ? c.args[c.args.indexOf(name) + 1] : undefined);

test('a ready ticket is built, checked, reviewed and merged: cards in order, one comment with cost and turns', async () => {
  const f = setup([
    { agent: 'builder', ...built('built.txt'), stdout: stream(builder, 1.5, 12) },
    { agent: 'reviewer', stdout: stream({ verdict: 'PASS', report: 'VERDICT: PASS\nCheckboxes:\n- [x] it works — built.txt:1' }, 0.25, 3) },
  ]);
  mkdirSync(logs(f.dir), { recursive: true });
  writeFileSync(join(logs(f.dir), 'builder-9.jsonl'), 'an old run');
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

  // The logs: one per agent run, a new run starts with the folder empty, and the main folder stays clean throughout.
  assert.deepEqual(readdirSync(logs(f.dir)).sort(), ['builder-1.jsonl', 'comment.md', 'reviewer-1.jsonl', 'steps.jsonl']);
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
  assert.ok(lines.some((l) => l.startsWith('Cost: 1.7500 USD')));
  assert.ok(lines.includes('Turns: 15 (the sum of num_turns)'));
  assert.ok(lines.includes('Checks: node pass.js → 0; git diff --check <base> → 0'));
  // The working branch did not move after Verify: the merged tree is the tree Verify passed, so the merge ran no check.
  assert.ok(lines.some((l) => /^Merge checks: skipped, the merged tree is the tree of [0-9a-f]{7}, which Verify passed/.test(l)), comments[0]);
  assert.deepEqual(lastResult(comments)?.rounds, '1/2');
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

test('a ticket dynamo board does not give as ready is not started: the JSON line says why, no card moves, no agent', async () => {
  const f = setup([], [{ number: 3, state: 'OPEN', labels: conn([]) }]);
  const out = await runTicket(7, f.deps);
  assert.deepEqual(out, { ok: false, ticket: 7, started: false, why: 'blocker not done: #3' });
  assert.deepEqual(f.ghCalls().map((c) => c.slice(0, 2)), [['api', 'graphql']]);
  assert.deepEqual(f.claudeCalls(), []);
  assert.equal(existsSync(logs(f.dir)), false);
});

test('a Builder that spends its budget sends the ticket to Needs Human, stopped at build, without a check or a reviewer', async () => {
  const spent = JSON.stringify({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, total_cost_usd: 3.1, num_turns: 30, errors: ['Reached maximum budget ($3)'] });
  const f = setup([{ agent: 'builder', stdout: spent + '\n', code: 1 }]);
  const out = await runTicket(7, f.deps);
  assert.equal(out.ok, false);
  assert.equal(out.stoppedAt, 'build');
  assert.match(String(out.reason), /the Builder spent its budget \(Reached maximum budget \(\$3\)\)/);
  assert.deepEqual(moves(f.ghCalls()), ['Build', 'Needs Human']);
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
    const log = `.claude/worktrees/logs/7/${name}-1.jsonl`;
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

test('a factory.json with no timeoutMinutes for an agent is an error before anything is read or moved, as a missing budgetUsd is', async () => {
  for (const missing of [undefined, { builder: 5 }, { reviewer: 5 }]) {
    const f = setup([]);
    const deps: Deps = { ...f.deps, factory: withProject('timeoutMinutes', missing) };
    await assert.rejects(() => runTicket(7, deps), /factory\.json has no project\.timeoutMinutes\.(builder|reviewer)/);
    assert.deepEqual(f.ghCalls(), []);
    assert.deepEqual(f.claudeCalls(), []);
  }
});

test('a factory.json with a missing or invalid checkTimeoutMinutes is an error before anything is read or moved, as a missing budgetUsd is', async () => {
  for (const bad of [undefined, 0, -1, '15', null, Number.NaN]) {
    const f = setup([]);
    const deps: Deps = { ...f.deps, factory: withProject('checkTimeoutMinutes', bad) };
    await assert.rejects(() => runTicket(7, deps), /project\.checkTimeoutMinutes/, String(bad));
    assert.deepEqual(f.ghCalls(), []);
    assert.deepEqual(f.claudeCalls(), []);
  }
});

test('a factory.json with no budgetUsd for an agent in project is an error before anything is read or moved, and the old place outside project is not read', async () => {
  for (const missing of [undefined, { builder: 5 }, { reviewer: 5 }]) {
    const f = setup([]);
    const deps: Deps = { ...f.deps, factory: () => ({ ...withProject('budgetUsd', missing)(), budgetUsd: { builder: 3, reviewer: 1 } }) as unknown as Factory };
    await assert.rejects(() => runTicket(7, deps), /factory\.json has no project\.budgetUsd\.(builder|reviewer)/);
    assert.deepEqual(f.ghCalls(), []);
    assert.deepEqual(f.claudeCalls(), []);
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
  assert.match(comments[0], /\.claude\/worktrees\/logs\/7\/reviewer-2\.jsonl/);
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

test('a ticket that stops in Needs Human leaves no file; one that pauses keeps it, for the run that goes on', async () => {
  const stopped = setup([{ agent: 'builder', stdout: stream(builder, 3.5, 5).replace('"success"', '"error_max_budget_usd"') }]);
  const a = await runTicket(7, stopped.deps);
  assert.equal(a.paused, undefined, JSON.stringify(a));
  assert.equal(a.stoppedAt, 'build');
  assert.ok(moves(stopped.ghCalls()).includes('Needs Human'));
  assert.equal(readHold(stopped.dir), null);

  const paused = setup([{ agent: 'builder', stdout: limitStream(0.4, 1), code: 1 }]);
  const b = await runTicket(7, paused.deps);
  assert.equal(b.paused, true);
  assert.deepEqual([readHold(paused.dir).round, readHold(paused.dir).phase, readHold(paused.dir).pid], [1, 'build', process.pid]);
});

test('a ticket that is not ready writes no file', async () => {
  const f = setup([], [{ number: 3, state: 'OPEN', labels: conn([]) }]);
  const out = await runTicket(7, f.deps);
  assert.equal(out.started, false, JSON.stringify(out));
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
    writeHold(f.dir, 7, { pid: Number(child.pid), startedAt: since, round: 1, phase: 'review', sessions: { builder: null, reviewer: null }, failed: null, spent: [], builder: null, review: null, checks: null, resetsAt: null });

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
    writeHold(f.dir, 7, { pid: deadPid(), startedAt: '2026-11-03T10:00:00.000Z', round: 1, phase: 'merge', sessions: { builder: null, reviewer: null }, failed: null, spent: [{ cost: 1.5, turns: 8 }], builder: null, review: PASSED, checks: null, resetsAt: null });
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

test('a ticket that pauses at the usage limit keeps the reset time in its file', async () => {
  const f = setup([{ agent: 'builder', stdout: limitStream(0.4, 1), code: 1 }]);
  assert.equal((await runTicket(7, f.deps)).paused, true);
  assert.equal(readHold(f.dir).resetsAt, RESET);
});

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
