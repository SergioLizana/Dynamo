// The automatic check as data (`project.checks` of factory.json): the commands, the `<base>` in them, and the report of
// what they did. Pure: the subcommand `verify` runs them.
import type { Output } from './cli.ts';

export type Check = { command: string; code: number; output: string };

// How much of the end of a check's output the report keeps: enough for the summary line of a test run or a lint.
export const END = 300;

export function parseChecks(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((c) => typeof c === 'string' && c.trim() !== '')) {
    throw new Error('factory.json has no checks (project.checks must be a list of commands): nothing is counted as passed');
  }
  return value;
}

// `<base>` is the sha of the merge-base, so the check compares with where the branch started, not with where the base is.
export function withBase(command: string, sha: string): string {
  return command.split('<base>').join(sha);
}

// A command is a program and its arguments split on spaces: it runs without a shell, so the same on every system, and
// has no quotes, pipes or redirections.
export function words(command: string): string[] {
  return command.split(/\s+/).filter((w) => w !== '');
}

export function endOf(r: { stdout: string; stderr: string }): string {
  const text = (r.stdout + r.stderr).replace(/\r\n/g, '\n').trim();
  return text.length <= END ? text : '…' + text.slice(text.length - (END - 1));
}

export function report(base: string, checks: Check[]): Output {
  return { ok: checks.every((c) => c.code === 0), base, checks };
}
