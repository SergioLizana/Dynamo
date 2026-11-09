// The lock of a whole `dynamo run`: one file, `.claude/worktrees/run.json` of the main folder, with the pid, the start time
// and a heartbeat the run rewrites every minute. A second run while the lock is alive exits at once, because it would start
// more tickets than `ticketsAtOnce`. The lock is alive when its pid answers and its heartbeat is under 5 minutes old: the
// heartbeat is what tells a pid reused by another process from the run (the loop of a run never blocks, so it always beats).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const STALE_MS = 5 * 60_000;
export const BEAT_MS = 60_000;

export type Held = { pid: number; since: string };
export type RunLock = { release: () => void };
export type Edges = { pid: number; now: () => number; everyMs?: number; answers?: (pid: number) => boolean };

// Whether a process with this pid exists (signal 0 only asks). A pid we may not signal still exists.
export function answers(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// Who holds the lock written in `content` (unknown until checked), or null when nobody does: it is not a lock, its pid does
// not answer, or its heartbeat is `STALE_MS` old or more.
export function holderOf(content: unknown, now: number, isAlive: (pid: number) => boolean): Held | null {
  if (typeof content !== 'object' || content === null) return null;
  const { pid, since, heartbeat } = content as Record<string, unknown>;
  if (typeof pid !== 'number' || typeof since !== 'string' || typeof heartbeat !== 'string') return null;
  const beat = Date.parse(heartbeat);
  if (Number.isNaN(beat) || now - beat >= STALE_MS || !isAlive(pid)) return null;
  return { pid, since };
}

// What the lock file holds, unknown until checked (null when it is missing or not JSON).
export function readLock(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// Takes the lock of the run at `file`, or says who holds it. The file is created only if it does not exist (`wx`); one that
// is there is replaced only when it holds nothing alive. The heartbeat does not keep the process from ending.
export function takeLock(file: string, edges: Edges): RunLock | { held: Held } {
  const isAlive = edges.answers ?? answers;
  const since = new Date(edges.now()).toISOString();
  const write = (flag: 'wx' | 'w') => writeFileSync(file, JSON.stringify({ pid: edges.pid, since, heartbeat: new Date(edges.now()).toISOString() }), { flag });
  mkdirSync(dirname(file), { recursive: true });
  try {
    write('wx');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    const held = holderOf(readLock(file), edges.now(), isAlive);
    if (held !== null) return { held };
    write('w');
  }
  const ours = () => (readLock(file) as { pid?: unknown } | null)?.pid === edges.pid;
  let ended = false;
  const timer = setInterval(() => {
    if (!ended && ours()) write('w');
  }, edges.everyMs ?? BEAT_MS);
  timer.unref();
  return {
    release: () => {
      ended = true;
      clearInterval(timer);
      if (ours()) rmSync(file, { force: true });
    },
  };
}
