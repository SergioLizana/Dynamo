// One ticket of `dynamo run` through the loop, in its own copy: the card at every step, the Builder (`claude -p --agent builder`), `dynamo verify`, the reviewer
// (read-only by the tools of its agent file), at most two rounds on the same copy and branch, `dynamo merge`, with the card in Merge from the reviewer's PASS until it ends (a conflict there is one more Builder round, counted in
// the two, then Verify, Review and the merge again), and one result comment with the cost and turns of its agents. A ticket that stops goes to Needs Human with its
// reason (an agent past its time limit with no result among them: no round spent); one whose agent hit the usage limit is paused: no round is spent, its card stays
// where it is and its one comment shows when the limit resets, the cost so far and the raw end of the agent; any other end dynamo does not know is a stop. Each
// agent's stream goes to its own log as it arrives, `.claude/worktrees/logs/<n>/attempt-<k>/<agent>-<round>.jsonl` of the main folder (ignored by git with the copies): each new run of the ticket is a new attempt `k`, so the earlier ones stay, and one that goes on keeps its attempt. Several tickets run this at once: only the agents wait, and `dynamo merge` takes its lock; while it runs the ticket has its file `runs/<n>.json` (holds.ts), which keeps the reset time of the usage limit: a ticket launched again before it is not started (no agent, no card); a ticket stopped at merge keeps its copy, branch and file too, and its relaunch runs only the merge (no agent), unless the human removed its copy and branch: then the file is ignored and the ticket starts anew; a ticket whose file is there and whose run is dead goes on from the phase of its file, on the same copy (resumes.ts), its Builder with `claude -p --resume <id>` and «go on where you left it», or a new Builder on the same copy if that fails. A Builder stopped by a time limit, a spent budget or an unknown end is a kept stop too (keeps.ts): its copy, branch, file and session stay, and its relaunch resumes it in the same round, told why it stopped. A Builder stopped by an outage of the permission check goes on the same way after a wait: no round is spent (rounds.ts).
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { AgentResult } from './agents.ts';
import { BUILDER_SCHEMA, OUTAGE_PROMPT, REVIEWER_SCHEMA, RESUME_PROMPT, answerPrompt, builderPrompt, causePrompt, failurePrompt, readBuilder, readReviewer, reviewerPrompt } from './briefs.ts';
import { card } from './card.ts';
import { cleanCopy } from './cleaning.ts';
import { checkTimeoutOf } from './checks.ts';
import type { RunAgent } from './claude.ts';
import type { Deps, Output } from './cli.ts';
import { exit } from './cli.ts';
import { COLUMNS } from './columns.ts';
import { comment } from './comment.ts';
import { limitUntil, mainFolder, readHold, removeHold } from './holds.ts';
import { KEPT, builderStopKind, causeOf, checkStopKind, reviewerStopKind } from './keeps.ts';
import type { Level } from './levels.ts';
import { levelsOf } from './levels.ts';
import type { JoinedAgent } from './reinforce.ts';
import type { Loop, State } from './loopkit.ts';
import { makeCopy, mark, readAnswers, readLevel, stopped, ticket } from './loopkit.ts';
import { merge } from './merge.ts';
import { settings, stopReason } from './merging.ts';
import { readReinforced } from './reinforce.ts';
import { releaseBranch } from './working.ts';
import { latestAttempt, note, readLog } from './notes.ts';
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
  const levels = levelsOf(factory.project); // so is a wrong value of the levels
  const s = settings(factory.project, releaseBranch(deps));
  const both = (of: typeof budgetOf) => ({ builder: of(factory.project, 'builder'), reviewer: of(factory.project, 'reviewer') });
  const loop: Loop = {
    n, title: '', deps, agent: deps.agent, wait: deps.wait ?? ((ms) => sleep(ms)), logs: '', main: '', startedAt: new Date().toISOString(), budget: both(budgetOf), minutes: both(timeoutOf),
    levels, level: 'high',
  };
  // The file of a ticket whose run is alive refuses it: that run holds it. One whose run is dead is a ticket half done.
  loop.main = mainFolder(deps);
  let hold = readHold(loop.main, n);
  const live = hold === null ? null : heldBy(hold, readLock(join(loop.main, '.claude', 'worktrees', 'run.json')), Date.now(), process.pid);
  if (live !== null) return { ok: false, ticket: n, started: false, why: `#${n} is held by the run of pid ${live.pid} since ${live.since}` };
  // A kept stop whose copy and branch were removed is ignored: removing them is how the human starts a ticket from zero.
  if ((hold?.stopped === true || hold?.asked === true || hold?.resume != null) && removedTicket(deps, n)) { removeHold(loop.main, n); hold = null; }
  // A ticket whose file says the usage limit has not reset yet is not touched: no agent, no card, no copy.
  const until = hold === null ? null : limitUntil(hold.resetsAt, Date.now());
  if (until !== null) return { ok: false, ticket: n, started: false, why: `#${n} paused by the usage limit, which resets at ${until}`, resetsAt: until };
  // Only a ticket that the board gives as ready (or half done, with its file) is started: nothing else is read or moved before.
  const read = await exit(() => ({ ok: true, tickets: ticketRows([n], deps) }));
  const row = read.code === 0 ? rowOf(read.out, n) : null;
  if (row === null) return { ok: false, ticket: n, started: false, why: `dynamo board exited ${read.code}: ${oneLine(JSON.stringify(read.out))}` };
  if (!row.ready) return { ok: false, ticket: n, started: false, why: row.why };
  loop.title = row.title;
  // The ticket's level is read once, before anything is moved: its agents, in every round, run with the values of that level.
  const level = await exit(() => ({ ok: true, level: readLevel(deps, s.repo, n) }));
  if (level.code !== 0) return { ok: false, ticket: n, started: false, why: oneLine(String(level.out.error)) };
  loop.level = level.out.level as Level;

  // A new run is a new attempt, in its own folder; one that goes on keeps the folder of the run that died.
  const earlier = latestAttempt(join(loop.main, '.claude', 'worktrees', 'logs', String(n)));
  loop.logs = join(loop.main, '.claude', 'worktrees', 'logs', String(n), `attempt-${hold === null ? earlier + 1 : Math.max(earlier, 1)}`);
  mkdirSync(loop.logs, { recursive: true });
  note(loop.logs, hold === null ? { step: 'start', round: 1, text: row.title } : { step: 'resumed', round: hold.round, text: `goes on from ${hold.phase}; the run of pid ${hold.pid} left it` });

  const st: State = {
    round: hold?.round ?? 1, stage: hold?.phase ?? 'build', merged: false, head: null, copy: null, branch: null, failed: hold?.failed ?? null,
    verified: null, mergeSkipped: null, checks: hold?.checks ?? null, builder: hold?.builder ?? null, review: hold?.review ?? null, spent: hold?.spent ?? [], resetsAt: null,
    sessions: hold?.sessions ?? { builder: null, reviewer: null }, asked: false, cause: null, failedCheck: null, resume: null,
  };
  mark(loop, st);
  let stop: Facts['stop'] = null, paused: Pause | null = null;
  try {
    // A kept stop resumes the Builder, whatever phase it stopped in: after the Reviewer's last failure (phase review) too.
    const kept = hold?.asked === true;
    const cause = kept ? hold?.cause ?? null : null;
    // The Reviewer's last verdict (phase review) or the output of the check (phase check) is what the resumed Builder is told failed.
    const byCheck = kept && hold?.phase === 'check';
    const failure = kept && hold?.phase === 'review' ? hold.review?.report ?? 'VERDICT: FAIL' : byCheck ? hold?.failedCheck ?? 'the automatic check failed' : null;
    await steps(loop, s.repo, s.base, st, hold === null ? null : kept ? 'build' : hold.resume ?? stepOf(hold.phase), kept, failure, cause, byCheck ? 'check' : 'Reviewer');
  } catch (e) {
    if (e instanceof Pause) {
      paused = e;
      note(loop.logs, { step: 'paused', round: st.round, text: e.message });
    } else {
      stop = await stopped(loop, st, e);
      // A Builder that asked, or that the Reviewer failed in the last round, keeps its conversation: its file is written again with the mark that says so (a stop of any other kind removes it).
      if (stop.asked === true) { st.asked = true; st.cause = stop.cause ?? null; st.failedCheck = stop.failedCheck ?? null; mark(loop, st); }
      // A Reviewer with no result, or a check that did not run, keeps the copy and goes on from its own step.
      if (stop.resume != null) { st.resume = stop.resume; mark(loop, st); }
    }
  }
  // The file of a ticket that ended is removed; a pause keeps it, and so do a stop at merge (its relaunch runs only the merge) and the
  // Builder's question (its relaunch resumes the Builder).
  const goesOn = paused !== null || stop?.stoppedAt === 'merge' || st.asked || st.resume !== null;
  if (!goesOn) removeHold(loop.main, n);
  else if (stop?.stoppedAt === 'merge') mark(loop, st, 'merge', true);
  // The ticket ended (merged or stopped): its copy is left with nothing git does not track. One that goes on, paused or asked, keeps it as it is.
  const removed = paused === null && !st.asked && st.resume === null && st.copy !== null ? cleanCopy(deps, st.copy) : [];
  const file = join(loop.logs, 'comment.md');
  writeFileSync(file, paused === null ? resultComment({
    base: s.base, merged: st.merged, rounds: st.round, checks: st.checks, mergeSkipped: st.mergeSkipped, verdict: st.review?.verdict ?? null, report: st.review?.report ?? null,
    spent: st.spent, noTrace: st.builder?.noTrace ?? null, outOfTicket: st.builder?.outOfTicket ?? null, removed, stop,
  }, n) : pausedComment({
    stoppedAt: paused.stoppedAt, reason: paused.message, round: st.round, log: `${shown(loop)}/${basename(paused.log)}`, raw: rawEnd(readLog(paused.log)),
    resetsAt: paused.resetsAt, spent: st.spent, left: st.copy === null || st.branch === null ? null : { copy: st.copy, branch: st.branch },
  }, n));
  // A merged ticket that goes on may already have its comment: it is posted only if it is missing.
  const there = hold !== null && st.merged && hasMergedComment(deps, s.repo, n);
  const posted = there ? { code: 0, out: { ok: true, url: null } } : await exit(() => comment([String(n), '--body-file', file], deps));
  const { cost, turns } = total(st.spent), why = paused ?? stop;
  return {
    ok: why === null && posted.code === 0, ticket: n, merged: st.merged, rounds: st.round, ...(st.head === null ? {} : { head: st.head }),
    ...(why === null ? {} : { stoppedAt: why.stoppedAt, reason: oneLine(paused?.message ?? stop?.reason ?? '') }), ...(paused === null ? {} : { paused: true, resetsAt: paused.resetsAt }),
    cost, turns, logs: shown(loop),
    comment: posted.code === 0 ? posted.out.url ?? null : null, ...(posted.code === 0 ? {} : { commentError: oneLine(JSON.stringify(posted.out)) }),
  };
}

