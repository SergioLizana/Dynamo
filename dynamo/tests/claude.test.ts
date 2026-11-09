import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentArgs, endingOf, isAgentEnd, parseStream } from '../agents.ts';
import type { AgentRun } from '../agents.ts';
import { claude, runAgent } from '../claude.ts';
import { fakeClaudeEnv, noGhEnv, scratch } from './helpers.ts';

// The lines of `claude -p --output-format stream-json --verbose` that the pure function reads, as the probes printed
// them (Claude Code 2.1.312); the fields it does not read (usage, model usage, ids of timing) are left out.
const SESSION = '7e27f5ff-bccb-43ba-9688-e0477af88d31';
const init = JSON.stringify({ type: 'system', subtype: 'init', session_id: SESSION, model: 'claude-haiku-5-5', permissionMode: 'auto' });
const step = JSON.stringify({ type: 'assistant', session_id: SESSION, message: { role: 'assistant', content: [] } });
const success = JSON.stringify({
  type: 'result', subtype: 'success', is_error: false, terminal_reason: 'completed', stop_reason: 'end_turn',
  session_id: SESSION, total_cost_usd: 0.00553076, num_turns: 3, permission_denials: [],
  result: '{"answer":"ok"}', structured_output: { answer: 'ok' },
});
// The budget probe, whole: `--max-budget-usd 0.001`, which the first answer already spent (exit code 1).
const budget = '{"duration_api_ms":0,"stop_reason":"tool_use","session_id":"7e27f5ff-bccb-43ba-9688-e0477af88d31","total_cost_usd":0.107044,'
  + '"permission_denials":[],"terminal_reason":"budget_exhausted","fast_mode_state":"off","fast_mode_disabled_reason":"sdk_opt_in_required",'
  + '"safety_stops":0,"is_error":true,"num_turns":1,"subtype":"error_max_budget_usd","errors":["Reached maximum budget ($0.001)"],'
  + '"type":"result","duration_ms":4992,"uuid":"29ab1b83-d48a-490f-aa89-47ce92320099","queued_turn_count":0,"result_index":0}';

// --- The pure part (agents.ts): data in, data out.

test('parseStream reads the structured output, cost, turns and session of a run that succeeded', () => {
  assert.deepEqual(parseStream([init, step, success].join('\n') + '\n'), {
    ending: 'success', structured: { answer: 'ok' }, cost: 0.00553076, turns: 3, session: SESSION, detail: null, resetsAt: null,
  });
});

test('parseStream: a spent budget (error_max_budget_usd) is its own ending, with the cost it did spend', () => {
  assert.deepEqual(parseStream([init, step, budget].join('\n')), {
    ending: 'budget', structured: null, cost: 0.107044, turns: 1, session: SESSION, detail: 'Reached maximum budget ($0.001)', resetsAt: null,
  });
});

test('parseStream: the budget ending is also read from terminal_reason alone', () => {
  const line = JSON.stringify({ type: 'result', subtype: 'error_during_execution', terminal_reason: 'budget_exhausted', is_error: true });
  assert.equal(parseStream(line).ending, 'budget');
});

test('parseStream: any other end is «unknown» with the subtype or the errors as detail', () => {
  const failed = JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, total_cost_usd: 0.5, num_turns: 9, session_id: 's1' });
  assert.deepEqual(parseStream(failed), { ending: 'unknown', structured: null, cost: 0.5, turns: 9, session: 's1', detail: 'error_during_execution', resetsAt: null });
  const limit = JSON.stringify({ type: 'result', subtype: 'error_x', is_error: true, errors: ['one', 'two'] });
  assert.equal(parseStream(limit).detail, 'one; two');
});

test('parseStream: a result that says is_error is unknown even when its subtype says success', () => {
  const line = JSON.stringify({ type: 'result', subtype: 'success', is_error: true });
  assert.equal(parseStream(line).ending, 'unknown');
});

