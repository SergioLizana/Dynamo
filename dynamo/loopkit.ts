// What the steps of one ticket's loop (loop.ts) share: what the run knows of the ticket so far, and the small things that
// move it: the file that says where the run is, the copy, and the stop that sends the ticket to Needs Human.
import type { BuilderAnswer, ReviewerAnswer, Ticket } from './briefs.ts';
import { card } from './card.ts';
import type { Check } from './checks.ts';
import type { RunAgent } from './claude.ts';
import type { Deps } from './cli.ts';
import { exit } from './cli.ts';
import { COLUMNS } from './columns.ts';
import { copy } from './copy.ts';
import type { Hold } from './holds.ts';
import { writeHold } from './holds.ts';
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
};

export type Loop = {
  n: number; title: string; deps: Deps; agent: RunAgent; wait: (ms: number) => Promise<void>; logs: string; main: string; startedAt: string;
  budget: Record<'builder' | 'reviewer', number>; minutes: Record<'builder' | 'reviewer', number>;
};

// The ticket's file says where the run is: it is rewritten at every phase and every agent.
export function mark(loop: Loop, st: State, to: Stage = st.stage): void {
  st.stage = to;
  writeHold(loop.main, loop.n, {
    pid: process.pid, startedAt: loop.startedAt, round: st.round, phase: st.stage, sessions: st.sessions,
    failed: st.failed, spent: st.spent, builder: st.builder, review: st.review, checks: st.checks, resetsAt: st.resetsAt,
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
  return { stoppedAt: e instanceof Stop ? e.stoppedAt : st.stage, reason, left: st.copy === null ? null : `the copy ${st.copy} and the branch ${st.branch}` };
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
  return { n: loop.n, title: loop.title, repo, base, copy: String(st.copy), branch: String(st.branch) };
}