// Whether the ticket has neither its branch nor its copy any more; a git that cannot say is not taken as «removed».
function removedTicket(deps: Deps, n: number): boolean {
  try {
    const found = findTicket(deps, n);
    return found.copy === null && found.branch === null;
  } catch { return false; }
}

// The log folder of this attempt as the comment and the JSON line name it: relative to the main folder.
function shown(loop: Loop): string {
  return `.claude/worktrees/logs/${loop.n}/${basename(loop.logs)}`;
}

// Build, Verify, Review and the merge until the rounds say done or stop. A stop is thrown. `from`: the step a ticket that goes
// on starts at (resumes.ts), on the branch and copy its dead run left; null for a new ticket. `asked`: the file is a stop that keeps the Builder's
// conversation (it asked the human, or the Reviewer failed it in the last round), so the first Builder resumes it with what the human wrote after
// the notice; `failure`: the Reviewer's last verdict in the second case, null in the first.
async function steps(loop: Loop, repo: string, base: string, st: State, from: Step | null, asked: boolean, failure: string | null, cause: string | null, by: 'Reviewer' | 'check' = 'Reviewer'): Promise<void> {
  const { n, deps } = loop;
  const move = async (column: string) => {
    const r = await exit(() => card([String(n), column], deps));
    if (r.code !== 0) throw new Stop(st.stage, `card did not move to ${column}: ${JSON.stringify(r.out)}`);
    note(loop.logs, { step: 'column', round: st.round, column });
  };
  let go: Exclude<Next['go'], 'needsHuman' | 'paused' | 'done'> = from ?? 'build';
  // The merge of a ticket whose branch is already in the base does only what is missing: its card is not moved to Merge again.
  let inBase = false, newBuilder = from === 'build';
  let answers: string[] | null = null, failed = failure;
  if (from !== null) {
    const found = findTicket(deps, n);
    st.copy = found.copy; st.branch = found.branch;
    if (found.copy === null && (from === 'verify' || from === 'review')) throw new Stop(st.stage, `the copy of #${n} is gone, so the ticket cannot go on from ${st.stage}`);
    inBase = from === 'merge' && found.branch !== null && isMerged(deps, found.branch, base);
    // A Reviewer alone goes on after a check that passed: the commit the merge compares is the copy's, which no Builder changes.
    if (from === 'review' && st.checks !== null && found.copy !== null) {
      const tip = deps.git(['rev-parse', 'HEAD'], { cwd: found.copy });
      st.verified = tip.code === 0 ? tip.stdout.trim() : null;
    }
    if (asked && from === 'build') answers = readAnswers(deps, repo, n, cause);
  }
  for (;;) {
    let o: Outcome;
    let asks = false; // the Builder stopped to ask the human
    if (go === 'build') {
      mark(loop, st, 'build');
      await move(COLUMNS.build);
      const t = st.copy === null ? await makeCopy(loop, repo, base, st) : ticket(loop, repo, base, st);
      // A Reviewer reinforcement that is refused stops the ticket now, before the Builder spends anything.
      reinforcement('reviewer', t.copy, st);
      // A Builder cut halfway goes on with its conversation; if that fails, a new one on the same copy.
      const told = answers, fails = failed;
      const goOn = async (session: string, prompt: string) => {
        const r = await agent(loop, 'builder', prompt, t.copy, st, session);
        if (r.ending !== 'unknown' || r.outage === true) return r;
        note(loop.logs, { step: 'resume-failed', round: st.round, text: r.detail ?? '' });
        return agent(loop, 'builder', builderPrompt(t, st.round, st.failed, true, told, fails, cause, by), t.copy, st);
      };
      const before = newBuilder ? st.sessions.builder : null;
      let r = before === null
        ? await agent(loop, 'builder', builderPrompt(t, st.round, st.failed, newBuilder, told), t.copy, st)
        : await goOn(before, told === null ? RESUME_PROMPT : fails !== null ? failurePrompt(fails, told, by) : cause !== null ? causePrompt(cause, told) : answerPrompt(told));
      newBuilder = false;
      answers = null; failed = null; // the human's answer, and the failure it answers, are for this Builder only
      let b = readBuilder(r);
      for (let tries = 0; tries < OUTAGE_TRIES && stoppedByOutage(r.outage === true, b.outcome) && st.sessions.builder !== null; tries++) {
        note(loop.logs, { step: 'outage', round: st.round, text: `waits ${OUTAGE_WAIT_MS / 1000} s, try ${tries + 1} of ${OUTAGE_TRIES}` });
        await loop.wait(OUTAGE_WAIT_MS);
        r = await goOn(st.sessions.builder, OUTAGE_PROMPT);
        b = readBuilder(r);
      }
      st.builder = b.answer ?? st.builder;
      o = b.outcome;
      asks = r.ending === 'success' && r.outage !== true && b.answer?.needsHuman === true;
    } else if (go === 'verify') {
      mark(loop, st, 'check');
      await move(COLUMNS.verify);
      const v = await exit(() => verify([String(st.copy), base], deps));
      st.checks = checksOf(v.out);
      // What Verify passed is the commit the copy is at; the merge compares its tree with that commit's. The Builder leaves nothing
      // uncommitted (what is merged is the branch, not the folder), so the tree Verify checked is the tree of this commit.
      const tip = v.code === 0 ? deps.git(['rev-parse', 'HEAD'], { cwd: String(st.copy) }) : null;
      st.verified = tip !== null && tip.code === 0 ? tip.stdout.trim() : null;
      // A check that threw (no checks, no copy: `error`, exit code 1 by `exit`) did not run, as a wrong call (2) did; a command that failed is exit 1.
      o = { step: 'verify', code: v.code === 1 && typeof v.out.error === 'string' ? 2 : v.code, output: failedChecks(v.out) };
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
    // The Reviewer's failure in the last round keeps the Builder's conversation too: the human's comment goes on from it.
    if (step.go === 'needsHuman') {
      // A Builder cut off by a time limit, a budget or an unknown end is a kept stop too (keeps.ts), with the reason it is told on resuming.
      const kind = builderStopKind(o);
      const cut = kind !== null && KEPT[kind].kept ? causeOf(kind, loop.minutes.builder, loop.budget.builder) : null;
      // A check failed in the last round (exit 1; exit 2 is a check that did not run) is kept too, with its output.
      const checkFailed = o.step === 'verify' && o.code === 1;
      // A Reviewer with no result and a check that did not run go on from their own step, with no Builder (keeps.ts).
      const resume = KEPT[reviewerStopKind(o) ?? checkStopKind(o) ?? 'infrastructure'].from;
      const own = resume === 'review' || resume === 'verify' ? resume : null;
      throw new Stop(step.stoppedAt, step.reason, asks || cut !== null || checkFailed || (o.step === 'review' && o.verdict === 'FAIL'), cut, checkFailed ? o.output : null, own);
    }
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

// The joined agent when the project reinforces the agent (`.claude/dynamo/<name>.md` of the copy), nothing otherwise. A Reviewer
// reinforcement that asks for a tool that writes stops the ticket with its reason (reinforce.ts).
function reinforcement(name: 'builder' | 'reviewer', cwd: string, st: State): { joined?: JoinedAgent } {
  try {
    const joined = readReinforced(join(import.meta.dirname, '..'), cwd, name);
    return joined === null ? {} : { joined };
  } catch (e) {
    throw new Stop(st.stage, e instanceof Error ? e.message : String(e));
  }
}

// `resume`: the id of the conversation to go on with, or null for a new one.
async function agent(loop: Loop, name: 'builder' | 'reviewer', prompt: string, cwd: string, st: State, resume: string | null = null): Promise<AgentResult> {
  const session = resume ?? randomUUID();
  st.sessions[name] = session; mark(loop, st);
  const r = await loop.agent({
    agent: name, prompt, cwd, log: join(loop.logs, `${name}-${st.round}.jsonl`), skills: name === 'builder', session, resume: resume !== null,
    ...loop.levels[loop.level][name], ...reinforcement(name, cwd, st),
    schema: name === 'builder' ? BUILDER_SCHEMA : REVIEWER_SCHEMA, budget: loop.budget[name], timeoutMs: loop.minutes[name] * 60_000,
  });
  if (r.ending === 'timeout') r.detail = `${r.detail}; log: ${shown(loop)}/${name}-${st.round}.jsonl`;
  st.spent.push({ cost: r.cost, turns: r.turns });
  if (r.ending === 'limit') st.resetsAt = r.resetsAt;
  mark(loop, st);
  note(loop.logs, { step: 'agent', round: st.round, agent: name, ending: r.ending, cost: r.cost, turns: r.turns, ...(r.detail === null ? {} : { text: r.detail }) });
  return r;
}
