// `claude`, run by dynamo itself. DYNAMO_CLAUDE, a JSON array with a program and its first arguments, takes its place: the
// tests put the fake there (tests/fake-claude.ts) and run with no real claude on the PATH. `runAgent` is the edge the loop
// gets as a parameter: it runs one agent in its copy, its stream going to the log as it arrives, and returns how it ended.
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { agentArgs, parseStream } from './agents.ts';
import type { AgentResult, AgentRun } from './agents.ts';
import { endOf } from './checks.ts';
import { exec, execToFile, type Options, type Result } from './exec.ts';

export type RunAgent = (run: AgentRun, options?: Options) => Promise<AgentResult>;

function program(options: Options): string[] {
  const fake = (options.env ?? process.env).DYNAMO_CLAUDE;
  return fake ? JSON.parse(fake) : ['claude'];
}

export function claude(args: string[], options: Options = {}): Result {
  return exec(program(options), args, options);
}

// The log is claude's stdout itself, so it can be watched while the agent works; the result is read back from it when the
// agent ends. The ending comes from the stream, not from the exit code (a spent budget exits 1 with a full result). When
// there is no result line, the exit code and the end of stderr say why the process gave none (not on the PATH, killed).
export const runAgent: RunAgent = async (run, options = {}) => {
  mkdirSync(dirname(run.log), { recursive: true });
  const r = await execToFile(program(options), agentArgs(run), run.log, { ...options, cwd: run.cwd, input: run.prompt });
  const result = parseStream(readFileSync(run.log, 'utf8'));
  if (result.turns !== null || result.ending !== 'error') return result;
  return { ...result, detail: `${result.detail}; claude exited ${r.code}: ${endOf({ stdout: '', stderr: r.stderr })}` };
};
