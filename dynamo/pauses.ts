// The comment of a paused ticket, as data (the usage limit pauses the ticket). Pure: the loop reads the end of the agent's log and posts the comment. It starts
// with «run · » like the result comment, so `dynamo report` reads it as the ticket's last run.
import { ROUNDS } from './rounds.ts';
import { total } from './runs.ts';
import type { Spent } from './runs.ts';

// The end of an agent's log as it was written: its last few lines, cut to the last `max` characters. It shows what claude
// printed when it stopped.
export function rawEnd(log: string, lines = 6, max = 3000): string {
  const tail = log.replace(/\r\n/g, '\n').trimEnd().split('\n').slice(-lines).join('\n');
  return tail.length > max ? `…${tail.slice(-max)}` : tail;
}

export type Paused = {
  stoppedAt: 'build' | 'review';
  reason: string;
  round: number;
  // The agent's log, as the path the human opens, and what rawEnd took from it.
  log: string;
  raw: string;
  // When the limit resets (ISO), or null when the stream did not say; and what the ticket's agents cost so far.
  resetsAt: string | null;
  spent: Spent[];
  // The copy and branch the ticket keeps, or null when no copy was made.
  left: { copy: string; branch: string } | null;
};

export function pausedComment(p: Paused, n: number): string {
  // A fence longer than any run of backticks in the raw text, so that it cannot close the block early.
  const fence = '`'.repeat(Math.max(3, ...(p.raw.match(/`+/g) ?? []).map((r) => r.length + 1)));
  const remove = p.left === null ? [] : [`\`git worktree remove --force ${p.left.copy}\`, then \`git branch -D ${p.left.branch}\`, and `];
  const { cost, turns } = total(p.spent);
  return [
    'run · paused',
    `Paused at: ${p.stoppedAt}`,
    `Rounds: ${p.round}/${ROUNDS} (a pause spends no round; the card stays where it is, not in Needs Human)`,
    `Resets at: ${p.resetsAt ?? 'unknown (the stream did not say)'}`,
    `Cost so far: ${cost.toFixed(4)} USD in ${turns} turns (${p.spent.length} agent runs)`,
    `Reason: ${p.reason.trim().split('\n').join('\n  ')}`,
    `Left: ${p.left === null ? 'nothing' : `the copy ${p.left.copy} and the branch ${p.left.branch}`}`,
    `Raw end of the agent (the whole log is in ${p.log}):`,
    fence,
    p.raw === '' ? '(the log is empty)' : p.raw,
    fence,
    `To relaunch: when the limit is over, ${remove.join('')}launch \`/dynamo:autopilot ${n}\` (or the whole list again: the merged tickets are not taken twice).`,
  ].join('\n') + '\n';
}
