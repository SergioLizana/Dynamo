// The notes `dynamo run` makes of each step of a ticket, in `steps.jsonl` of the ticket's log folder, next to the streams of
// its agents. `dynamo status` reads them back (statuses.ts). A note that cannot be written never stops the ticket: the notes
// only let someone watch it.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Note } from './statuses.ts';
import { STEPS_FILE } from './statuses.ts';

export function note(dir: string, n: Omit<Note, 'at'>): void {
  try {
    appendFileSync(join(dir, STEPS_FILE), `${JSON.stringify({ ...n, at: new Date().toISOString() })}\n`);
  } catch { /* the ticket goes on without it */ }
}

// A skipped ticket never starts, so its folder may not exist; its notes are only this one, whatever an earlier run left.
export function noteSkipped(dir: string, why: string): void {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, STEPS_FILE), `${JSON.stringify({ step: 'skipped', round: 1, text: why, at: new Date().toISOString() })}\n`);
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
