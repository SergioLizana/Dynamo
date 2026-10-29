// One ticket of `dynamo run` through the loop, in its own copy: the card at every step, the Builder (`claude -p --agent
// builder`), `dynamo verify`, the reviewer (read-only by the tools of its agent file), at most two rounds on the same
// copy and branch, `dynamo merge`, and one result comment with the cost and turns of its agents. A ticket that stops
// goes to Needs Human with its reason; one whose agent ended in a way dynamo does not know (a usage limit) is paused: no
// round is spent, its card stays where it is and its one comment shows the raw end of the agent. Each agent's stream goes to its own log as it arrives, `.claude/worktrees/logs/<n>/<agent>-<round>
// .jsonl` of the main folder (ignored by git with the copies), and a new run of the ticket starts with that folder empty.
// Several tickets run this at once: only the agents wait, and `dynamo merge` takes its lock.
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { AgentResult } from './agents.ts';
import { board } from './board.ts';
import type { BuilderAnswer, ReviewerAnswer, Ticket } from './briefs.ts';
import { BUILDER_SCHEMA, REVIEWER_SCHEMA, builderPrompt, readBuilder, readReviewer, reviewerPrompt } from './briefs.ts';
import { card } from './card.ts';
import type { Check } from './checks.ts';
import type { RunAgent } from './claude.ts';
import type { Deps, Output } from './cli.ts';
import { exit } from './cli.ts';
import { comment } from './comment.ts';
import { copy } from './copy.ts';
import { parseWorktrees } from './copies.ts';
import { merge } from './merge.ts';
import { settings } from './merging.ts';
import { note, readLog } from './notes.ts';
import { pausedComment, rawEnd } from './pauses.ts';
import { oneLine } from './releases.ts';
import type { Next, Outcome, Stage } from './rounds.ts';
import { next } from './rounds.ts';
import type { Columns, Facts, Spent } from './runs.ts';
import { budgetOf, checksOf, columnsOf, failedChecks, resultComment, rowOf, total } from './runs.ts';
import { Pause, Stop } from './stops.ts';
import { verify } from './verify.ts';

// What the run knows so far: the comment is written from it whether the ticket merged or stopped.
type State = {
  round: number; stage: Stage; merged: boolean; head: string | null; copy: string | null; branch: string | null;
  checks: Check[] | null; builder: BuilderAnswer | null; review: ReviewerAnswer | null; spent: Spent[];
};

type Loop = {
  n: number; title: string; deps: Deps; agent: RunAgent; columns: Columns; budget: { builder: number; reviewer: number }; logs: string;
};

export async function runTicket(n: number, deps: Deps): Promise<Output> {
  if (deps.agent === undefined) throw new Error('run was not given the claude edge');
  const factory = deps.factory();
  const s = settings(factory.project);
  const loop: Loop = {
    n, title: '', deps, agent: deps.agent, columns: columnsOf(factory), logs: '',
    budget: { builder: budgetOf(factory, 'builder'), reviewer: budgetOf(factory, 'reviewer') },
  };

  // Only a ticket that `dynamo board` gives as ready is started: nothing else is read or moved before.
  const read = await exit(() => board([String(n)], deps));
  const row = read.code === 0 ? rowOf(read.out, n) : null;
  if (row === null) return { ok: false, ticket: n, started: false, why: `dynamo board exited ${read.code}: ${oneLine(JSON.stringify(read.out))}` };
  if (!row.ready) return { ok: false, ticket: n, started: false, why: row.why };
  loop.title = row.title;

  loop.logs = join(mainFolder(deps), '.claude', 'worktrees', 'logs', String(n));
  rmSync(loop.logs, { recursive: true, force: true });
  mkdirSync(loop.logs, { recursive: true });
  note(loop.logs, { step: 'start', round: 1, text: row.title });

  const st: State = { round: 1, stage: 'build', merged: false, head: null, copy: null, branch: null, checks: null, builder: null, review: null, spent: [] };
  let stop: Facts['stop'] = null;
  let paused: Pause | null = null;
  try {
    await steps(loop, s.repo, s.base, st);
  } catch (e) {
    if (e instanceof Pause) {
      paused = e;
      note(loop.logs, { step: 'paused', round: st.round, text: e.message });
    } else {
      stop = await stopped(loop, st, e);
    }
  }

  const file = join(loop.logs, 'comment.md');
  writeFileSync(file, paused === null ? resultComment({
    base: s.base, merged: st.merged, rounds: st.round, checks: st.checks, verdict: st.review?.verdict ?? null, report: st.review?.report ?? null,
    spent: st.spent, noTrace: st.builder?.noTrace ?? null, outOfTicket: st.builder?.outOfTicket ?? null, stop,
  }, n) : pausedComment({
    stoppedAt: paused.stoppedAt, reason: paused.message, round: st.round, log: `.claude/worktrees/logs/${n}/${basename(paused.log)}`, raw: rawEnd(readLog(paused.log)),
    left: st.copy === null || st.branch === null ? null : { copy: st.copy, branch: st.branch },
  }, n));
  const posted = await exit(() => comment([String(n), '--body-file', file], deps));
  const { cost, turns } = total(st.spent);
  const why = paused ?? stop;
  return {
    ok: why === null && posted.code === 0, ticket: n, merged: st.merged, rounds: st.round, ...(st.head === null ? {} : { head: st.head }),
    ...(why === null ? {} : { stoppedAt: why.stoppedAt, reason: oneLine(paused?.message ?? stop?.reason ?? '') }), ...(paused === null ? {} : { paused: true }),
    cost, turns, logs: `.claude/worktrees/logs/${n}`,
    comment: posted.code === 0 ? posted.out.url ?? null : null, ...(posted.code === 0 ? {} : { commentError: oneLine(JSON.stringify(posted.out)) }),
  };
}

