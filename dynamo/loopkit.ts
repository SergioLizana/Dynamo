// What the steps of one ticket's loop (loop.ts) share: what the run knows of the ticket so far, and the small things that
// move it: the file that says where the run is, the copy, and the stop that sends the ticket to Needs Human.
import type { BuilderAnswer, ReviewerAnswer, Ticket } from './briefs.ts';
import { languageOf } from './briefs.ts';
import { card } from './card.ts';
import type { Check } from './checks.ts';
import type { RunAgent } from './claude.ts';
import type { Deps } from './cli.ts';
import { exit } from './cli.ts';
import { COLUMNS } from './columns.ts';
import { afterNotice, readArgs } from './comments.ts';
import { copy } from './copy.ts';
import type { Hold } from './holds.ts';
import { writeHold } from './holds.ts';
import type { Level, Levels } from './levels.ts';
import { levelOf } from './levels.ts';
import { note } from './notes.ts';
import type { Stage } from './rounds.ts';
import type { Facts, Spent } from './runs.ts';
import { Stop } from './stops.ts';

// What the run knows so far: the comment is written from it whether the ticket merged or stopped, and the file of the ticket
// keeps it for a run that goes on.
export type State = {
  round: number; stage: Stage; merged: boolean; head: string | null; copy: string | null; branch: string | null; failed: string | null;
  // The commit Verify passed (the copy's HEAD) and, once merged, why the merge ran no check; neither is kept in the ticket's
  // file: a run that goes on has no record of what Verify passed, so its merge runs the checks.
  verified: string | null; mergeSkipped: string | null;
  checks: Check[] | null; builder: BuilderAnswer | null; review: ReviewerAnswer | null; spent: Spent[]; resetsAt: string | null; sessions: Hold['sessions'];
  // The Builder stopped to ask the human; only the file written at that stop says it (a run that goes on starts with it off).
  asked: boolean;
};

export type Loop = {
  n: number; title: string; deps: Deps; agent: RunAgent; wait: (ms: number) => Promise<void>; logs: string; main: string; startedAt: string;
  budget: Record<'builder' | 'reviewer', number>; minutes: Record<'builder' | 'reviewer', number>;
  // The model and effort of every level, and the level of this ticket (read once, at the start, from its body: its rounds keep it).
  levels: Levels; level: Level;
};

// The level of ticket n: the `Level:` line of its body, `high` when it has none. The body that cannot be read is an error, not
// a silent `high`.
export function readLevel(deps: Deps, repo: string, n: number): Level {
  const view = deps.gh(['issue', 'view', String(n), '-R', repo, '--json', 'body']);
  if (view.code !== 0) throw new Error(`the body of #${n} could not be read: ${(view.stderr.trim() || view.stdout.trim()) || `gh exited ${view.code}`}`);
  let body: unknown;
  try { body = (JSON.parse(view.stdout) as Record<string, unknown> | null)?.body; } catch { body = undefined; }
  if (body !== undefined && typeof body !== 'string') throw new Error(`the body of #${n} is not text`);
  return levelOf(body ?? null);
}

// What the human wrote on ticket n after the notice of the run, for the Builder that asked: their comments, oldest first. A read
// that fails stops the ticket as asked again, so that its conversation is kept for the next launch.
export function readAnswers(deps: Deps, repo: string, n: number): string[] {
  const view = deps.gh(readArgs(repo, n));
  try {
    if (view.code !== 0) throw new Error(view.stderr.trim() || view.stdout.trim() || `gh exited ${view.code}`);
    return afterNotice(view.stdout);
  } catch (e) {
    throw new Stop('build', `the comments of #${n} could not be read: ${e instanceof Error ? e.message : String(e)}`, true);
  }
}

// The ticket's file says where the run is: it is rewritten at every phase and every agent.
export function mark(loop: Loop, st: State, to: Stage = st.stage, stopped = false): void {
  st.stage = to;
  writeHold(loop.main, loop.n, {
    pid: process.pid, startedAt: loop.startedAt, round: st.round, phase: st.stage, sessions: st.sessions,
    failed: st.failed, spent: st.spent, builder: st.builder, review: st.review, checks: st.checks, resetsAt: st.resetsAt, stopped, asked: st.asked,
  });
}

// A ticket that stopped goes to Needs Human with its reason, noted in its log; what the result comment says of it.
export async function stopped(loop: Loop, st: State, e: unknown): Promise<NonNullable<Facts['stop']>> {
  let reason = e instanceof Error ? e.message : String(e);
  const moved = await exit(() => card([String(loop.n), COLUMNS.needsHuman], loop.deps));
  if (moved.code !== 0) reason += `
(the card did not move to ${COLUMNS.needsHuman}: ${JSON.stringify(moved.out)})`;
  else note(loop.logs, { step: 'column', round: st.round, column: COLUMNS.needsHuman });
  note(loop.logs, { step: 'stopped', round: st.round, text: reason });
  return {
    stoppedAt: e instanceof Stop ? e.stoppedAt : st.stage, reason, left: st.copy === null ? null : `the copy ${st.copy} and the branch ${st.branch}`,
    asked: e instanceof Stop && e.asked,
  };
}

// The copy is made once, in round 1: round 2 works on the same copy and branch, so the ticket keeps one branch.
export async function makeCopy(loop: Loop, repo: string, base: string, st: State): Promise<Ticket> {
  const c = await exit(() => copy(['add', String(loop.n)], loop.deps));
  if (c.code !== 0 || typeof c.out.path !== 'string' || typeof c.out.branch !== 'string') {
    throw new Stop('build', `no copy was made: ${JSON.stringify(c.out)}`);
  }
  st.copy = c.out.path;
  st.branch = c.out.branch;
  return ticket(loop, repo, base, st);
}

export function ticket(loop: Loop, repo: string, base: string, st: State): Ticket {
  return { n: loop.n, title: loop.title, repo, base, copy: String(st.copy), branch: String(st.branch), language: languageOf(loop.deps.factory().project) };
}
