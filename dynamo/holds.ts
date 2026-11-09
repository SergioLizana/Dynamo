// The file that says a ticket is held by a run: `.claude/worktrees/runs/<n>.json` of the main folder (ignored by git with the
// copies). `dynamo run` writes it on taking the ticket, rewrites it at every phase and round and at every agent it starts,
// and removes it when the ticket ends, merged or in Needs Human. A ticket that paused keeps it: that run did not finish.
// It also keeps what the run knew of the ticket (what failed, what the agents spent and answered), so that a run that goes
// on from it (resumes.ts) writes the same comment as the one that died would have. Like the notes, a file that cannot be
// written never stops the ticket. `readHold` gives it back, or null when there is none or it is not what a run writes. It keeps too
// when the usage limit resets, so that a run launched before then starts no agent (`limitUntil`).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BuilderAnswer, ReviewerAnswer } from './briefs.ts';
import { asBuilder, asReviewer, isObject } from './briefs.ts';
import type { Check } from './checks.ts';
import type { Deps } from './cli.ts';
import { parseWorktrees } from './copies.ts';
import type { Stage } from './rounds.ts';
import type { Spent } from './runs.ts';
import { checksOf } from './runs.ts';

// `sessions`: the conversation id of the last Builder and of the last reviewer (null before they start). `resetsAt`: when the usage
// limit resets (ISO), set when an agent of the ticket hit it and null otherwise.
export type Hold = {
  pid: number;
  startedAt: string;
  round: number;
  phase: Stage;
  sessions: { builder: string | null; reviewer: string | null };
  // What the Builder of this round is told failed in the last one, null in round 1.
  failed: string | null;
  spent: Spent[];
  builder: BuilderAnswer | null;
  review: ReviewerAnswer | null;
  checks: Check[] | null;
  resetsAt: string | null;
};

const PHASES: Stage[] = ['start', 'build', 'check', 'review', 'merge'];

export const holdPath = (main: string, n: number): string => join(main, '.claude', 'worktrees', 'runs', `${n}.json`);

export function writeHold(main: string, n: number, hold: Hold): void {
  try {
    mkdirSync(join(main, '.claude', 'worktrees', 'runs'), { recursive: true });
    writeFileSync(holdPath(main, n), `${JSON.stringify(hold)}\n`);
  } catch { /* the ticket goes on without it */ }
}

export function removeHold(main: string, n: number): void {
  rmSync(holdPath(main, n), { force: true });
}

// The file of ticket n, unknown until checked. What a run needs to go on (pid, start, round, phase) must be right, or there
// is no file; the rest is taken as far as it is well formed and is empty otherwise.
export function readHold(main: string, n: number): Hold | null {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(holdPath(main, n), 'utf8')); } catch { return null; }
  if (!isObject(raw)) return null;
  const { pid, startedAt, round, phase } = raw;
  if (typeof pid !== 'number' || typeof startedAt !== 'string' || typeof round !== 'number' || !Number.isInteger(round) || round < 1) return null;
  if (typeof phase !== 'string' || !PHASES.includes(phase as Stage)) return null;
  const sessions = isObject(raw.sessions) ? raw.sessions : {};
  const id = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const spent = Array.isArray(raw.spent) ? raw.spent.filter((s: unknown): s is Spent => isObject(s) && (s.cost === null || typeof s.cost === 'number') && (s.turns === null || typeof s.turns === 'number')) : [];
  return {
    pid, startedAt, round, phase: phase as Stage, sessions: { builder: id(sessions.builder), reviewer: id(sessions.reviewer) },
    failed: id(raw.failed), spent, builder: asBuilder(raw.builder), review: asReviewer(raw.review), checks: checksOf({ ok: true, checks: raw.checks }),
    resetsAt: id(raw.resetsAt),
  };
}

// The reset time when the limit has not reset yet at `now` (ms), or null: the ticket may be tried.
export function limitUntil(resetsAt: string | null, now: number): string | null {
  if (resetsAt === null) return null;
  const at = Date.parse(resetsAt);
  return Number.isNaN(at) || at <= now ? null : resetsAt;
}

// The main folder, first in git's list of copies: the logs and these files go there even when `run` is launched from a copy.
export function mainFolder(deps: Deps): string {
  const r = deps.git(['worktree', 'list', '--porcelain']);
  const [main] = r.code === 0 ? parseWorktrees(r.stdout) : [];
  if (main === undefined) throw new Error(`git worktree list gave no folder: ${r.stderr.trim()}`);
  return main.path;
}
