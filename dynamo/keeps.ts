// Which stops of a ticket are kept, as data (epic #274). A kept stop keeps the copy, the branch, the ticket's run file and the
// Builder's session, and its relaunch goes on from the phase this table names instead of building again; any other stop removes
// them and the person removes the copy and the branch to start anew. Pure: loop.ts asks it, and so will the Reviewer's and the
// check's stops when they are kept (so far the loop acts on the Builder's three).
import type { Outcome } from './rounds.ts';
import type { Step } from './resumes.ts';

export type StopKind =
  | 'build-timeout' | 'build-budget' | 'build-unknown'
  | 'check-failed-last-round' | 'check-did-not-run'
  | 'review-timeout' | 'review-budget' | 'review-no-verdict'
  | 'infrastructure';

// `from`: the step a relaunch goes on from, null when the stop is not kept. A Builder step resumes the Builder's conversation;
// `review` runs only the Reviewer on the same commit; `verify` runs the check and the rest, with no Builder.
export const KEPT: Record<StopKind, { kept: boolean; from: Step | null }> = {
  'build-timeout': { kept: true, from: 'build' },
  'build-budget': { kept: true, from: 'build' },
  'build-unknown': { kept: true, from: 'build' },
  'check-failed-last-round': { kept: true, from: 'build' },
  'check-did-not-run': { kept: true, from: 'verify' },
  'review-timeout': { kept: true, from: 'review' },
  'review-budget': { kept: true, from: 'review' },
  'review-no-verdict': { kept: true, from: 'review' },
  // A card that did not move, a copy that is gone, comments that could not be read: there is no agent work to save.
  infrastructure: { kept: false, from: null },
};

// The kind of the stop a Builder's outcome ends in, or null when it is not one of the table's (it ended well, asked the human, or
// ended in an error, which are handled elsewhere).
export function builderStopKind(o: Outcome): StopKind | null {
  if (o.step !== 'build') return null;
  if (o.ending === 'timeout') return 'build-timeout';
  if (o.ending === 'budget') return 'build-budget';
  return o.ending === 'unknown' ? 'build-unknown' : null;
}

// What a resumed Builder is told of why it stopped (loop.ts keeps it in the ticket's file), with the limits of the launch that
// stopped it.
export function causeOf(kind: StopKind, minutes: number, budgetUsd: number): string | null {
  if (kind === 'build-timeout') return `the time limit of ${minutes} min cut you off`;
  if (kind === 'build-budget') return `you spent your budget of ${budgetUsd} USD`;
  return kind === 'build-unknown' ? 'your run ended in a way dynamo does not know, with no result' : null;
}

// The kind of the stop a Reviewer's outcome ends in, or null when it did not stop (a verdict, or the usage limit, which pauses)
// or ended in an error, which is the infrastructure's and is not kept. No result at all is no verdict too.
export function reviewerStopKind(o: Outcome): StopKind | null {
  if (o.step !== 'review') return null;
  if (o.ending === 'timeout') return 'review-timeout';
  if (o.ending === 'budget') return 'review-budget';
  if (o.ending === 'unknown') return 'review-no-verdict';
  return o.ending === 'success' && o.verdict === null ? 'review-no-verdict' : null;
}

// The check's stop that is kept: it did not run (exit 2). One that failed (exit 1) is the Builder's to fix, in the table too.
export function checkStopKind(o: Outcome): StopKind | null {
  if (o.step !== 'verify') return null;
  return o.code === 2 ? 'check-did-not-run' : o.code === 1 ? 'check-failed-last-round' : null;
}
