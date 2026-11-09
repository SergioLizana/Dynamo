// One ticket of `dynamo run` through the loop, in its own copy: the card at every step, the Builder (`claude -p --agent builder`), `dynamo verify`, the reviewer
// (read-only by the tools of its agent file), at most two rounds on the same copy and branch, `dynamo merge`, with the card in Merge from the reviewer's PASS until it ends (a conflict there is one more Builder round, counted in
// the two, then Verify, Review and the merge again), and one result comment with the cost and turns of its agents. A ticket that stops goes to Needs Human with its
// reason (an agent past its time limit with no result among them: no round spent); one whose agent hit the usage limit is paused: no round is spent, its card stays
// where it is and its one comment shows when the limit resets, the cost so far and the raw end of the agent; any other end dynamo does not know is a stop. Each
// agent's stream goes to its own log as it arrives, `.claude/worktrees/logs/<n>/<agent>-<round>.jsonl` of the main folder (ignored by git with the copies), and a new
// run starts with that folder empty. Several tickets run this at once: only the agents wait, and `dynamo merge` takes its lock; while it runs the ticket has its file `runs/<n>.json` (holds.ts), which keeps the reset time of the usage limit: a ticket launched again before it is not started (no agent, no card); a ticket whose file is there and whose run is dead goes on from the phase of its file, on the same copy (resumes.ts), its Builder with `claude -p --resume <id>` and «go on where you left it», or a new Builder on the same copy if that fails. A Builder stopped by an outage of the permission check goes on the same way after a wait: no round is spent (rounds.ts).
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { AgentResult } from './agents.ts';
import { BUILDER_SCHEMA, OUTAGE_PROMPT, REVIEWER_SCHEMA, RESUME_PROMPT, builderPrompt, readBuilder, readReviewer, reviewerPrompt } from './briefs.ts';
import { card } from './card.ts';
import { checkTimeoutOf } from './checks.ts';
import type { RunAgent } from './claude.ts';
import type { Deps, Output } from './cli.ts';
import { exit } from './cli.ts';
import { COLUMNS } from './columns.ts';
import { comment } from './comment.ts';
import { limitUntil, mainFolder, readHold, removeHold } from './holds.ts';
import type { Loop, State } from './loopkit.ts';
import { makeCopy, mark, stopped, ticket } from './loopkit.ts';
import { merge } from './merge.ts';
import { settings, stopReason } from './merging.ts';
import { releaseBranch } from './working.ts';
import { note, readLog } from './notes.ts';
import { pausedComment, rawEnd } from './pauses.ts';
import { oneLine } from './releases.ts';
import { findTicket, hasMergedComment, isMerged } from './resuming.ts';
import type { Step } from './resumes.ts';
import { heldBy, stepOf, ticketRows } from './resumes.ts';
import { readLock } from './runlock.ts';
import type { Next, Outcome } from './rounds.ts';
import { OUTAGE_TRIES, OUTAGE_WAIT_MS, next, stoppedByOutage } from './rounds.ts';
import type { Facts } from './runs.ts';
import { budgetOf, checksOf, failedChecks, resultComment, rowOf, timeoutOf, total } from './runs.ts';
import { Pause, Stop } from './stops.ts';
import { verify } from './verify.ts';

