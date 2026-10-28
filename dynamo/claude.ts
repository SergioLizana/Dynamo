// `claude`, run by dynamo itself. DYNAMO_CLAUDE, a JSON array with a program and its first arguments, takes its place: the
// tests put the fake there (tests/fake-claude.ts) and run with no real claude on the PATH. `runAgent` is the edge the loop
// gets as a parameter: it runs one agent in its copy, keeps the whole stream in the log, and returns how it ended.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { agentArgs, parseStream } from './agents.ts';
import type { AgentResult, AgentRun } from './agents.ts';
import { endOf } from './checks.ts';
import { exec, type Options, type Result } from './exec.ts';

export type RunAgent = (run: AgentRun, options?: Options) => AgentResult;

export function claude(args: string[], options: Options = {}): Result {
  const fake = (options.env ?? process.env).DYNAMO_CLAUDE;
  return exec(fake ? JSON.parse(fake) : ['claude'], args, options);
}

// The ending comes from the stream, not from the exit code (a spent budget exits 1 with a full result). When there is no
// result line, the exit code and the end of the output say why the process gave none (not on the PATH, killed, refused).
export const runAgent: RunAgent = (run, options = {}) => {
  const r = claude(agentArgs(run), { ...options, cwd: run.cwd, input: run.prompt });
  mkdirSync(dirname(run.log), { recursive: true });
  writeFileSync(run.log, r.stdout);
  const result = parseStream(r.stdout);
  if (result.turns !== null || result.ending !== 'error') return result;
  return { ...result, detail: `${result.detail}; claude exited ${r.code}: ${endOf(r)}` };
};
