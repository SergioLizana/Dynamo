// `dynamo run [n ...]`: a list of tickets through the loop (loop.ts), N at once (`project.ticketsAtOnce` of factory.json): the
// tickets given or, with none, every open ticket that is ready or waits only on tickets of the list, and the ones in a phase
// column that have the file of a run (a dead run's, which goes on from its phase: resumes.ts; one with no file is skipped). A ticket starts once
// its blockers of the list are merged; the dependents of one that stops, or of one skipped, are skipped and keep their card
// where it was. A ticket whose agent hits the usage limit pauses the list: the agents running end, none
// starts, the waiting tickets are skipped, the line says `paused` and the run exits 1. Merges go one at a time: `dynamo merge` takes its lock. At the end the copies and branches of the merged
// tickets are removed (a blocked ticket keeps both for the human) and, only when the list ends, `dynamo report` writes the
// release report, with the skipped tickets and why: a list that paused, or started nothing, does not rewrite it. When it
// ends and when it pauses, one line goes to the human through `deps.notify` (notify.ts). Its commands are printed for the
// human; nothing is pushed. One run at a time: the lock of the
// run (runlock.ts) makes a second `dynamo run` exit at once while one is alive, saying which pid holds it. Before all that, a
// `project.repo` that GitHub resolves to another name (a renamed repository) stops the run before any card moves (repocheck.ts).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Deps, Output } from './cli.ts';
import type { Exit } from './cli.ts';
import { exit, usage } from './cli.ts';
import { copy } from './copy.ts';
import type { Item, State } from './lists.ts';
import { atOnceOf, listOf, schedule } from './lists.ts';
import { mainFolder } from './holds.ts';
import { runTicket } from './loop.ts';
import { noteSkipped } from './notes.ts';
import type { End } from './notices.ts';
import { endLine, howEnded, pauseLine } from './notices.ts';
import { oneLine } from './releases.ts';
import { ticketRows } from './resumes.ts';
import { checkRepo } from './repocheck.ts';
import { report } from './report.ts';
import { takeLock } from './runlock.ts';

export async function run(args: string[], deps: Deps): Promise<Output> {
  const numbers = [...new Set(args.map((a) => (/^[1-9]\d*$/.test(a) ? Number(a) : usage(`usage: run [n ...] (${a} is not a ticket number)`))))];
  if (deps.agent === undefined) throw new Error('run was not given the claude edge');
  // project.repo must be the repository's current name before any card moves (repocheck.ts).
  const renamed = checkRepo(deps);
  if (renamed !== null) return renamed;
  // One run at a time (runlock.ts): a live lock ends this run before it touches anything.
  const lock = takeLock(join(mainFolder(deps), '.claude', 'worktrees', 'run.json'), { pid: process.pid, now: Date.now });
  if ('held' in lock) {
    const { pid, since } = lock.held;
    return { ok: false, error: `another run is alive: pid ${pid} holds the lock since ${since}; nothing was started`, pid, since };
  }
  try {
    return await list(numbers, deps);
  } finally {
    lock.release();
  }
}

