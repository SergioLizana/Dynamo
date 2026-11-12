// The two ways a ticket's steps end before the merge, thrown from the loop (loop.ts) and caught where its comment is made.
import type { Stage } from './rounds.ts';

// A step that stops the ticket (Needs Human), with where it stopped.
// `asked`: the Builder stopped to ask the human, so the ticket keeps its copy, branch and the Builder's conversation (loop.ts).
// `cause`: for a Builder cut off by a time limit, a budget or an unknown end (keeps.ts), why, as the Builder is told when it is resumed.
export class Stop extends Error {
  stoppedAt: Stage;
  asked: boolean;
  cause: string | null;
  // The output of a check that failed in the last round (kept like `asked`), null otherwise.
  failedCheck: string | null;
  // A Reviewer with no result, or a check that did not run, is kept too: the relaunch runs only a new Reviewer on the same commit
  // ('review') or only Verify ('verify'), with no Builder. Null otherwise.
  resume: 'review' | 'verify' | null;
  constructor(stoppedAt: Stage, reason: string, asked = false, cause: string | null = null, failedCheck: string | null = null, resume: 'review' | 'verify' | null = null) {
    super(reason);
    this.stoppedAt = stoppedAt;
    this.asked = asked;
    this.cause = cause;
    this.failedCheck = failedCheck;
    this.resume = resume;
  }
}

// An agent that hit the usage limit: the ticket is paused, not failed. `log` is the file of the agent's stream, whose end
// the comment shows; `resetsAt` when the limit resets (ISO), null when the stream did not say.
export class Pause extends Error {
  stoppedAt: 'build' | 'review';
  log: string;
  resetsAt: string | null;
  constructor(stoppedAt: 'build' | 'review', reason: string, log: string, resetsAt: string | null) {
    super(reason);
    this.stoppedAt = stoppedAt;
    this.log = log;
    this.resetsAt = resetsAt;
  }
}
