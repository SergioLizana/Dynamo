// The frontier: which tickets are ready for a run and, for each one that is not, why (guides/board-guide.md, «When
// a ticket is ready»). Pure: tickets in, rows out.
import type { Blocker, Ticket, Tickets } from './tickets.ts';

export type Rules = { doneLabel: string; todo: string };
export type Row = {
  number: number; title: string | null; state?: string; column: string | null; doneLabel: boolean; blockers: Blocker[];
  ready: boolean; why: string | null;
};

// The start of the reason of a ticket that waits only on its blockers: a list run takes it to wait for them.
export const BLOCKED = 'blocker not done: ';

// What the reason of a card in a phase column with no file of its run contains (resumes.ts): a list with no numbers keeps such
// a card as skipped, so that the human sees it, instead of dropping it as it drops a ticket in Backlog.
export const NO_FILE = 'with no file of a run';

const isDone = (t: { state: string; doneLabel: boolean }) => t.state === 'CLOSED' || t.doneLabel;

// The first reason that applies, in this order: done, no card on the board, a card in any column but Todo (Backlog parks
// a ticket, Needs Human holds a stuck one), a blocker not done (closed or with the done label). What makes an issue a
// ticket is its card, so an epic, which has none, is never ready.
function whyNot(t: Ticket, rules: Rules): string | null {
  if (t.state === 'CLOSED') return 'done (closed)';
  if (t.doneLabel) return `done (${rules.doneLabel})`;
  if (t.column === null) return 'no card on the board';
  if (t.column !== rules.todo) return `in ${t.column}`;
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
