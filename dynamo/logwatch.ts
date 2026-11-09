// Watches the log of an agent while it runs and says when its `result` line is there. The log is claude's stdout itself, so
// it grows as the agent works; only the bytes that are new are read, and a line cut in half waits for the rest of it.
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { isAgentEnd, parseLine } from './agents.ts';

// How often the log is looked at (ms); a shorter grace is looked at more often, so the tests do not wait for it.
const EVERY = 500;

// Calls `found` once, the first time a line of `log` is the end of the agent (a `result` that is not a task notification's),
// and stops looking. Returns the function that stops it (the caller calls it when the agent ends).
export function watchForResult(log: string, found: () => void, every = EVERY): () => void {
  let offset = 0;
  let rest = Buffer.alloc(0);
  const tick = () => {
    let size: number;
    try { size = statSync(log).size; } catch { return; }
    if (size <= offset) return;
    const chunk = Buffer.alloc(size - offset);
    const fd = openSync(log, 'r');
    try { readSync(fd, chunk, 0, chunk.length, offset); } finally { closeSync(fd); }
    offset = size;
    const all = Buffer.concat([rest, chunk]);
    const cut = all.lastIndexOf(0x0a) + 1; // what follows the last newline is a line not finished yet
    rest = all.subarray(cut);
    if (all.subarray(0, cut).toString('utf8').split('\n').some((l) => isAgentEnd(parseLine(l)))) {
      stop();
      found();
    }
  };
  const timer = setInterval(tick, every);
  const stop = () => clearInterval(timer);
  return stop;
}
