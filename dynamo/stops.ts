// The two ways a ticket's steps end before the merge, thrown from the loop (loop.ts) and caught where its comment is made.
import type { Stage } from './rounds.ts';

// A step that stops the ticket (Needs Human), with where it stopped.
export class Stop extends Error {
  stoppedAt: Stage;
  constructor(stoppedAt: Stage, reason: string) {
    super(reason);
    this.stoppedAt = stoppedAt;
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