test('endingOf: success, budget exhausted, the usage limit, and unknown (no result, is_error without a known ending, an unknown or missing subtype)', () => {
  assert.equal(endingOf({ type: 'result', subtype: 'success', is_error: false }), 'success');
  assert.equal(endingOf({ type: 'result', subtype: 'success' }), 'success');
  assert.equal(endingOf({ type: 'result', subtype: 'error_max_budget_usd', is_error: true }), 'budget');
  assert.equal(endingOf({ type: 'result', subtype: 'error_during_execution', terminal_reason: 'budget_exhausted' }), 'budget');
  assert.equal(endingOf(undefined), 'unknown', 'no result line');
  assert.equal(endingOf({ type: 'result', subtype: 'success', is_error: true }), 'unknown');
  assert.equal(endingOf({ type: 'result', subtype: 'error_unknown', is_error: true }), 'unknown');
  assert.equal(endingOf({ type: 'result', subtype: 'error_max_turns', is_error: true }), 'unknown');
  assert.equal(endingOf({ type: 'result', is_error: true }), 'unknown');
  assert.equal(endingOf({ type: 'result' }), 'unknown');
  assert.equal(endingOf({ type: 'result', subtype: 'error_unknown', is_error: true, api_error: 'usage_limit_reached' }), 'limit');
  assert.equal(endingOf({ type: 'result', is_error: true, api_error: { type: 'usage_limit_reached' } }), 'limit');
  assert.equal(endingOf({ type: 'result', is_error: true, api_error: 'overloaded_error' }), 'unknown', 'another api_error is not the limit');
});

test('parseStream: the usage limit is its own ending, with the reset time from resetsAt (seconds, milliseconds or a date)', () => {
  const limit = (extra: object) => JSON.stringify({ type: 'result', subtype: 'error_unknown', is_error: true, api_error: 'usage_limit_reached', total_cost_usd: 0.2, num_turns: 4, session_id: 's', ...extra });
  const at = '2026-11-03T18:30:00.000Z';
  const seconds = Date.parse(at) / 1000;
  assert.deepEqual(parseStream(limit({ resetsAt: seconds })), { ending: 'limit', structured: null, cost: 0.2, turns: 4, session: 's', detail: 'error_unknown', resetsAt: at });
  assert.equal(parseStream(limit({ resetsAt: seconds * 1000 })).resetsAt, at);
  assert.equal(parseStream(limit({ resetsAt: at })).resetsAt, at);
  assert.equal(parseStream(limit({ api_error: { type: 'usage_limit_reached', resetsAt: seconds } })).resetsAt, at);
  const event = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: seconds } });
  assert.equal(parseStream([event, limit({})].join('\n')).resetsAt, at, 'from the last rate_limit_event when the result has none');
  assert.equal(parseStream(limit({})).resetsAt, null, 'the stream does not say');
  assert.equal(parseStream(limit({ resetsAt: 'soon' })).resetsAt, null, 'not a time');
});

test('parseStream: a success with no structured output has null for it, so the caller decides', () => {
  const line = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'text only', total_cost_usd: 0.1, num_turns: 1 });
  assert.deepEqual(parseStream(line), { ending: 'success', structured: null, cost: 0.1, turns: 1, session: null, detail: null, resetsAt: null });
});

test('parseStream: a stream with no result line (the process died) is unknown, with the session of the init line', () => {
  const r = parseStream([init, step].join('\n'));
  assert.deepEqual(r, { ending: 'unknown', structured: null, cost: null, turns: null, session: SESSION, detail: 'the stream has no result line', resetsAt: null });
  assert.equal(parseStream('').ending, 'unknown');
  assert.equal(parseStream('').session, null);
});

test('parseStream skips lines that are not JSON objects, accepts CRLF, and the last result line wins', () => {
  const text = ['warning: not json', '', '[1,2]', 'null', init, budget, success].join('\r\n');
  const r = parseStream(text);
  assert.equal(r.ending, 'success');
  assert.equal(r.turns, 3);
});

test('parseStream treats what claude printed as unknown: a field of the wrong type is null, never passed on', () => {
  const line = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: '0.5', num_turns: null, session_id: 7 });
  assert.deepEqual(parseStream(line), { ending: 'success', structured: null, cost: null, turns: null, session: null, detail: null, resetsAt: null });
});