export async function runTicket(n: number, deps: Deps): Promise<Output> {
  if (deps.agent === undefined) throw new Error('run was not given the claude edge');
  const factory = deps.factory();
  checkTimeoutOf(factory.project); // the check's limit is read now, not at the first check: a wrong value stops the run before anything is read or moved
  const s = settings(factory.project, releaseBranch(deps));
  const both = (of: typeof budgetOf) => ({ builder: of(factory.project, 'builder'), reviewer: of(factory.project, 'reviewer') });
  const loop: Loop = {
    n, title: '', deps, agent: deps.agent, wait: deps.wait ?? ((ms) => sleep(ms)), logs: '', main: '', startedAt: new Date().toISOString(), budget: both(budgetOf), minutes: both(timeoutOf),
  };
  // The file of a ticket whose run is alive refuses it: that run holds it. One whose run is dead is a ticket half done.
  loop.main = mainFolder(deps);
  const hold = readHold(loop.main, n);
  const live = hold === null ? null : heldBy(hold, readLock(join(loop.main, '.claude', 'worktrees', 'run.json')), Date.now(), process.pid);
  if (live !== null) return { ok: false, ticket: n, started: false, why: `#${n} is held by the run of pid ${live.pid} since ${live.since}` };
  // A ticket whose file says the usage limit has not reset yet is not touched: no agent, no card, no copy.
  const until = hold === null ? null : limitUntil(hold.resetsAt, Date.now());
  if (until !== null) return { ok: false, ticket: n, started: false, why: `#${n} paused by the usage limit, which resets at ${until}`, resetsAt: until };
  // Only a ticket that the board gives as ready (or half done, with its file) is started: nothing else is read or moved before.
  const read = await exit(() => ({ ok: true, tickets: ticketRows([n], deps) }));
  const row = read.code === 0 ? rowOf(read.out, n) : null;
  if (row === null) return { ok: false, ticket: n, started: false, why: `dynamo board exited ${read.code}: ${oneLine(JSON.stringify(read.out))}` };
  if (!row.ready) return { ok: false, ticket: n, started: false, why: row.why };
  loop.title = row.title;

  loop.logs = join(loop.main, '.claude', 'worktrees', 'logs', String(n));
  // A new ticket starts with its log folder empty; one that goes on keeps the logs of the run that died.
  if (hold === null) rmSync(loop.logs, { recursive: true, force: true });
  mkdirSync(loop.logs, { recursive: true });
  note(loop.logs, hold === null ? { step: 'start', round: 1, text: row.title } : { step: 'resumed', round: hold.round, text: `goes on from ${hold.phase}; the run of pid ${hold.pid} left it` });

  const st: State = {
    round: hold?.round ?? 1, stage: hold?.phase ?? 'build', merged: false, head: null, copy: null, branch: null, failed: hold?.failed ?? null,
    verified: null, mergeSkipped: null, checks: hold?.checks ?? null, builder: hold?.builder ?? null, review: hold?.review ?? null, spent: hold?.spent ?? [], resetsAt: null,
    sessions: hold?.sessions ?? { builder: null, reviewer: null },
  };
  mark(loop, st);
  let stop: Facts['stop'] = null, paused: Pause | null = null;
  try {
    await steps(loop, s.repo, s.base, st, hold === null ? null : stepOf(hold.phase));
  } catch (e) {
    if (e instanceof Pause) {
      paused = e;
      note(loop.logs, { step: 'paused', round: st.round, text: e.message });
    } else {
      stop = await stopped(loop, st, e);
    }
  }
  if (paused === null) removeHold(loop.main, n);
  const file = join(loop.logs, 'comment.md');
  writeFileSync(file, paused === null ? resultComment({
    base: s.base, merged: st.merged, rounds: st.round, checks: st.checks, mergeSkipped: st.mergeSkipped, verdict: st.review?.verdict ?? null, report: st.review?.report ?? null,
    spent: st.spent, noTrace: st.builder?.noTrace ?? null, outOfTicket: st.builder?.outOfTicket ?? null, stop,
  }, n) : pausedComment({
    stoppedAt: paused.stoppedAt, reason: paused.message, round: st.round, log: `.claude/worktrees/logs/${n}/${basename(paused.log)}`, raw: rawEnd(readLog(paused.log)),
    resetsAt: paused.resetsAt, spent: st.spent, left: st.copy === null || st.branch === null ? null : { copy: st.copy, branch: st.branch },
  }, n));
  // A merged ticket that goes on may already have its comment: it is posted only if it is missing.
  const there = hold !== null && st.merged && hasMergedComment(deps, s.repo, n);
  const posted = there ? { code: 0, out: { ok: true, url: null } } : await exit(() => comment([String(n), '--body-file', file], deps));
  const { cost, turns } = total(st.spent), why = paused ?? stop;
  return {
    ok: why === null && posted.code === 0, ticket: n, merged: st.merged, rounds: st.round, ...(st.head === null ? {} : { head: st.head }),
    ...(why === null ? {} : { stoppedAt: why.stoppedAt, reason: oneLine(paused?.message ?? stop?.reason ?? '') }), ...(paused === null ? {} : { paused: true, resetsAt: paused.resetsAt }),
    cost, turns, logs: `.claude/worktrees/logs/${n}`,
    comment: posted.code === 0 ? posted.out.url ?? null : null, ...(posted.code === 0 ? {} : { commentError: oneLine(JSON.stringify(posted.out)) }),
  };
}

