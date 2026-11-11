// One run of a ticket as data: the budgets it takes from factory.json, and its result comment. Pure: the
// subcommand `run` reads the config and posts the comment. The comment starts with «run · », as the run workflow's did,
// so `dynamo report` reads it as the ticket's result (releases.ts, `lastResult`).
import type { Check } from './checks.ts';
import type { Output } from './cli.ts';
import type { Stage } from './rounds.ts';
import { ROUNDS } from './rounds.ts';

// The most one run of an agent may spend, in USD (`project.budgetUsd.<agent>` of factory.json; `project` is its block): a
// number above 0.
export function budgetOf(project: Record<string, unknown>, agent: string): number {
  const block = project.budgetUsd;
  const value = typeof block === 'object' && block !== null ? (block as Record<string, unknown>)[agent] : undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`factory.json has no project.budgetUsd.${agent} (a number of USD above 0)`);
  return value;
}

// The most one run of an agent may take, in minutes (`project.timeoutMinutes.<agent>` of factory.json): a number above 0,
// required as the budget is, with no default here (each project sets its own).
export function timeoutOf(project: Record<string, unknown>, agent: string): number {
  const block = project.timeoutMinutes;
  const value = typeof block === 'object' && block !== null ? (block as Record<string, unknown>)[agent] : undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`factory.json has no project.timeoutMinutes.${agent} (a number of minutes above 0)`);
  return value;
}

// The row of ticket n in what `dynamo board` returned, unknown until checked: its title, whether it is ready and why not.
export function rowOf(out: Output, n: number): { title: string; ready: boolean; why: string | null } | null {
  const rows = Array.isArray(out.tickets) ? out.tickets : [];
  const row: unknown = rows.find((r) => typeof r === 'object' && r !== null && (r as Record<string, unknown>).number === n);
  if (typeof row !== 'object' || row === null) return null;
  const { title, ready, why } = row as Record<string, unknown>;
  if (typeof ready !== 'boolean') return null;
  return { title: typeof title === 'string' ? title : '', ready, why: typeof why === 'string' ? why : null };
}

// The commands of what `dynamo verify` returned, or null when it ran none (it failed before, with an `error`).
export function checksOf(out: Output): Check[] | null {
  const list: unknown = out.checks;
  if (!Array.isArray(list)) return null;
  const checks = list.filter((c: unknown): c is Check => {
    const o = typeof c === 'object' && c !== null ? (c as Record<string, unknown>) : {};
    return typeof o.command === 'string' && typeof o.code === 'number' && typeof o.output === 'string';
  });
  return checks.length === list.length ? checks : null;
}

// What failed in a check, for the Builder of the next round or the human: each failing command with its code and the end
// of its output, or the error that kept the check from running.
export function failedChecks(out: Output): string {
  const checks = checksOf(out);
  if (checks === null) return typeof out.error === 'string' ? out.error : JSON.stringify(out);
  return checks.filter((c) => c.code !== 0).map((c) => `${c.command} → exit ${c.code}: ${c.output}`).join('\n') || 'no command failed';
}

// What one agent run spent; the comment gives the sums.
export type Spent = { cost: number | null; turns: number | null };

export type Facts = {
  base: string;
  merged: boolean;
  rounds: number;
  // The commands of the last check that ran, null when none did.
  checks: Check[] | null;
  // Why the merge ran no check (its tree was the one Verify passed), null when it ran them.
  mergeSkipped: string | null;
  verdict: 'PASS' | 'FAIL' | null;
  report: string | null;
  spent: Spent[];
  noTrace: string | null;
  outOfTicket: string | null;
  // What was removed from the copy because git did not track it (cleaning.ts); the comment names it only when there is any.
  removed: string[];
  // `asked`: the Builder stopped to ask the human, or the Reviewer failed it in the last round (loop.ts keeps its conversation, the copy and the branch).
  stop: { stoppedAt: Stage; reason: string; left: string | null; asked?: boolean } | null;
};