const run: AgentRun = {
  agent: 'builder', prompt: 'Build #86.', cwd: '/copy', log: '/logs/86.jsonl', schema: { type: 'object' }, budget: 2.5, session: SESSION,
  skills: true, timeoutMs: 60_000,
};

test('agentArgs: the flags the loop needs, each with its value', () => {
  assert.deepEqual(agentArgs(run), [
    '-p', '--agent', 'dynamo:builder', '--output-format', 'stream-json', '--verbose', '--json-schema', '{"type":"object"}',
    '--max-budget-usd', '2.5', '--permission-mode', 'auto', '--permission-prompts', 'none', '--session-id', SESSION,
  ]);
});

// The plugin's agents are namespaced so they do not clash with a project's own agents.
test('agentArgs launches the plugin agents: dynamo:builder and dynamo:reviewer', () => {
  for (const agent of ['builder', 'reviewer']) {
    const args = agentArgs({ ...run, agent });
    assert.equal(args[args.indexOf('--agent') + 1], `dynamo:${agent}`);
  }
});

test('agentArgs: a run without skills gets --disable-slash-commands, one with skills does not', () => {
  assert.ok(agentArgs({ ...run, agent: 'reviewer', skills: false }).includes('--disable-slash-commands'));
  assert.ok(!agentArgs(run).includes('--disable-slash-commands'));
});

test('agentArgs never sets the tools by flag: the agent file is the one list, and it wins over --tools', () => {
  for (const agent of ['builder', 'reviewer']) {
    const args = agentArgs({ ...run, agent });
    assert.ok(!args.includes('--tools') && !args.includes('--allowedTools') && !args.includes('--strict-mcp-config'), agent);
  }
});

// The tools line of an agent file is its whole list, with no exceptions: on Claude Code 2.1.312 an agent whose file
// names tools without StructuredOutput cannot give the answer of --json-schema, even with --tools adding it (probed
// on that version, where reviewers answered PASS in text only).
test('every agent dynamo runs with a schema can answer with it: a tools line in its file lists StructuredOutput', () => {
  for (const agent of ['builder', 'reviewer']) {
    const text = readFileSync(join(import.meta.dirname, '..', '..', 'agents', `${agent}.md`), 'utf8');
    const front = text.split(/^---$/m)[1] ?? '';
    const line = front.split(/\r?\n/).find((l) => l.startsWith('tools:'));
    if (line === undefined) continue;
    assert.ok(line.slice('tools:'.length).split(',').map((t) => t.trim()).includes('StructuredOutput'), `${agent}.md: ${line}`);
  }
});

// --- The edge (claude.ts), with the fake claude and no real one on the PATH.

