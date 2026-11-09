// The notice to the human, as data: how a list ended and the one line that says so. Pure: `run` asks which end the list had
// and what to send; the edge that sends it is notify.ts. A list that paused does not get its report (it has not ended),
// and one that started nothing has nothing to report: only a list that ran tickets to their end writes it.
import type { Item } from './lists.ts';

// `paused`: some ticket hit the usage limit. `ended`: nothing paused and at least one ticket ran to its end (merged or
// stopped). `idle`: nothing ran (an empty list, or every ticket skipped).
export type End = 'paused' | 'ended' | 'idle';

export function howEnded(items: Item[]): End {
  if (items.some((i) => i.state === 'paused')) return 'paused';
  return items.some((i) => i.state === 'merged' || i.state === 'blocked') ? 'ended' : 'idle';
}

// A pause: the tickets, when the limit resets (the latest of them, or unknown) and the command that goes on.
export type Pause = { numbers: number[]; resetsAt: (string | null)[] };

export function pauseLine(p: Pause): string {
  const times = p.resetsAt.filter((t): t is string => t !== null).sort();
  const reset = times.length === 0 ? 'unknown' : times[times.length - 1];
  return `dynamo: the list paused at the usage limit: ${p.numbers.map((n) => `#${n}`).join(', ')}; resets at ${reset}; to go on: /dynamo:autopilot ${p.numbers.join(' ')}`;
}

// The end: how many tickets merged and how many stopped, and the report when it was written.
export function endLine(merged: number, stopped: number, report: string | null): string {
  return `dynamo: the list ended: ${merged} merged, ${stopped} stopped${report === null ? '' : `; report: ${report}`}`;
}
