// A ticket half done by a run that died, as data. A card in a phase column (Build, Verify, Review, Merge) is a ticket a run began:
// `dynamo run` takes it only when its file `runs/<n>.json` (holds.ts) is there, and goes on from the phase the file names;
// with no file it is skipped with its reason, since nothing says where it was. A file whose run is alive refuses the
// ticket. Pure, but `ticketRows`, which reads the files for the list and for each ticket.
import type { Deps } from './cli.ts';
import { COLUMNS } from './columns.ts';
import type { Row } from './frontier.ts';
import { BLOCKED, NO_FILE } from './frontier.ts';
import { rows } from './board.ts';
import type { Hold } from './holds.ts';
import { mainFolder, readHold } from './holds.ts';
import type { Stage } from './rounds.ts';
import type { Held } from './runlock.ts';
import { answers, holderOf } from './runlock.ts';

// The rows with the half-done tickets taken into account: a card in one of the phases' columns with a file (`held`) is ready, or waits
// on its blockers as every ticket does; with no file it is not ready, and says so. A ticket that is closed, or that has its
// done label and no file, is left as the frontier read it.
export function resumable(rows: Row[], columns: string[], held: (n: number) => boolean): Row[] {
  return rows.map((r) => {
    if (r.column === null || !columns.includes(r.column) || r.state === 'CLOSED') return r;
    if (!held(r.number)) {
      if (r.doneLabel) return r;
      return { ...r, ready: false, why: `in ${r.column}, ${NO_FILE} to go on from (.claude/worktrees/runs/${r.number}.json): move the card by hand` };
    }
    const open = r.blockers.filter((b) => b.state !== 'CLOSED' && !b.doneLabel);
    return open.length
      ? { ...r, ready: false, why: `${BLOCKED}${open.map((b) => `#${b.number}`).join(', ')}` }
      : { ...r, ready: true, why: null };
  });
}

// The rows of the tickets given (every open one when none is), as `run` takes them: the frontier's, plus the half-done ones.
export function ticketRows(numbers: number[], deps: Deps): Row[] {
  const main = mainFolder(deps);
  return resumable(rows(numbers, deps), [COLUMNS.build, COLUMNS.verify, COLUMNS.review, COLUMNS.merge], (n) => readHold(main, n) !== null);
}

// Who holds the ticket whose file is `hold`, or null when its run is dead: the lock of the runs (`lock`, runlock.ts) is alive
// and is that file's pid. A file of this very process is not another run's.
export function heldBy(hold: Hold, lock: unknown, now: number, self: number, isAlive = answers): Held | null {
  if (hold.pid === self) return null;
  const run = holderOf(lock, now, isAlive);
  return run !== null && run.pid === hold.pid ? { pid: hold.pid, since: hold.startedAt } : null;
}

export type Step = 'build' | 'verify' | 'review' | 'merge';

// Where a run that goes on starts, from the phase its dead predecessor was in: a new Builder in the Builder's phase, Verify
// run again in Verify's, Verify and then the reviewer from the start in Review's (the reviewer is given the check, which
// it never runs itself), and the merge, which does only what is missing, in the merge's.
export function stepOf(phase: Stage): Step {
  if (phase === 'check' || phase === 'review') return 'verify';
  return phase === 'merge' ? 'merge' : 'build';
}