function answer(state: string, a: { stdout?: string; stderr?: string; code?: number; waitFor?: string; then?: string; child?: string }): void {
  writeFileSync(join(state, 'answer.json'), JSON.stringify(a));
}
function calls(state: string): { args: string[]; stdin: string; cwd: string }[] {
  return readFileSync(join(state, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
}

test('claude runs the command in DYNAMO_CLAUDE with the arguments and stdin, and returns its code and output', () => {
  const state = scratch();
  answer(state, { stdout: 'out\n', stderr: 'err\n', code: 3 });
  const r = claude(['-p', '--agent', 'builder'], { env: fakeClaudeEnv(state), input: 'a prompt' });
  assert.deepEqual(r, { code: 3, stdout: 'out\n', stderr: 'err\n' });
  assert.deepEqual(calls(state).map((c) => [c.args, c.stdin]), [[['-p', '--agent', 'builder'], 'a prompt']]);
});

test('runAgent passes --agent, --json-schema, --max-budget-usd, --permission-mode auto, --permission-prompts none, --session-id and --output-format stream-json', async () => {
  const state = scratch();
  const folder = scratch();
  answer(state, { stdout: [init, success].join('\n') + '\n' });
  await runAgent({ ...run, cwd: folder, log: join(folder, 'b.jsonl') }, { env: fakeClaudeEnv(state) });
  const [call] = calls(state);
  const pairs = (flag: string) => call.args[call.args.indexOf(flag) + 1];
  assert.equal(pairs('--agent'), 'dynamo:builder');
  assert.equal(pairs('--json-schema'), '{"type":"object"}');
  assert.equal(pairs('--max-budget-usd'), '2.5');
  assert.equal(pairs('--permission-mode'), 'auto');
  assert.equal(pairs('--permission-prompts'), 'none');
  assert.equal(pairs('--session-id'), SESSION);
  assert.equal(pairs('--output-format'), 'stream-json');
  assert.ok(call.args.includes('-p') && call.args.includes('--verbose'));
});

test('runAgent runs in the folder it is given, sends the prompt on stdin and returns what the stream says', async () => {
  const state = scratch();
  const folder = scratch();
  answer(state, { stdout: [init, step, success].join('\n') + '\n' });
  const r = await runAgent({ ...run, cwd: folder, log: join(folder, 'b.jsonl') }, { env: fakeClaudeEnv(state) });
  assert.deepEqual(r, { ending: 'success', structured: { answer: 'ok' }, cost: 0.00553076, turns: 3, session: SESSION, detail: null, resetsAt: null });
  const [call] = calls(state);
  assert.equal(call.stdin, 'Build #86.');
  assert.equal(realpathSync(call.cwd), realpathSync(folder));
});

test('runAgent writes the whole stream to the log file, line for line, and makes its folder', async () => {
  const state = scratch();
  const folder = scratch();
  const stream = ['not json at all', init, step, budget].join('\n') + '\n';
  answer(state, { stdout: stream, code: 1 });
  const log = join(folder, 'logs', 'deep', '86.jsonl');
  const r = await runAgent({ ...run, cwd: folder, log }, { env: fakeClaudeEnv(state) });
  assert.equal(readFileSync(log, 'utf8'), stream);
  assert.equal(r.ending, 'budget');
  assert.equal(r.cost, 0.107044);
});

test('runAgent decides from the stream, not from the exit code: a result that succeeded counts even if claude exited 1', async () => {
  const state = scratch();
  const folder = scratch();
  answer(state, { stdout: success + '\n', code: 1 });
  assert.equal((await runAgent({ ...run, cwd: folder, log: join(folder, 'l') }, { env: fakeClaudeEnv(state) })).ending, 'success');
});

test('runAgent with no claude on the PATH and no DYNAMO_CLAUDE is unknown with the reason, and the log keeps how the process ended', async () => {
  const folder = scratch();
  const log = join(folder, 'l.jsonl');
  const r = await runAgent({ ...run, cwd: folder, log }, { env: noGhEnv() });
  assert.equal(r.ending, 'unknown');
  assert.match(String(r.detail), /the stream has no result line.*claude exited 127: claude: /);
  const [end, ...more] = readFileSync(log, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l));
  assert.equal(more.length, 0);
  assert.deepEqual([end.type, end.subtype, end.exit_code], ['dynamo', 'process_end', 127]);
  assert.match(end.stderr, /^claude: /);
});

test('runAgent with a claude that printed nothing and failed keeps the end of its stderr in the detail', async () => {
  const state = scratch();
  const folder = scratch();
  answer(state, { stderr: 'boom: no session\n', code: 1 });
  const log = join(folder, 'l');
  const r = await runAgent({ ...run, cwd: folder, log }, { env: fakeClaudeEnv(state) });
  assert.equal(r.ending, 'unknown');
  assert.match(String(r.detail), /claude exited 1: boom: no session/);
  assert.match(readFileSync(log, 'utf8'), /"subtype":"process_end","exit_code":1,"stderr":"boom: no session/);
});

test('runAgent with an unknown error in the result line is unknown, and its log stays exactly as claude wrote it', async () => {
  const state = scratch();
  const folder = scratch();
  const unknown = JSON.stringify({ type: 'result', subtype: 'error_unknown', is_error: true, errors: ['usage limit: resets at 5pm'], total_cost_usd: 0.2, num_turns: 4 });
  answer(state, { stdout: [init, unknown].join('\n') + '\n', code: 1 });
  const log = join(folder, 'l');
  const r = await runAgent({ ...run, cwd: folder, log }, { env: fakeClaudeEnv(state) });
  assert.deepEqual([r.ending, r.detail, r.cost, r.turns], ['unknown', 'usage limit: resets at 5pm', 0.2, 4]);
  assert.equal(readFileSync(log, 'utf8'), [init, unknown].join('\n') + '\n');
});

test('runAgent is asynchronous and the log is claude\'s stdout itself: a line printed while the agent works is in the log before it exits', async () => {
  const state = scratch();
  const folder = scratch();
  const log = join(folder, 'live.jsonl');
  const release = join(folder, 'release');
  answer(state, { stdout: init + '\n', waitFor: release, then: success + '\n' });
  let settled = false;
  const running = runAgent({ ...run, cwd: folder, log }, { env: fakeClaudeEnv(state) }).finally(() => { settled = true; });
  const until = Date.now() + 15000;
  while (!(existsSync(log) && readFileSync(log, 'utf8').includes(init)) && Date.now() < until) await new Promise((r) => setTimeout(r, 25));
  assert.ok(readFileSync(log, 'utf8').includes(init), 'the first line is in the log while the agent works');
  assert.equal(settled, false, 'the agent has not ended yet');
  writeFileSync(release, '');
  const r = await running;
  assert.equal(r.ending, 'success');
  assert.equal(readFileSync(log, 'utf8'), init + '\n' + success + '\n');
});

test('runAgent past its time limit with no result line ends as timeout, closed with its process, and the log says so', async () => {
  const state = scratch();
  const folder = scratch();
  answer(state, { stdout: init + '\n', waitFor: join(folder, 'never'), then: success + '\n' });
  const log = join(folder, 'l.jsonl');
  const started = Date.now();
  const r = await runAgent({ ...run, cwd: folder, log, timeoutMs: 700 }, { env: fakeClaudeEnv(state) });
  assert.ok(Date.now() - started < 15000, 'closed at the limit, not when the agent would have ended');
  assert.deepEqual([r.ending, r.turns, r.cost], ['timeout', null, null]);
  assert.match(String(r.detail), /^no result after 0\.01 min/);
  const lines = readFileSync(log, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.subtype), ['init', 'timeout']);
  assert.ok(!readFileSync(log, 'utf8').includes('"type":"result"'));
});

test('runAgent past its time limit with a result already in the log keeps that result: the work is done', async () => {
  const state = scratch();
  const folder = scratch();
  answer(state, { stdout: [init, success].join('\n') + '\n', waitFor: join(folder, 'never') });
  const r = await runAgent({ ...run, cwd: folder, log: join(folder, 'l.jsonl'), timeoutMs: 700 }, { env: fakeClaudeEnv(state) });
  assert.equal(r.ending, 'success');
  assert.equal(r.turns, 3);
});

test('runAgent within its time limit ends as before', async () => {
  const state = scratch();
  const folder = scratch();
  answer(state, { stdout: [init, success].join('\n') + '\n' });
  const r = await runAgent({ ...run, cwd: folder, log: join(folder, 'l.jsonl'), timeoutMs: 60 * 60_000 }, { env: fakeClaudeEnv(state) });
  assert.equal(r.ending, 'success');
});

test('runAgent writes a stream of any size to the log: it never passes through a buffer of the output', async () => {
  const state = scratch();
  const folder = scratch();
  const big = JSON.stringify({ type: 'assistant', text: 'x'.repeat(1024 * 1024) });
  answer(state, { stdout: (big + '\n').repeat(3) + success + '\n' });
  const log = join(folder, 'big.jsonl');
  const r = await runAgent({ ...run, cwd: folder, log }, { env: fakeClaudeEnv(state) });
  assert.equal(r.ending, 'success');
  assert.equal(readFileSync(log, 'utf8').length, (big.length + 1) * 3 + success.length + 1);
});

// --- The result is the end: once the log holds the result line, the agent has 30 s (`graceMs`, shortened here) to exit.

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
async function until(condition: () => boolean, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 50));
  }
}

