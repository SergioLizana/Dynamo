// `claude`, run by dynamo itself. DYNAMO_CLAUDE, a JSON array with a program and its first arguments, takes its place: the
// tests put the fake there (tests/fake-claude.ts) and run with no real claude on the PATH. `runAgent` is the edge the loop
// gets as a parameter: it runs one agent in its copy, its stream going to the log as it arrives, and returns how it ended.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { agentArgs, parseStream } from './agents.ts';
import type { AgentResult, AgentRun } from './agents.ts';
import { endOf } from './checks.ts';
import { exec, execToFile, type Options, type Result } from './exec.ts';
import { watchForResult } from './logwatch.ts';

// `graceMs` is how long an agent may stay alive after its result is in the log (30 s); a test shortens it.
export type AgentOptions = Options & { graceMs?: number };
export type RunAgent = (run: AgentRun, options?: AgentOptions) => Promise<AgentResult>;

const GRACE_MS = 30_000;

function program(options: Options): string[] {
  const fake = (options.env ?? process.env).DYNAMO_CLAUDE;
  return fake ? JSON.parse(fake) : ['claude'];
}

export function claude(args: string[], options: Options = {}): Result {
  return exec(program(options), args, options);
}

// The log is claude's stdout itself, so it can be watched while the agent works; the result is read back from it when the
// agent ends. The ending comes from the stream, not from the exit code (a spent budget exits 1 with a full result). When
// there is no result line, the exit code and the end of stderr say why the process gave none (not on the PATH, killed, a
// usage limit): they go to the detail and, as a last line, to the log, so the log keeps the whole raw end of the agent.
// An agent still running at `run.timeoutMs` is closed with every process it started (the same signal as the grace close):
// with no result line in its log it ends as `timeout`, with the reason as a last line of the log; one that already wrote
// its result keeps it, the work is done.
// The log is watched while the agent runs: an agent whose result is there but whose process is still alive `graceMs` later
// (a shell it started keeps it from ending: a Builder once stayed 9 minutes) is closed with its tree, and the run goes on
// with the result read from the log, which is already complete.
export const runAgent: RunAgent = async (run, options = {}) => {
  mkdirSync(dirname(run.log), { recursive: true });
  const { graceMs = GRACE_MS, ...rest } = options;
  const closing = new AbortController();
  const limit = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const limitTimer = setTimeout(() => { limit.abort(); closing.abort(); }, run.timeoutMs);
  const signal = rest.signal ? AbortSignal.any([rest.signal, closing.signal]) : closing.signal;
  const running = execToFile(program(options), agentArgs(run), run.log, { ...rest, signal, cwd: run.cwd, input: run.prompt });
  const stop = watchForResult(run.log, () => { timer = setTimeout(() => closing.abort(), graceMs); }, Math.min(500, graceMs));
  const r = await running.finally(() => { stop(); clearTimeout(timer); clearTimeout(limitTimer); });
  const result = parseStream(readFileSync(run.log, 'utf8'));
  if (limit.signal.aborted && result.turns === null && result.ending === 'unknown') {
    const detail = `no result after ${Number((run.timeoutMs / 60_000).toFixed(2))} min, closed with its processes`;
    appendFileSync(run.log, JSON.stringify({ type: 'dynamo', subtype: 'timeout', detail }) + '\n');
    return { ...result, ending: 'timeout', detail };
  }
  if (result.turns !== null || result.ending !== 'unknown') return result;
  const end = endOf({ stdout: '', stderr: r.stderr });
  appendFileSync(run.log, JSON.stringify({ type: 'dynamo', subtype: 'process_end', exit_code: r.code, stderr: end }) + '\n');
  return { ...result, detail: `${result.detail}; claude exited ${r.code}: ${end}` };
};