// Build, Verify, Review and the merge until the rounds say done or stop. A stop is thrown. `from`: the step a ticket that goes
// on starts at (resumes.ts), on the branch and copy its dead run left; null for a new ticket.
async function steps(loop: Loop, repo: string, base: string, st: State, from: Step | null): Promise<void> {
  const { n, deps } = loop;
  const move = async (column: string) => {
    const r = await exit(() => card([String(n), column], deps));
    if (r.code !== 0) throw new Stop(st.stage, `card did not move to ${column}: ${JSON.stringify(r.out)}`);
    note(loop.logs, { step: 'column', round: st.round, column });
  };
  let go: Exclude<Next['go'], 'needsHuman' | 'paused' | 'done'> = from ?? 'build';
  // The merge of a ticket whose branch is already in the base does only what is missing: its card is not moved to Merge again.
  let inBase = false, newBuilder = from === 'build';
  if (from !== null) {
    const found = findTicket(deps, n);
    st.copy = found.copy; st.branch = found.branch;
    if (found.copy === null && from === 'verify') throw new Stop(st.stage, `the copy of #${n} is gone, so the ticket cannot go on from ${st.stage}`);
    inBase = from === 'merge' && found.branch !== null && isMerged(deps, found.branch, base);
  }
  for (;;) {
    let o: Outcome;
    if (go === 'build') {
      mark(loop, st, 'build');
      await move(COLUMNS.build);
      const t = st.copy === null ? await makeCopy(loop, repo, base, st) : ticket(loop, repo, base, st);
      // A Builder cut halfway goes on with its conversation; if that fails, a new one on the same copy.
      const goOn = async (session: string, prompt: string) => {
        const r = await agent(loop, 'builder', prompt, t.copy, st, session);
        if (r.ending !== 'unknown' || r.outage === true) return r;
        note(loop.logs, { step: 'resume-failed', round: st.round, text: r.detail ?? '' });
        return agent(loop, 'builder', builderPrompt(t, st.round, st.failed, true), t.copy, st);
      };
      const before = newBuilder ? st.sessions.builder : null;
      let r = before === null ? await agent(loop, 'builder', builderPrompt(t, st.round, st.failed, newBuilder), t.copy, st) : await goOn(before, RESUME_PROMPT);
      newBuilder = false;
      let b = readBuilder(r);
      for (let tries = 0; tries < OUTAGE_TRIES && stoppedByOutage(r.outage === true, b.outcome) && st.sessions.builder !== null; tries++) {
        note(loop.logs, { step: 'outage', round: st.round, text: `waits ${OUTAGE_WAIT_MS / 1000} s, try ${tries + 1} of ${OUTAGE_TRIES}` });
        await loop.wait(OUTAGE_WAIT_MS);
        r = await goOn(st.sessions.builder, OUTAGE_PROMPT);
        b = readBuilder(r);
      }
      st.builder = b.answer ?? st.builder;
      o = b.outcome;
    } else if (go === 'verify') {
      mark(loop, st, 'check');
      await move(COLUMNS.verify);
      const v = await exit(() => verify([String(st.copy), base], deps));
      st.checks = checksOf(v.out);
      // What Verify passed is the commit the copy is at; the merge compares its tree with that commit's. The Builder leaves nothing
      // uncommitted (what is merged is the branch, not the folder), so the tree Verify checked is the tree of this commit.
      const tip = v.code === 0 ? deps.git(['rev-parse', 'HEAD'], { cwd: String(st.copy) }) : null;
      st.verified = tip !== null && tip.code === 0 ? tip.stdout.trim() : null;
      o = { step: 'verify', code: v.code, output: failedChecks(v.out) };
      note(loop.logs, { step: 'check', round: st.round, text: v.code === 0 ? 'passed' : 'failed' });
    } else if (go === 'merge') {
      mark(loop, st, 'merge');
      if (!inBase) await move(COLUMNS.merge);
      inBase = false;
      const m = await exit(() => merge(st.verified === null ? [String(n)] : [String(n), '--verified', st.verified], deps));
      st.head = m.code === 0 && typeof m.out.head === 'string' ? m.out.head : null;
      st.mergeSkipped = m.code === 0 && typeof m.out.skipped === 'string' ? m.out.skipped : null;
      o = { step: 'merge', code: m.code, conflict: m.out.conflict === true, reason: m.code === 0 ? '' : stopReason(m.code, m.out) };
    } else {
      mark(loop, st, 'review');
      await move(COLUMNS.review);
      const t = ticket(loop, repo, base, st);
      const r = await agent(loop, 'reviewer', reviewerPrompt(t, st.round > 1 ? st.review?.report ?? null : null, st.checks), t.copy, st);
      const v = readReviewer(r);
      st.review = v.answer;
      o = v.outcome;
    }
    const step = next(st.round, o);
    if (step.go === 'needsHuman') throw new Stop(step.stoppedAt, step.reason);
    if (step.go === 'paused') throw new Pause(step.stoppedAt, step.reason, join(loop.logs, `${step.stoppedAt === 'build' ? 'builder' : 'reviewer'}-${st.round}.jsonl`), st.resetsAt);
    if (step.go === 'done') break;
    if (step.go === 'build') {
      st.round = step.round;
      st.failed = step.failed;
      st.sessions.builder = null; // the conversation of the round that failed is not the next one's
    }
    go = step.go;
  }

  st.merged = true;
  await move(COLUMNS.done);
  note(loop.logs, { step: 'merged', round: st.round, text: st.head ?? '' });
}

// `resume`: the id of the conversation to go on with, or null for a new one.
async function agent(loop: Loop, name: 'builder' | 'reviewer', prompt: string, cwd: string, st: State, resume: string | null = null): Promise<AgentResult> {
  const session = resume ?? randomUUID();
  st.sessions[name] = session; mark(loop, st);
  const r = await loop.agent({
    agent: name, prompt, cwd, log: join(loop.logs, `${name}-${st.round}.jsonl`), skills: name === 'builder', session, resume: resume !== null,
    schema: name === 'builder' ? BUILDER_SCHEMA : REVIEWER_SCHEMA, budget: loop.budget[name], timeoutMs: loop.minutes[name] * 60_000,
  });
  if (r.ending === 'timeout') r.detail = `${r.detail}; log: .claude/worktrees/logs/${loop.n}/${name}-${st.round}.jsonl`;
  st.spent.push({ cost: r.cost, turns: r.turns });
  if (r.ending === 'limit') st.resetsAt = r.resetsAt;
  mark(loop, st);
  note(loop.logs, { step: 'agent', round: st.round, agent: name, ending: r.ending, cost: r.cost, turns: r.turns, ...(r.detail === null ? {} : { text: r.detail }) });
  return r;
}