test('runAgent closes an agent that has written its result and keeps a child alive once the grace has passed, and goes on with that result', async () => {
  const state = scratch();
  const folder = scratch();
  const child = join(folder, 'child.pid');
  const never = join(folder, 'never-created');
  answer(state, { stdout: [init, step, success].join('\n') + '\n', waitFor: never, child });
  const log = join(folder, 'hung.jsonl');
  const started = Date.now();
  const r = await runAgent({ ...run, cwd: folder, log }, { env: fakeClaudeEnv(state), graceMs: 700 });
  assert.deepEqual(r, { ending: 'success', structured: { answer: 'ok' }, cost: 0.00553076, turns: 3, session: SESSION, detail: null, resetsAt: null });
  assert.ok(Date.now() - started < 15000, 'it did not wait for the agent to end on its own');
  const pid = Number(readFileSync(child, 'utf8'));
  await until(() => !alive(pid), 5000);
  assert.equal(readFileSync(log, 'utf8'), [init, step, success].join('\n') + '\n', 'the log is what the agent wrote');
});

test('runAgent does not close an agent that exits on its own within the grace, and its result is the same', async () => {
  const state = scratch();
  const folder = scratch();
  const release = join(folder, 'release');
  const after = JSON.stringify({ type: 'dynamo', subtype: 'after_result' });
  answer(state, { stdout: [init, step, success].join('\n') + '\n', waitFor: release, then: after + '\n' });
  const log = join(folder, 'exits.jsonl');
  const running = runAgent({ ...run, cwd: folder, log }, { env: fakeClaudeEnv(state), graceMs: 10000 });
  await until(() => existsSync(log) && readFileSync(log, 'utf8').includes('"type":"result"'), 15000);
  await new Promise((r) => setTimeout(r, 400)); // the watch has seen the result and the grace is running
  writeFileSync(release, '');
  const r = await running;
  assert.deepEqual(r, { ending: 'success', structured: { answer: 'ok' }, cost: 0.00553076, turns: 3, session: SESSION, detail: null, resetsAt: null });
  assert.equal(readFileSync(log, 'utf8'), [init, step, success, after].join('\n') + '\n', 'it ran to its own end: nothing cut');
});

