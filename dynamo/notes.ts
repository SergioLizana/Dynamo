// The notes `dynamo run` makes of each step of a ticket, in `steps.jsonl` of the ticket's log folder, next to the streams of
// its agents. `dynamo status` reads them back (statuses.ts). A note that cannot be written never stops the ticket: the notes
// only let someone watch it.
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Note } from './statuses.ts';
import { STEPS_FILE, latestAttemptOf } from './statuses.ts';

export function note(dir: string, n: Omit<Note, 'at'>): void {
  try {
    appendFileSync(join(dir, STEPS_FILE), `${JSON.stringify({ ...n, at: new Date().toISOString() })}\n`);
  } catch { /* the ticket goes on without it */ }
}

// The number of the latest attempt in a ticket's log folder (`logs/<n>/`); 0 when the ticket has none yet or the folder is not there.
export function latestAttempt(ticketLogs: string): number {
  try {
    return latestAttemptOf(readdirSync(ticketLogs));
  } catch {
    return 0;
  }
}

// A skipped ticket never starts, so its folder may not exist; it is one more attempt whose notes are only this one, and the earlier attempts stay.
export function noteSkipped(dir: string, why: string): void {
  try {
    const attempt = join(dir, `attempt-${latestAttempt(dir) + 1}`);
    mkdirSync(attempt, { recursive: true });
    writeFileSync(join(attempt, STEPS_FILE), `${JSON.stringify({ step: 'skipped', round: 1, text: why, at: new Date().toISOString() })}\n`);
  } catch { /* the list goes on without it */ }
}

// The text of an agent's log, or nothing when it cannot be read: the comment of a paused ticket shows its end.
export function readLog(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}