// A ticket that stopped goes to Needs Human with its reason, noted in its log; what the result comment says of it.
async function stopped(loop: Loop, st: State, e: unknown): Promise<NonNullable<Facts['stop']>> {
  let reason = e instanceof Error ? e.message : String(e);
  const moved = await exit(() => card([String(loop.n), loop.columns.needsHuman], loop.deps));
  if (moved.code !== 0) reason += `
(the card did not move to ${loop.columns.needsHuman}: ${JSON.stringify(moved.out)})`;
  else note(loop.logs, { step: 'column', round: st.round, column: loop.columns.needsHuman });
  note(loop.logs, { step: 'stopped', round: st.round, text: reason });
  return { stoppedAt: e instanceof Stop ? e.stoppedAt : st.stage, reason, left: st.copy === null ? null : `the copy ${st.copy} and the branch ${st.branch}` };
}

// Build, Verify and Review until the rounds say merge or stop, then the merge. A stop is thrown.
async function steps(loop: Loop, repo: string, base: string, st: State): Promise<void> {
  const { n, deps, columns } = loop;
  const move = async (column: string) => {
    const r = await exit(() => card([String(n), column], deps));
    if (r.code !== 0) throw new Stop(st.stage, `card did not move to ${column}: ${JSON.stringify(r.out)}`);
    note(loop.logs, { step: 'column', round: st.round, column });
  };
  let go: Exclude<Next['go'], 'needsHuman' | 'paused' | 'merge'> = 'build';
  let failed: string | null = null;
  for (;;) {
    let o: Outcome;
    if (go === 'build') {
      st.stage = 'build';
      await move(columns.build);
      const t = st.copy === null ? await makeCopy(loop, repo, base, st) : ticket(loop, repo, base, st);
      const r = await agent(loop, 'builder', builderPrompt(t, st.round, failed), t.copy, st, null);
      const b = readBuilder(r);
      st.builder = b.answer ?? st.builder;
      o = b.outcome;
    } else if (go === 'verify') {
      st.stage = 'check';
      await move(columns.verify);
      const v = await exit(() => verify([String(st.copy), base], deps));
      st.checks = checksOf(v.out);
      o = { step: 'verify', code: v.code, output: failedChecks(v.out) };
      note(loop.logs, { step: 'check', round: st.round, text: v.code === 0 ? 'passed' : 'failed' });
    } else {
      st.stage = 'review';
      await move(columns.review);
      const t = ticket(loop, repo, base, st);
      const r = await agent(loop, 'reviewer', reviewerPrompt(t, st.round > 1 ? st.review?.report ?? null : null), t.copy, st);
      const v = readReviewer(r);
      st.review = v.answer;
      o = v.outcome;
    }
    const step = next(st.round, o);
    if (step.go === 'needsHuman') throw new Stop(step.stoppedAt, step.reason);
    if (step.go === 'paused') throw new Pause(step.stoppedAt, step.reason, join(loop.logs, `${step.stoppedAt === 'build' ? 'builder' : 'reviewer'}-${st.round}.jsonl`));
    if (step.go === 'merge') break;
    if (step.go === 'build') {
      st.round = step.round;
      failed = step.failed;
    }
    go = step.go;
  }

  st.stage = 'merge';
  await move(columns.verify);
  const m = await exit(() => merge([String(n)], deps));
  if (m.code !== 0) throw new Stop('merge', `dynamo merge exited ${m.code}: ${JSON.stringify(m.out)}`);
  st.merged = true;
  st.head = typeof m.out.head === 'string' ? m.out.head : null;
  await move(columns.done);
  note(loop.logs, { step: 'merged', round: st.round, text: st.head ?? '' });
}

// The copy is made once, in round 1: round 2 works on the same copy and branch, so the ticket keeps one branch.
async function makeCopy(loop: Loop, repo: string, base: string, st: State): Promise<Ticket> {
  const c = await exit(() => copy(['add', String(loop.n)], loop.deps));
  if (c.code !== 0 || typeof c.out.path !== 'string' || typeof c.out.branch !== 'string') {
    throw new Stop('build', `no copy was made: ${JSON.stringify(c.out)}`);
  }
  st.copy = c.out.path;
  st.branch = c.out.branch;
  return ticket(loop, repo, base, st);
}

function ticket(loop: Loop, repo: string, base: string, st: State): Ticket {
  return { n: loop.n, title: loop.title, repo, base, copy: String(st.copy), branch: String(st.branch) };
}

async function agent(loop: Loop, name: 'builder' | 'reviewer', prompt: string, cwd: string, st: State): Promise<AgentResult> {
  const r = await loop.agent({
    agent: name, prompt, cwd, log: join(loop.logs, `${name}-${st.round}.jsonl`),
    schema: name === 'builder' ? BUILDER_SCHEMA : REVIEWER_SCHEMA, budget: loop.budget[name], session: randomUUID(),
  });
  st.spent.push({ cost: r.cost, turns: r.turns });
  note(loop.logs, { step: 'agent', round: st.round, agent: name, ending: r.ending, cost: r.cost, turns: r.turns, ...(r.detail === null ? {} : { text: r.detail }) });
  return r;
}

// The main folder, first in git's list of copies: the logs go there even when `run` is launched from a copy.
export function mainFolder(deps: Deps): string {
  const r = deps.git(['worktree', 'list', '--porcelain']);
  const [main] = r.code === 0 ? parseWorktrees(r.stdout) : [];
  if (main === undefined) throw new Error(`git worktree list gave no folder: ${r.stderr.trim()}`);
  return main.path;
}