test('runAgent does not close an agent that has not given its result, however long it takes', async () => {
  const state = scratch();
  const folder = scratch();
  const release = join(folder, 'release');
  answer(state, { stdout: [init, step].join('\n') + '\n', waitFor: release, then: success + '\n' });
  const running = runAgent({ ...run, cwd: folder, log: join(folder, 'slow.jsonl') }, { env: fakeClaudeEnv(state), graceMs: 100 });
  await new Promise((r) => setTimeout(r, 1500));
  writeFileSync(release, '');
  assert.equal((await running).ending, 'success');
});

test('agentArgs: a run that resumes a conversation gets --resume with its id, and no --session-id', () => {
  const args = agentArgs({ ...run, resume: true });
  assert.equal(args[args.indexOf('--resume') + 1], SESSION);
  assert.ok(!args.includes('--session-id'));
  assert.ok(agentArgs(run).includes('--session-id') && !agentArgs(run).includes('--resume'));
});

// --- A resumed session first reports the background shell its previous session left: that `result` is not the agent's end.
// The shape of a resumed agent's stream: a task notification, a result of its own
// (0 turns, no cost, origin `task-notification`), then the real conversation and its real result.
const notice = JSON.stringify({ type: 'system', subtype: 'task_notification', session_id: SESSION, status: 'completed' });
const noticeResult = JSON.stringify({
  type: 'result', subtype: 'success', is_error: false, session_id: SESSION, total_cost_usd: 0, num_turns: 0,
  result: '', origin: { kind: 'task-notification' },
});

test('isAgentEnd: a result is the end unless its origin is a task notification', () => {
  assert.equal(isAgentEnd(JSON.parse(success)), true);
  assert.equal(isAgentEnd(JSON.parse(noticeResult)), false);
  assert.equal(isAgentEnd({ type: 'result', origin: { kind: 'user' } }), true);
  assert.equal(isAgentEnd({ type: 'assistant' }), false);
  assert.equal(isAgentEnd(null), false);
});

test('parseStream: the answer is the real result after the task notification\'s, with its own cost and turns', () => {
  assert.deepEqual(parseStream([init, notice, noticeResult, step, success].join('\n') + '\n'), {
    ending: 'success', structured: { answer: 'ok' }, cost: 0.00553076, turns: 3, session: SESSION, detail: null, resetsAt: null,
  });
});

