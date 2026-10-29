// The frontier: which tickets are ready for a run and, for each one that is not, why (documentation/board-guide.md, «When
// a ticket is ready»). Pure: tickets in, rows out.
import type { Blocker, Ticket, Tickets } from './tickets.ts';

export type Rules = { doneLabel: string; needsHuman: string };
export type Row = {
  number: number; title: string | null; state?: string; column: string | null; doneLabel: boolean; blockers: Blocker[];
  ready: boolean; why: string | null;
};

// The start of the reason of a ticket that waits only on its blockers: a list run takes it to wait for them.
export const BLOCKED = 'blocker not done: ';

const isDone = (t: { state: string; doneLabel: boolean }) => t.state === 'CLOSED' || t.doneLabel;

// The first reason that applies, in this order: done, in Needs Human, a blocker not done (closed or with the done label).
function whyNot(t: Ticket, rules: Rules): string | null {
  if (t.state === 'CLOSED') return 'done (closed)';
  if (t.doneLabel) return `done (${rules.doneLabel})`;
  if (t.column === rules.needsHuman) return `in ${rules.needsHuman}`;
  const open = t.blockers.filter((b) => !isDone(b));
  return open.length ? `${BLOCKED}${open.map((b) => `#${b.number}`).join(', ')}` : null;
}

export function frontier(tickets: Tickets, rules: Rules): Row[] {
  const rows: Row[] = tickets.found.map((t) => {
    const why = whyNot(t, rules);
    return { ...t, ready: why === null, why };
  });
  for (const number of tickets.missing) {
    rows.push({ number, title: null, column: null, doneLabel: false, blockers: [], ready: false, why: 'no such issue' });
  }
  return rows.sort((a, b) => a.number - b.number);
}