// Lines after the first are indented, so no line of an agent's text can start a field of the comment.
const block = (s: string): string => s.replace(/\r\n/g, '\n').trim().split('\n').join('\n  ');
const filled = (s: string | null): string | null => (s === null || s.trim() === '' ? null : s);

export function total(spent: Spent[]): { cost: number; turns: number } {
  return {
    cost: spent.reduce((sum, s) => sum + (s.cost ?? 0), 0),
    turns: spent.reduce((sum, s) => sum + (s.turns ?? 0), 0),
  };
}

export function resultComment(f: Facts, n: number): string {
  const { cost, turns } = total(f.spent);
  const unknown = f.spent.filter((s) => s.cost === null || s.turns === null).length;
  const checks = f.checks === null ? 'not run' : f.checks.map((c) => `${c.command} → ${c.code}`).join('; ');
  const reviewer = f.verdict === null ? 'not run or no verdict' : f.report === null ? f.verdict : `${f.verdict}\n  ${block(f.report)}`;
  const lines = [
    `run · ${f.merged ? `PASS and merged into ${f.base}` : 'not merged'}`,
    `Rounds: ${f.rounds}/${ROUNDS}`,
    `Checks: ${checks}`,
    ...(f.mergeSkipped === null ? [] : [`Merge checks: skipped, ${block(f.mergeSkipped)}`]),
    `Reviewer: ${reviewer}`,
    `Cost: ${cost.toFixed(4)} USD (the sum of total_cost_usd of ${f.spent.length} agent runs${unknown ? `; ${unknown} gave none` : ''})`,
    `Turns: ${turns} (the sum of num_turns)`,
    `No trace: ${block(filled(f.noTrace) ?? 'none')}`,
    `Out of the ticket (for the backlog): ${block(filled(f.outOfTicket) ?? 'nothing')}`,
    ...(f.removed.length === 0 ? [] : [`Removed from the copy (git did not track it): ${block(f.removed.join(', '))}`]),
  ];
  if (f.stop !== null) {
    // A stop at merge keeps the copy, the branch and the ticket's file (loop.ts): the relaunch runs only the merge, so nothing is removed.
    const relaunch = f.stop.stoppedAt === 'merge'
      ? 'To relaunch: take the card out of *Needs Human* (`guides/github-board.md` of the plugin) and launch '
        + `\`/dynamo:autopilot ${n}\`: the copy and the branch are kept, and only the merge is retried (no Builder, no Reviewer).`
      // A Builder that asked keeps its conversation too: it goes on with the comments written after this notice.
      : f.stop.asked === true && f.stop.stoppedAt === 'review'
        ? 'To relaunch: answer or guide in a comment of this ticket if you want, take the card out of *Needs Human* (`guides/github-board.md` of the plugin) and launch '
          + `\`/dynamo:autopilot ${n}\`: the copy, the branch and the Builder's conversation are kept, and the Builder goes on with the Reviewer's verdict and what you write here after this notice.`
        : f.stop.asked === true
        ? 'To relaunch: answer in a comment of this ticket, take the card out of *Needs Human* (`guides/github-board.md` of the plugin) and launch '
          + `\`/dynamo:autopilot ${n}\`: the copy, the branch and the Builder's conversation are kept, and the Builder goes on with what you write here after this notice.`
        : 'To relaunch: take the card out of *Needs Human* (`guides/github-board.md` of the plugin), remove what «Left» names '
          + `(\`git worktree remove\`, then \`git branch -D\`), and launch \`/dynamo:autopilot ${n}\`.`;
    lines.push(`Reason: ${block(f.stop.reason)}`, `Stopped at: ${f.stop.stoppedAt}`, `Left: ${f.stop.left ?? 'nothing'}`, relaunch);
  }
  return lines.join('\n') + '\n';
}