test('parseStream: a stream whose only result is a task notification\'s is not a success: it has no result', () => {
  const r = parseStream([init, notice, noticeResult].join('\n') + '\n');
  assert.deepEqual([r.ending, r.structured, r.turns, r.cost], ['unknown', null, null, null]);
  assert.equal(r.detail, 'the stream has no result line');
});

test('runAgent does not close a resumed agent at the result of a task notification: it runs to its real answer', async () => {
  const state = scratch();
  const folder = scratch();
  const release = join(folder, 'release');
  answer(state, { stdout: [init, notice, noticeResult].join('\n') + '\n', waitFor: release, then: [step, success].join('\n') + '\n' });
  const log = join(folder, 'resumed.jsonl');
  const running = runAgent({ ...run, cwd: folder, log, resume: true }, { env: fakeClaudeEnv(state), graceMs: 100 });
  await new Promise((r) => setTimeout(r, 1500)); // many times the grace after the notification's result
  writeFileSync(release, '');
  const r = await running;
  assert.deepEqual(r, { ending: 'success', structured: { answer: 'ok' }, cost: 0.00553076, turns: 3, session: SESSION, detail: null, resetsAt: null });
  assert.equal(readFileSync(log, 'utf8'), [init, notice, noticeResult, step, success].join('\n') + '\n', 'nothing cut');
});

test('runAgent with a stream whose only result is a task notification\'s ends as unknown, not as a success', async () => {
  const state = scratch();
  const folder = scratch();
  answer(state, { stdout: [init, notice, noticeResult].join('\n') + '\n' });
  const r = await runAgent({ ...run, cwd: folder, log: join(folder, 'l.jsonl') }, { env: fakeClaudeEnv(state), graceMs: 100 });
  assert.equal(r.ending, 'unknown');
  assert.equal(r.turns, null);
  assert.match(String(r.detail), /the stream has no result line/);
});

// Git Bash rewrites an argument that starts with «/» as a Windows path; the variable that stops it must reach every agent.
test('the Builder and the reviewer get MSYS_NO_PATHCONV=1, and keep what dynamo inherits (DYNAMO_GH)', async () => {
  const state = scratch();
  const folder = scratch();
  answer(state, { stdout: [init, success].join('\n') + '\n' });
  const env = { ...fakeClaudeEnv(state), DYNAMO_GH: '["gh-fake"]', MSYS_NO_PATHCONV: undefined };
  for (const agent of ['builder', 'reviewer']) {
    await runAgent({ ...run, agent, cwd: folder, log: join(folder, `${agent}.jsonl`) }, { env });
  }
  const seen = readFileSync(join(state, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(seen.map((c) => [c.agent, c.pathconv, c.gh]).sort(), [
    ['builder', '1', '["gh-fake"]'], ['reviewer', '1', '["gh-fake"]'],
  ]);
});

test('claude (the short call) also runs with MSYS_NO_PATHCONV=1', () => {
  const state = scratch();
  answer(state, { stdout: 'x' });
  claude(['-p'], { env: fakeClaudeEnv(state) });
  assert.equal(JSON.parse(readFileSync(join(state, 'calls.jsonl'), 'utf8').trim()).pathconv, '1');
});

// --- An outage of the permission check: the line as Claude Code 2.1.318 wrote it in the log.

const denied = (reason: string) => JSON.stringify({
  type: 'system', subtype: 'permission_denied', tool_name: 'Bash', tool_use_id: 't', decision_reason_type: 'classifier', decision_reason: reason, message: 'm',
});
const answered = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, session_id: 's' });

test('parseStream says a run met an outage of the permission check, with a result or with none', () => {
  assert.equal(parseStream(`${denied('Classifier unavailable')}\n${answered}\n`).outage, true);
  assert.equal(parseStream(`${denied('Classifier unavailable')}\n`).outage, true);
});

test('a real denial of the permission check, or a text that only mentions the outage, is no outage', () => {
  assert.equal(parseStream(`${denied('This command deletes a branch')}\n${answered}\n`).outage, undefined);
  const said = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'Classifier unavailable' }] } });
  assert.equal(parseStream(`${said}\n${answered}\n`).outage, undefined);
});
