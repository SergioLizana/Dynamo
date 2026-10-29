import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentArgs, endingOf, parseStream } from '../agents.ts';
import type { AgentRun } from '../agents.ts';
import { claude, runAgent } from '../claude.ts';
import { fakeClaudeEnv, noGhEnv, scratch } from './helpers.ts';

// The lines of `claude -p --output-format stream-json --verbose` that the pure function reads, as the probes of #86 printed
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
    ending: 'success', structured: { answer: 'ok' }, cost: 0.00553076, turns: 3, session: SESSION, detail: null,
  });
});

test('parseStream: a spent budget (error_max_budget_usd) is its own ending, with the cost it did spend', () => {
  assert.deepEqual(parseStream([init, step, budget].join('\n')), {
    ending: 'budget', structured: null, cost: 0.107044, turns: 1, session: SESSION, detail: 'Reached maximum budget ($0.001)',
  });
});

test('parseStream: the budget ending is also read from terminal_reason alone', () => {
  const line = JSON.stringify({ type: 'result', subtype: 'error_during_execution', terminal_reason: 'budget_exhausted', is_error: true });
  assert.equal(parseStream(line).ending, 'budget');
});

test('parseStream: any other end is «paused» with the subtype or the errors as detail', () => {
  const failed = JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, total_cost_usd: 0.5, num_turns: 9, session_id: 's1' });
  assert.deepEqual(parseStream(failed), { ending: 'paused', structured: null, cost: 0.5, turns: 9, session: 's1', detail: 'error_during_execution' });
  const limit = JSON.stringify({ type: 'result', subtype: 'error_x', is_error: true, errors: ['one', 'two'] });
  assert.equal(parseStream(limit).detail, 'one; two');
});

test('parseStream: a result that says is_error is paused even when its subtype says success', () => {
  const line = JSON.stringify({ type: 'result', subtype: 'success', is_error: true });
  assert.equal(parseStream(line).ending, 'paused');
});

test('endingOf: success, budget exhausted, and paused (no result, is_error without a known ending, an unknown or missing subtype)', () => {
  assert.equal(endingOf({ type: 'result', subtype: 'success', is_error: false }), 'success');
  assert.equal(endingOf({ type: 'result', subtype: 'success' }), 'success');
  assert.equal(endingOf({ type: 'result', subtype: 'error_max_budget_usd', is_error: true }), 'budget');
  assert.equal(endingOf({ type: 'result', subtype: 'error_during_execution', terminal_reason: 'budget_exhausted' }), 'budget');
  assert.equal(endingOf(undefined), 'paused', 'no result line');
  assert.equal(endingOf({ type: 'result', subtype: 'success', is_error: true }), 'paused');
  assert.equal(endingOf({ type: 'result', subtype: 'error_unknown', is_error: true }), 'paused');
  assert.equal(endingOf({ type: 'result', subtype: 'error_max_turns', is_error: true }), 'paused');
  assert.equal(endingOf({ type: 'result', is_error: true }), 'paused');
  assert.equal(endingOf({ type: 'result' }), 'paused');
});

test('parseStream: a success with no structured output has null for it, so the caller decides', () => {
  const line = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'text only', total_cost_usd: 0.1, num_turns: 1 });
  assert.deepEqual(parseStream(line), { ending: 'success', structured: null, cost: 0.1, turns: 1, session: null, detail: null });
});

test('parseStream: a stream with no result line (the process died) is paused, with the session of the init line', () => {
  const r = parseStream([init, step].join('\n'));
  assert.deepEqual(r, { ending: 'paused', structured: null, cost: null, turns: null, session: SESSION, detail: 'the stream has no result line' });
  assert.equal(parseStream('').ending, 'paused');
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
  assert.deepEqual(parseStream(line), { ending: 'success', structured: null, cost: null, turns: null, session: null, detail: null });
});

const run: AgentRun = {
  agent: 'builder', prompt: 'Build #86.', cwd: '/copy', log: '/logs/86.jsonl', schema: { type: 'object' }, budget: 2.5, session: SESSION,
  skills: true,
};

test('agentArgs: the flags the loop needs, each with its value', () => {
  assert.deepEqual(agentArgs(run), [
    '-p', '--agent', 'builder', '--output-format', 'stream-json', '--verbose', '--json-schema', '{"type":"object"}',
    '--max-budget-usd', '2.5', '--permission-mode', 'auto', '--permission-prompts', 'none', '--session-id', SESSION,
  ]);
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
// 2026-10-29, after both reviewers of the first list said PASS in text only).
test('every agent dynamo runs with a schema can answer with it: a tools line in its file lists StructuredOutput', () => {
  for (const agent of ['builder', 'reviewer']) {
    const text = readFileSync(join(import.meta.dirname, '..', '..', '.claude', 'agents', `${agent}.md`), 'utf8');
    const front = text.split(/^---$/m)[1] ?? '';
    const line = front.split(/\r?\n/).find((l) => l.startsWith('tools:'));
    if (line === undefined) continue;
    assert.ok(line.slice('tools:'.length).split(',').map((t) => t.trim()).includes('StructuredOutput'), `${agent}.md: ${line}`);
  }
});

// --- The edge (claude.ts), with the fake claude and no real one on the PATH.

function answer(state: string, a: { stdout?: string; stderr?: string; code?: number; waitFor?: string; then?: string }): void {
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
  assert.equal(pairs('--agent'), 'builder');
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
  assert.deepEqual(r, { ending: 'success', structured: { answer: 'ok' }, cost: 0.00553076, turns: 3, session: SESSION, detail: null });
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

test('runAgent with no claude on the PATH and no DYNAMO_CLAUDE is paused with the reason, and the log keeps how the process ended', async () => {
  const folder = scratch();
  const log = join(folder, 'l.jsonl');
  const r = await runAgent({ ...run, cwd: folder, log }, { env: noGhEnv() });
  assert.equal(r.ending, 'paused');
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
  assert.equal(r.ending, 'paused');
  assert.match(String(r.detail), /claude exited 1: boom: no session/);
  assert.match(readFileSync(log, 'utf8'), /"subtype":"process_end","exit_code":1,"stderr":"boom: no session/);
});

test('runAgent with an unknown error in the result line is paused, and its log stays exactly as claude wrote it', async () => {
  const state = scratch();
  const folder = scratch();
  const unknown = JSON.stringify({ type: 'result', subtype: 'error_unknown', is_error: true, errors: ['usage limit: resets at 5pm'], total_cost_usd: 0.2, num_turns: 4 });
  answer(state, { stdout: [init, unknown].join('\n') + '\n', code: 1 });
  const log = join(folder, 'l');
  const r = await runAgent({ ...run, cwd: folder, log }, { env: fakeClaudeEnv(state) });
  assert.deepEqual([r.ending, r.detail, r.cost, r.turns], ['paused', 'usage limit: resets at 5pm', 0.2, 4]);
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
