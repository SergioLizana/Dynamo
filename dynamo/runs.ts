// One run of a ticket as data: the columns and budgets it takes from factory.json, and its result comment. Pure: the
// subcommand `run` reads the config and posts the comment. The comment starts with «run · », as the run workflow's did,
// so `dynamo report` reads it as the ticket's result (releases.ts, `lastResult`).
import type { Check } from './checks.ts';
import type { Output } from './cli.ts';
import { setting } from './cli.ts';
import type { Stage } from './rounds.ts';
import { ROUNDS } from './rounds.ts';

export type Columns = { build: string; verify: string; review: string; done: string; needsHuman: string };

// The columns of the phases Build, Verify and Review (`phases` of factory.json), and `columns.done` and `columns.needsHuman`.
export function columnsOf(factory: Record<string, unknown>): Columns {
  const phases = Array.isArray(factory.phases) ? factory.phases : [];
  const column = (name: string): string => {
    const phase: unknown = phases.find((p) => typeof p === 'object' && p !== null && (p as Record<string, unknown>).name === name);
    return setting(phase, `phases (${name})`, 'column');
  };
  return {
    build: column('Build'), verify: column('Verify'), review: column('Review'),
    done: setting(factory.columns, 'columns', 'done'), needsHuman: setting(factory.columns, 'columns', 'needsHuman'),
  };
}

// The most one run of an agent may spend, in USD (`budgetUsd.<agent>` of factory.json): a number above 0.
export function budgetOf(factory: Record<string, unknown>, agent: string): number {
  const block = factory.budgetUsd;
  const value = typeof block === 'object' && block !== null ? (block as Record<string, unknown>)[agent] : undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`factory.json has no budgetUsd.${agent} (a number of USD above 0)`);
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
  verdict: 'PASS' | 'FAIL' | null;
  report: string | null;
  spent: Spent[];
  noTrace: string | null;
  outOfTicket: string | null;
  stop: { stoppedAt: Stage; reason: string; left: string | null } | null;
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
    `Reviewer: ${reviewer}`,
    `Cost: ${cost.toFixed(4)} USD (the sum of total_cost_usd of ${f.spent.length} agent runs${unknown ? `; ${unknown} gave none` : ''})`,
    `Turns: ${turns} (the sum of num_turns)`,
    `No trace: ${block(filled(f.noTrace) ?? 'none')}`,
    `Out of the ticket (for the backlog): ${block(filled(f.outOfTicket) ?? 'nothing')}`,
  ];
  if (f.stop !== null) {
    lines.push(
      `Reason: ${block(f.stop.reason)}`,
      `Stopped at: ${f.stop.stoppedAt}`,
      `Left: ${f.stop.left ?? 'nothing'}`,
      'To relaunch: take the card out of *Needs Human* (documentation/github-board.md), remove what «Left» names '
        + `(\`git worktree remove\`, then \`git branch -D\`), and launch \`dynamo run ${n}\`.`,
    );
  }
  return lines.join('\n') + '\n';
}
