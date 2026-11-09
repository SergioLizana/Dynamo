// The rounds of one ticket as data: what comes after each step of the loop (Build, Verify, Review), given the round and
// how the step ended. Pure: the subcommand `run` runs the agents, the check and the merge, and asks this what is next.
import type { Ending } from './agents.ts';

// A ticket gets at most this many rounds, counting failures of the check, of the reviewer and a conflict at the merge.
export const ROUNDS = 2;

// An outage of the permission check of `auto` is short (about a minute and a half): the Builder it stopped goes on after this
// wait, this many times, and no round is spent. The wait is here because an agent may not wait with a loop (its rule 11).
export const OUTAGE_TRIES = 2;
export const OUTAGE_WAIT_MS = 180_000;

// Where a ticket stopped, as the result comment says it.
export type Stage = 'start' | 'build' | 'check' | 'review' | 'merge';

// How a step ended. The check is the exit code of `dynamo verify` (0 passed, 1 a command failed, 2 or an error: it did not
// run) with the end of its output; the reviewer is its `verdict` field and its report, null when it gave no answer; the merge
// is the exit code of `dynamo merge`, whether it stopped on a conflict, and why it stopped (`stopReason`).
export type Outcome =
  | { step: 'build'; ending: Ending; detail: string | null; needsHuman: boolean; reason: string | null }
  | { step: 'verify'; code: 0 | 1 | 2; output: string }
  | { step: 'review'; ending: Ending; detail: string | null; verdict: 'PASS' | 'FAIL' | null; report: string | null }
  | { step: 'merge'; code: number; conflict: boolean; reason: string };

// `failed` is what the Builder of the next round gets: the failing check, the reviewer's report word for word, or the conflict.
export type Next =
  | { go: 'verify' }
  | { go: 'review' }
  | { go: 'merge' }
  | { go: 'done' }
  | { go: 'build'; round: number; failed: string }
  | { go: 'needsHuman'; stoppedAt: Stage; reason: string }
  // An agent hit the usage limit, which is not the ticket's failure: no round is spent and the card does not move.
  | { go: 'paused'; stoppedAt: 'build' | 'review'; reason: string };

export function next(round: number, o: Outcome): Next {
  if (o.step === 'build') {
    if (o.ending === 'limit') return { go: 'paused', stoppedAt: 'build', reason: pauseOf('Builder') };
    const stop = agentStop('Builder', o.ending, o.detail);
    if (stop !== null) return { go: 'needsHuman', stoppedAt: 'build', reason: stop };
    if (o.needsHuman) return { go: 'needsHuman', stoppedAt: 'build', reason: `the Builder needs the human: ${o.reason || 'no reason given'}` };
    return { go: 'verify' };
  }
  if (o.step === 'merge') {
    if (o.code === 0) return { go: 'done' };
    // The base moved after Verify and Review (another ticket merged in between): one more round in the same copy brings it in.
    if (o.conflict) return again(round, 'merge', `the merge stopped on a conflict with the base, which moved while this ticket was built; bring the base into your branch and resolve it: ${o.reason}`, o.reason);
    return { go: 'needsHuman', stoppedAt: 'merge', reason: o.reason };
  }
  if (o.step === 'verify') {
    if (o.code === 0) return { go: 'review' };
    if (o.code === 2) return { go: 'needsHuman', stoppedAt: 'check', reason: `the automatic check did not run: ${o.output}` };
    return again(round, 'check', `the automatic check failed: ${o.output}`);
  }
  if (o.ending === 'limit') return { go: 'paused', stoppedAt: 'review', reason: pauseOf('reviewer') };
  const stop = agentStop('reviewer', o.ending, o.detail);
  if (stop !== null) return { go: 'needsHuman', stoppedAt: 'review', reason: stop };
  if (o.verdict === null) return { go: 'needsHuman', stoppedAt: 'review', reason: 'the reviewer gave no verdict' };
  if (o.verdict === 'PASS') return { go: 'merge' };
  return again(round, 'review', `the reviewer's verdict: ${o.report ?? 'VERDICT: FAIL'}`);
}

// Whether a Builder's run stopped because of an outage it met (`outage`, agents.ts) and so goes on: it gave up on the human, or
// ended with no answer. A budget, a time limit or the usage limit are its own stops, and a run with no outage is what it says.
export function stoppedByOutage(outage: boolean, o: Outcome): boolean {
  return outage && o.step === 'build' && (o.needsHuman || o.ending === 'unknown' || o.ending === 'error');
}

// A failure in a round that is not the last one goes to the next round with what failed; in the last one, to the human
// (with `reason` when it differs from what the Builder is told).
function again(round: number, stoppedAt: Stage, failed: string, reason = failed): Next {
  return round < ROUNDS ? { go: 'build', round: round + 1, failed } : { go: 'needsHuman', stoppedAt, reason };
}

function pauseOf(who: string): string {
  return `the ${who} hit the usage limit`;
}

// Why an agent's run stops the ticket, or null when it ended well: a spent budget, a time limit, an end dynamo does not know
// or any other error of the agent.
function agentStop(who: string, ending: Ending, detail: string | null): string | null {
  if (ending === 'timeout') return `the ${who} ended as timeout${detail === null ? '' : `: ${detail}`}`;
  if (ending === 'budget') return `the ${who} spent its budget${detail === null ? '' : ` (${detail})`}`;
  if (ending === 'unknown') return `the ${who} ended in a way dynamo does not know${detail === null ? '' : `: ${detail}`}`;
  if (ending === 'error') return `the ${who} ended in error${detail === null ? '' : `: ${detail}`}`;
  return null;
}