async function list(numbers: number[], deps: Deps): Promise<Output> {
  const atOnce = atOnceOf(deps.factory().project);
  const items = listOf(ticketRows(numbers, deps), numbers.length > 0);

  // Each ticket's own JSON line, kept for the line of the list; a ticket ends with one, whatever happened in it.
  const results = new Map<number, Output>();
  // A skipped ticket is noted in its log folder too, so that `dynamo status` can say why.
  const logs = join(mainFolder(deps), '.claude', 'worktrees', 'logs');
  const skip = (list: Item[], n: number, why: string) => {
    set(list, n, 'skipped', why);
    noteSkipped(join(logs, String(n)), why);
  };
  const running = new Map<number, Promise<number>>();
  for (;;) {
    const next = schedule(items, atOnce);
    for (const s of next.skip) skip(items, s.number, s.why);
    for (const n of next.start) {
      set(items, n, 'running', null);
      running.set(n, exit(() => runTicket(n, deps)).then(({ out }) => {
        results.set(n, out);
        return n;
      }));
    }
    if (next.done) break;
    const n = await Promise.race(running.values());
    running.delete(n);
    const out = results.get(n) ?? { ok: false };
    // A ticket that `dynamo board` no longer gave as ready when its turn came was never started.
    if (out.started === false) skip(items, n, typeof out.why === 'string' ? out.why : 'not ready when its turn came');
    else set(items, n, out.merged === true ? 'merged' : out.paused === true ? 'paused' : 'blocked', null);
  }

  const notes: string[] = [];
  const removed: number[] = [];
  for (const i of items.filter((t) => t.state === 'merged')) {
    const r = await exit(() => copy(['remove', String(i.number)], deps));
    if (r.code === 0) removed.push(i.number);
    else notes.push(`the copy and branch of #${i.number} were not removed: ${oneLine(JSON.stringify(r.out))}`);
  }

  const paused = items.filter((i) => i.state === 'paused').map((i) => i.number);
  // The report is the list's end: a list that paused has not ended, and one that started nothing has nothing to report.
  const ended = howEnded(items);
  let made: Exit | null = null;
  if (ended === 'ended') {
    const skipped = items.filter((i) => i.state === 'skipped').map((i) => ({ number: i.number, why: String(i.why) }));
    const file = join(logs, 'run-skipped.json');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(skipped));
    made = await exit(() => report(['--skipped', file], deps));
  }

  const notice = await tell(items, results, made, ended, deps);
  const tickets = items.map((i) => entry(i, results.get(i.number)));
  const sum = (key: string) => tickets.reduce((s, t) => s + (typeof t[key] === 'number' ? Number(t[key]) : 0), 0);
  return {
    ok: items.every((i) => i.state === 'merged') && (made === null || made.code === 0) && notes.length === 0,
    atOnce, tickets, cost: sum('cost'), turns: sum('turns'), removed, kept: items.filter((i) => i.state === 'blocked' || i.state === 'paused').map((i) => i.number),
    ...(paused.length ? { paused } : {}),
    ...(made === null ? { report: null } : made.code === 0 ? { report: made.out.file, commands: made.out.commands } : { reportError: oneLine(JSON.stringify(made.out)) }),
    ...(notes.length ? { notes } : {}),
    ...(notice === null ? {} : { notice }),
  };
}

function set(items: Item[], n: number, state: State, why: string | null): void {
  const i = items.find((t) => t.number === n);
  if (i !== undefined) Object.assign(i, { state, why });
}

// What the line of the list says of one ticket: merged with its head, stopped with where and why, or skipped with why.
function entry(i: Item, out: Output | undefined): Output {
  if (i.state === 'skipped') return { ok: false, ticket: i.number, skipped: String(i.why) };
  const o = out ?? { ok: false };
  const spent = { rounds: o.rounds, cost: o.cost, turns: o.turns };
  if (i.state === 'merged') return { ok: true, ticket: i.number, merged: true, head: o.head, ...spent };
  const why = o.reason ?? o.error ?? o.commentError;
  return { ok: false, ticket: i.number, merged: false, ...(i.state === 'paused' ? { paused: true } : {}), stoppedAt: o.stoppedAt ?? null, reason: typeof why === 'string' ? why : null, ...spent };
}

// The notice to the human, when the list ends and when it pauses (none when it started nothing, or when no URL is set: that
// is notify.ts). It comes back as the text of what went wrong, so the line of the list shows a notice that was not sent.
async function tell(items: Item[], results: Map<number, Output>, made: Exit | null, ended: End, deps: Deps): Promise<string | null> {
  if (deps.notify === undefined || ended === 'idle') return null;
  const paused = items.filter((i) => i.state === 'paused');
  const file = made !== null && made.code === 0 && typeof made.out.file === 'string' ? made.out.file : null;
  const line = ended === 'paused'
    ? pauseLine({ numbers: paused.map((i) => i.number), resetsAt: paused.map((i) => results.get(i.number)?.resetsAt).map((t) => (typeof t === 'string' ? t : null)) })
    : endLine(items.filter((i) => i.state === 'merged').length, items.filter((i) => i.state === 'blocked').length, file);
  return deps.notify(line);
}
