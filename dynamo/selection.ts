// The test selector's answer (#320) as data: what it is asked, how its answer is applied to the checks and how what ran is
// put back in the order of `project.checks`. Pure: data in, data out. The agent itself is run by selecting.ts, and the
// commands by runChecks (checks.ts). What passes is still the exit codes of the commands dynamo runs, never the answer.
import type { Check } from './checks.ts';
import { words } from './checks.ts';

// The seconds and the answer of one run of the selector, `answer` null when it did not end well (non-zero exit, a timeout,
// no result): the checks then run as they are. The caller of `select` is the loop (loop.ts), which also counts its cost.
export type Pick = { answer: unknown; seconds: number };
export type Select = (input: { base: string; files: string[]; commands: string[] }) => Promise<Pick>;

// The shape of the answer, for `--json-schema`: one entry per check, in the order they were given. `command` is only read
// when the action is `narrowed`.
export const SELECTOR_SCHEMA = {
  type: 'object',
  properties: {
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: { action: { type: 'string', enum: ['unchanged', 'narrowed', 'skipped'] }, command: { type: 'string' } },
        required: ['action'],
      },
    },
  },
  required: ['checks'],
};

// What each check will run: `run` is the command (as in factory.json, `<base>` not yet replaced) or null when the selector
// skipped it; `command` is always the check as the project wrote it.
export type Plan = { command: string; run: string | null };

// The selector's answer applied to the checks. A check stays as it is when its entry is `unchanged`, is not an entry of the
// shape, or narrows to a command of another program (the guard: a narrowed command starts with the program of the
// original). An answer that is not the shape (not an object, no list, not one entry per check) leaves every check as it is.
export function applySelection(commands: string[], answer: unknown): Plan[] {
  const whole = commands.map((command): Plan => ({ command, run: command }));
  const entries = typeof answer === 'object' && answer !== null ? (answer as Record<string, unknown>).checks : undefined;
  if (!Array.isArray(entries) || entries.length !== commands.length) return whole;
  return whole.map((plan, i): Plan => {
    const entry: unknown = entries[i];
    const { action, command } = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
    if (action === 'skipped') return { ...plan, run: null };
    if (action !== 'narrowed' || typeof command !== 'string') return plan;
    const [program] = words(command);
    return program !== undefined && program === words(plan.command)[0] ? { ...plan, run: command } : plan;
  });
}

// The checks of Verify in the order of the project's list: what ran (`ran`, in the order of the plan's commands that were run,
// each as runChecks gave it with the command that ran) and what the selector skipped, which passed with no time.
export const SKIPPED = 'skipped by the selector';
export function assemble(plan: Plan[], ran: Check[]): Check[] {
  let next = 0;
  return plan.map((p) => (p.run === null ? { command: p.command, code: 0, output: SKIPPED, seconds: 0, skipped: true } : ran[next++]));
}

// What the selector is told: the files the change touches against `<base>` and the checks, to answer one entry for each.
export function selectorPrompt(base: string, files: string[], commands: string[]): string {
  return [
    `The change: the files it touches against ${base} (${files.length}), one per line:`,
    ...files.map((f) => `- ${f}`),
    '',
    'The checks of the project, in order, each as the project wrote it (`<base>` is replaced by dynamo before the command runs; keep it in what you write):',
    ...commands.map((c, i) => `${i + 1}. ${c}`),
    '',
    'Answer with the structured reply: `checks`, one entry for each check in the same order, with `action` unchanged, narrowed (and then `command`, the narrowed command) or skipped.',
  ].join('\n');
}
