// The automatic check as data (`project.checks` of factory.json): the commands, the `<base>` in them, and the report of
// what they did. Pure but for `runChecks`, the one loop that runs them (verify and merge), without blocking.
import type { Deps, Output } from './cli.ts';

export type Check = { command: string; code: number; output: string };

// How much of the end of a check's output the report keeps: enough for the summary line of a test run or a lint.
export const END = 300;

export function parseChecks(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((c) => typeof c === 'string' && c.trim() !== '')) {
    throw new Error('factory.json has no checks (project.checks must be a list of commands): nothing is counted as passed; run /dynamo:setup to bring factory.json up to date');
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

// The tests a `node --test` run reports as failed, in the «failing tests:» section it prints at the end of the run: each
// as `file:line:column name`, once. Read from the whole output, since a long stack trace under each test is what cuts
// the end of it. [] when there is no such section (another runner, or a command that is not a test run).
export function failedTests(text: string): string[] {
  const found = new Set<string>();
  const at = /^test at (\S+)\n✖ (.+?) \(\d+(?:\.\d+)?ms\)$/gm;
  for (const m of text.replace(/\r\n/g, '\n').matchAll(at)) found.add(`${m[1]} ${m[2]}`);
  return [...found];
}

// How many failed tests the report names before it says how many more there are.
const NAMED = 30;

// What a failed command reports: the names of its failed tests first (they are what the next round must find), then the
// end of its output. A command that passed, or that names no failed test, reports just the end of its output.
function outputOf(r: { stdout: string; stderr: string }, code: number): string {
  const names = code === 0 ? [] : failedTests(r.stdout);
  if (names.length === 0) return endOf(r);
  const more = names.length > NAMED ? [`… and ${names.length - NAMED} more`] : [];
  const list = [`failed tests (${names.length}):`, ...names.slice(0, NAMED).map((n) => `- ${n}`), ...more];
  return [...list, endOf(r)].filter((l) => l !== '').join('\n');
}

// The most one command of the check may run, in minutes (`project.checkTimeoutMinutes` of factory.json): a number above 0,
// with no default in the code, so a project that has not decided how long its check may take does not run it without a limit.
export function checkTimeoutOf(project: Record<string, unknown>): number {
  const value = project.checkTimeoutMinutes;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error('factory.json has no project.checkTimeoutMinutes (a number of minutes above 0): the check would have no time limit; run /dynamo:setup to bring factory.json up to date');
  }
  return value;
}

// The loop both verify and merge run: every command in `cwd`, `<base>` replaced by `sha`, the exit code and the end of the
// output of each. A command still running after `timeoutMinutes` is closed with everything it started and fails with
// «timed out after N min» in its output. It does not stop at the first failure; deciding what a failure means is the
// caller's. While a command runs the caller's process is free (the commands themselves still go one after another).
export async function runChecks(commands: string[], sha: string, cwd: string, exec: Deps['exec'], timeoutMinutes: number): Promise<Check[]> {
  const checks: Check[] = [];
  for (const command of commands) {
    const [program, ...rest] = words(withBase(command, sha));
    const r = await exec([program], rest, { cwd, timeoutMs: timeoutMinutes * 60_000 });
    if (!r.timedOut) {
      checks.push({ command, code: r.code, output: outputOf(r, r.code) });
      continue;
    }
    const lines = [`timed out after ${timeoutMinutes} min`, outputOf(r, 1)].filter((l) => l !== '');
    checks.push({ command, code: r.code === 0 ? 1 : r.code, output: lines.join('\n') });
  }
  return checks;
}

export function report(base: string, checks: Check[]): Output {
  return { ok: checks.every((c) => c.code === 0), base, checks };
}
