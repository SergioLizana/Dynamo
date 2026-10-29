// A list of tickets as data: which tickets a run takes, how many run at once, and, each time one ends, which start now,
// which wait and which are skipped, and whether the list is over. Pure: the subcommand `run` reads the board, runs the
// tickets and asks this what is next.
import type { Row } from './frontier.ts';
import { BLOCKED } from './frontier.ts';

// `waiting` until it starts; `blocked` is a ticket that stopped (in Needs Human); `paused` one whose agent ended in a way
// dynamo does not know (a usage limit); `skipped` never starts.
export type State = 'waiting' | 'running' | 'merged' | 'blocked' | 'paused' | 'skipped';
// `blockers`: the numbers of the blockers that were not done when the list was read.
export type Item = { number: number; blockers: number[]; state: State; why: string | null };
export type Skip = { number: number; why: string };
export type Next = { start: number[]; skip: Skip[]; done: boolean };

// How many tickets run at once (`ticketsAtOnce` of factory.json): a whole number from 1.
export function atOnceOf(factory: Record<string, unknown>): number {
  const value = factory.ticketsAtOnce;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new Error('factory.json has no ticketsAtOnce (a whole number from 1)');
  return value;
}

// The tickets of the list from the rows of `dynamo board`. With numbers given, every one of them is in it, and one that
// cannot run (done, in Needs Human, no such issue) is skipped with its reason. With none (every open ticket was read),
// only those that are ready or wait on tickets of the list, also through others, are in it.
export function listOf(rows: Row[], given: boolean): Item[] {
  const items = rows.map((r): Item => {
    const waits = r.ready || (r.why?.startsWith(BLOCKED) ?? false);
    const blockers = r.blockers.filter((b) => b.state !== 'CLOSED' && !b.doneLabel).map((b) => b.number);
    return { number: r.number, blockers: r.ready ? [] : blockers, state: waits ? 'waiting' : 'skipped', why: waits ? null : r.why };
  }).sort((a, b) => a.number - b.number);
  if (given) return items;
  const out = new Set(propagate(items).map((s) => s.number));
  return items.filter((i) => i.state === 'waiting' && !out.has(i.number));
}

// What happens now: the waiting tickets that can no longer start are skipped (a blocker outside the list, stopped or
// skipped, or a cycle of blockers), and the ones whose blockers are all merged start, by number, while fewer than
// `atOnce` run. The list is over when nothing runs and nothing starts. Once a ticket is paused nothing starts again: the
// ones that run are left to end and the waiting ones are skipped.
export function schedule(items: Item[], atOnce: number): Next {
  const skip = propagate(items);
  const skipped = new Set(skip.map((s) => s.number));
  const state = new Map(items.map((i) => [i.number, skipped.has(i.number) ? 'skipped' : i.state]));
  const waiting = items.filter((i) => state.get(i.number) === 'waiting');
  const running = items.filter((i) => i.state === 'running').length;
  const ready = waiting.filter((i) => i.blockers.every((b) => state.get(b) === 'merged')).sort((a, b) => a.number - b.number);
  const paused = items.find((i) => i.state === 'paused');
  if (paused !== undefined) {
    for (const i of waiting) skip.push({ number: i.number, why: `the list paused at #${paused.number}` });
    return { start: [], skip, done: running === 0 };
  }
  const start = ready.slice(0, Math.max(0, atOnce - running)).map((i) => i.number);
  // Nothing runs and nothing can start, yet some wait: each of them waits on another that waits.
  if (running === 0 && start.length === 0) {
    for (const i of waiting) skip.push({ number: i.number, why: `a cycle of blockers: ${i.blockers.map((b) => `#${b}`).join(', ')} never start` });
  }
  return { start, skip, done: running === 0 && start.length === 0 };
}

// The waiting tickets with a blocker that will not be merged in this run, and also those that wait on one of them.
function propagate(items: Item[]): Skip[] {
  const state = new Map<number, State>(items.map((i) => [i.number, i.state]));
  const skip: Skip[] = [];
  for (let changed = true; changed;) {
    changed = false;
    for (const i of items) {
      if (state.get(i.number) !== 'waiting') continue;
      const why = i.blockers.map((b) => reason(b, state.get(b))).find((r) => r !== null);
      if (why === undefined) continue;
      state.set(i.number, 'skipped');
      skip.push({ number: i.number, why });
      changed = true;
    }
  }
  return skip;
}

function reason(blocker: number, state: State | undefined): string | null {
  if (state === undefined) return `${BLOCKED}#${blocker}, which is not in the list`;
  if (state === 'blocked') return `blocker #${blocker} stopped in this run`;
  if (state === 'skipped') return `blocker #${blocker} was skipped`;
  if (state === 'paused') return `blocker #${blocker} paused`;
  return null;
}
