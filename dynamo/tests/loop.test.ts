// One ticket of `dynamo run` end to end (loop.ts): a temporary repository, the fake gh (one issue that keeps its card, labels and comments) and the
// fake claude (a Builder that commits in its copy, a reviewer that answers PASS or FAIL), with no gh or claude on the PATH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runAgent } from '../claude.ts';
import type { Deps } from '../cli.ts';
import { exec } from '../exec.ts';
import type { Factory } from '../factory.ts';
import { gh } from '../gh.ts';
import { git } from '../git.ts';
import { lastResult } from '../releases.ts';
import { runTicket } from '../loop.ts';
import { fakeClaudeEnv, fakeGhEnv, scratch } from './helpers.ts';

const BASE = 'release/1.0.0';
const options = { Todo: '1', Build: '2', Verify: '3', Review: '4', 'Needs Human': '5', Done: '6' };
const factory = {
  project: {
    repo: 'o/r', mainBranch: 'main', workingBranch: BASE, doneLabel: 'in-release', checks: ['node pass.js', 'git diff --check <base>'],
    boardOwner: 'o', boardNumber: 1, boardId: 'B', boardName: 'Dynamo', statusFieldId: 'S',
  },
  columns: { todo: 'Todo', needsHuman: 'Needs Human', done: 'Done' },
  options,
  budgetUsd: { builder: 3, reviewer: 1 },
  phases: [{ name: 'Build', column: 'Build' }, { name: 'Verify', column: 'Verify' }, { name: 'Review', column: 'Review' }, { name: 'Merge', column: 'Done' }],
} as unknown as Factory;

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
  sh(dir, 'add', '.');
  sh(dir, 'commit', '-q', '-m', 'A');
  sh(dir, 'checkout', '-q', '-b', BASE);
  writeFileSync(join(dir, 'b.txt'), 'b');
  sh(dir, 'add', 'b.txt');
  sh(dir, 'commit', '-q', '-m', 'B');
  return dir;
}

const conn = (nodes: unknown[]) => ({ totalCount: nodes.length, nodes });
const boardAnswer = (blockers: unknown[]) => JSON.stringify({ data: { repository: { t7: {
  number: 7, title: 'Run one ticket', state: 'OPEN', labels: conn([]),
  projectItems: conn([{ project: { id: 'B' }, fieldValues: conn([{ name: 'Todo', field: { id: 'S' } }]) }]), blockedBy: conn(blockers),
} } } });

// One line of the stream with the answer, as `claude -p --output-format stream-json` ends.
const stream = (structured: unknown, cost: number, turns: number) => [
  JSON.stringify({ type: 'system', subtype: 'init', session_id: 's' }),
  JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: cost, num_turns: turns, session_id: 's', structured_output: structured }),
].join('\n') + '\n';
const built = (file: string) => ({ commit: { file, text: file, message: `${file} (#7)` } });
const builder = { commit: 'x', needsHuman: false, needsHumanReason: '', published: '', noTrace: '', outOfTicket: '' };

type Call = { args: string[]; stdin: string; cwd: string; agent: string; watched?: string };

function setup(answers: Record<string, unknown>[], blockers: unknown[] = []) {
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
    exec,
    factory: () => factory,
    agent: (r, o) => runAgent(r, { ...o, env: claudeEnv }),
  };
  const lines = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l)) : []);
  return {
    dir, deps,
    ghCalls: (): string[][] => lines(join(ghState, 'calls.jsonl')).map((c) => c.args),
    claudeCalls: (): Call[] => lines(join(claudeState, 'calls.jsonl')),
    issue: () => JSON.parse(readFileSync(join(ghState, 'issue.json'), 'utf8')),
  };
}

const moves = (calls: string[][]) => calls.filter((c) => c[0] === 'project' && c[1] === 'item-edit').map((c) => c[c.indexOf('--value') + 1]);
const branches = (dir: string) => sh(dir, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/ticket/').split('\n').filter((b) => b !== '');
const logs = (dir: string) => join(dir, '.claude', 'worktrees', 'logs', '7');
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
  assert.deepEqual(moves(f.ghCalls()), ['Build', 'Verify', 'Review', 'Verify', 'Done']);
  assert.equal(sh(f.dir, 'log', '-1', '--format=%s'), `Merge ticket/7-run-one-ticket into ${BASE} (#7)`);
  assert.equal(sh(f.dir, 'rev-parse', 'HEAD^1'), before);
  assert.equal(readFileSync(join(f.dir, 'built.txt'), 'utf8'), 'built.txt');
  assert.equal(out.head, sh(f.dir, 'rev-parse', '--short', 'HEAD'));
  assert.deepEqual(branches(f.dir), ['ticket/7-run-one-ticket']);
  assert.deepEqual(f.issue().labels, ['in-release']);

  // The logs: one per agent run, a new run starts with the folder empty, and the main folder stays clean throughout.
  assert.deepEqual(readdirSync(logs(f.dir)).sort(), ['builder-1.jsonl', 'comment.md', 'reviewer-1.jsonl']);
  assert.equal(readFileSync(join(logs(f.dir), 'builder-1.jsonl'), 'utf8'), stream(builder, 1.5, 12));
  const calls = f.claudeCalls();
  assert.deepEqual(calls.map((c) => c.watched), ['', '']);
  assert.equal(sh(f.dir, 'status', '--porcelain'), '');

  // The reviewer gets read-only tools and no MCP server by flag; the Builder neither. Both run in the copy.
  const [b, r] = calls;
  assert.deepEqual([b.agent, r.agent], ['builder', 'reviewer']);
  assert.equal(flag(r, '--tools'), 'Read,Grep,Glob,Bash');
  assert.ok(r.args.includes('--strict-mcp-config'));
  assert.ok(!b.args.includes('--tools') && !b.args.includes('--strict-mcp-config'));
  assert.equal(flag(b, '--max-budget-usd'), '3');
  assert.equal(flag(r, '--max-budget-usd'), '1');
  const copy = realpathSync(join(f.dir, '.claude', 'worktrees', 'ticket-7'));
  assert.deepEqual([realpathSync(b.cwd), realpathSync(r.cwd)], [copy, copy]);

  // One comment, the ticket's result for `dynamo report`.
  const comments: string[] = f.issue().comments;
  assert.equal(comments.length, 1);
  const lines = comments[0].split('\n');
  assert.equal(lines[0], `run · PASS and merged into ${BASE}`);
  assert.ok(lines.some((l) => l.startsWith('Cost: 1.7500 USD')));
  assert.ok(lines.includes('Turns: 15 (the sum of num_turns)'));
  assert.ok(lines.includes('Checks: node pass.js → 0; git diff --check <base> → 0'));
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
  assert.deepEqual(readdirSync(logs(f.dir)).sort(), ['builder-1.jsonl', 'builder-2.jsonl', 'comment.md', 'reviewer-1.jsonl', 'reviewer-2.jsonl']);
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
