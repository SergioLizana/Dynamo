// `dynamo run [n ...]`: a list of tickets through the loop (loop.ts), N at once (`ticketsAtOnce` of factory.json): the
// tickets given or, with none, every open ticket that is ready or waits only on tickets of the list. A ticket starts once
// its blockers of the list are merged; the dependents of one that stops, or of one skipped, are skipped and keep their card
// where it was. Merges go one at a time: `dynamo merge` takes its lock. At the end the copies and branches of the merged
// tickets are removed (a blocked ticket keeps both for the human) and `dynamo report` writes the release report, with the
// skipped tickets and why. Its commands are printed for the human; nothing is pushed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { rows } from './board.ts';
import type { Deps, Output } from './cli.ts';
import { exit, usage } from './cli.ts';
import { copy } from './copy.ts';
import type { Item, State } from './lists.ts';
import { atOnceOf, listOf, schedule } from './lists.ts';
import { mainFolder, runTicket } from './loop.ts';
import { oneLine } from './releases.ts';
import { report } from './report.ts';

export async function run(args: string[], deps: Deps): Promise<Output> {
  const numbers = [...new Set(args.map((a) => (/^[1-9]\d*$/.test(a) ? Number(a) : usage(`usage: run [n ...] (${a} is not a ticket number)`))))];
  if (deps.agent === undefined) throw new Error('run was not given the claude edge');
  const atOnce = atOnceOf(deps.factory());
  const items = listOf(rows(numbers, deps), numbers.length > 0);

  // Each ticket's own JSON line, kept for the line of the list; a ticket ends with one, whatever happened in it.
  const results = new Map<number, Output>();
  const running = new Map<number, Promise<number>>();
  for (;;) {
    const next = schedule(items, atOnce);
    for (const s of next.skip) set(items, s.number, 'skipped', s.why);
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
    if (out.started === false) set(items, n, 'skipped', typeof out.why === 'string' ? out.why : 'not ready when its turn came');
    else set(items, n, out.merged === true ? 'merged' : 'blocked', null);
  }

  const notes: string[] = [];
  const removed: number[] = [];
  for (const i of items.filter((t) => t.state === 'merged')) {
    const r = await exit(() => copy(['remove', String(i.number)], deps));
    if (r.code === 0) removed.push(i.number);
    else notes.push(`the copy and branch of #${i.number} were not removed: ${oneLine(JSON.stringify(r.out))}`);
  }

  const skipped = items.filter((i) => i.state === 'skipped').map((i) => ({ number: i.number, why: String(i.why) }));
  const file = join(mainFolder(deps), '.claude', 'worktrees', 'logs', 'run-skipped.json');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(skipped));
  const made = await exit(() => report(['--skipped', file], deps));

  const tickets = items.map((i) => entry(i, results.get(i.number)));
  const sum = (key: string) => tickets.reduce((s, t) => s + (typeof t[key] === 'number' ? Number(t[key]) : 0), 0);
  return {
    ok: items.every((i) => i.state === 'merged') && made.code === 0 && notes.length === 0,
    atOnce, tickets, cost: sum('cost'), turns: sum('turns'), removed, kept: items.filter((i) => i.state === 'blocked').map((i) => i.number),
    ...(made.code === 0 ? { report: made.out.file, commands: made.out.commands } : { reportError: oneLine(JSON.stringify(made.out)) }),
    ...(notes.length ? { notes } : {}),
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
  return { ok: false, ticket: i.number, merged: false, stoppedAt: o.stoppedAt ?? null, reason: typeof why === 'string' ? why : null, ...spent };
}
