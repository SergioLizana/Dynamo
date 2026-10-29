// The rounds of one ticket as data: what comes after each step of the loop (Build, Verify, Review), given the round and
// how the step ended. Pure: the subcommand `run` runs the agents, the check and the merge, and asks this what is next.
import type { Ending } from './agents.ts';

// A ticket gets at most this many rounds, counting failures of both the check and the reviewer.
export const ROUNDS = 2;

// Where a ticket stopped, as the result comment says it (the same words as `/implement`).
export type Stage = 'start' | 'build' | 'check' | 'review' | 'merge';

// How a step ended. The check is the exit code of `dynamo verify` (0 passed, 1 a command failed, 2 or an error: it did not
// run) with the end of its output; the reviewer is its `verdict` field and its report, null when it gave no answer.
export type Outcome =
  | { step: 'build'; ending: Ending; detail: string | null; needsHuman: boolean; reason: string | null }
  | { step: 'verify'; code: 0 | 1 | 2; output: string }
  | { step: 'review'; ending: Ending; detail: string | null; verdict: 'PASS' | 'FAIL' | null; report: string | null };

// `failed` is what the Builder of the next round gets: the failing check, or the reviewer's report word for word.
export type Next =
  | { go: 'verify' }
  | { go: 'review' }
  | { go: 'merge' }
  | { go: 'build'; round: number; failed: string }
  | { go: 'needsHuman'; stoppedAt: Stage; reason: string };

export function next(round: number, o: Outcome): Next {
  if (o.step === 'build') {
    const stop = agentStop('Builder', o.ending, o.detail);
    if (stop !== null) return { go: 'needsHuman', stoppedAt: 'build', reason: stop };
    if (o.needsHuman) return { go: 'needsHuman', stoppedAt: 'build', reason: `the Builder needs the human: ${o.reason || 'no reason given'}` };
    return { go: 'verify' };
  }
  if (o.step === 'verify') {
    if (o.code === 0) return { go: 'review' };
    if (o.code === 2) return { go: 'needsHuman', stoppedAt: 'check', reason: `the automatic check did not run: ${o.output}` };
    return again(round, 'check', `the automatic check failed: ${o.output}`);
  }
  const stop = agentStop('reviewer', o.ending, o.detail);
  if (stop !== null) return { go: 'needsHuman', stoppedAt: 'review', reason: stop };
  if (o.verdict === null) return { go: 'needsHuman', stoppedAt: 'review', reason: 'the reviewer gave no verdict' };
  if (o.verdict === 'PASS') return { go: 'merge' };
  return again(round, 'review', `the reviewer's verdict: ${o.report ?? 'VERDICT: FAIL'}`);
}

// A failure in a round that is not the last one goes to the next round with what failed; in the last one, to the human.
function again(round: number, stoppedAt: Stage, failed: string): Next {
  return round < ROUNDS ? { go: 'build', round: round + 1, failed } : { go: 'needsHuman', stoppedAt, reason: failed };
}

// Why an agent's run stops the ticket, or null when it ended well: a spent budget or any other error of the agent.
function agentStop(who: string, ending: Ending, detail: string | null): string | null {
  if (ending === 'budget') return `the ${who} spent its budget${detail === null ? '' : ` (${detail})`}`;
  if (ending === 'error') return `the ${who} ended in error${detail === null ? '' : `: ${detail}`}`;
  return null;
}
