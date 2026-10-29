// `dynamo status [--json] [--logs <folder>]`: one row per ticket of the run, read only from the log folder that `dynamo run`
// writes (`.claude/worktrees/logs/<n>/` of the main folder): column, round, the agent's last step, turns and cost; then the
// blocked and the skipped tickets with their reason. It runs no gh and no git, so it is quick to call while a list runs.
// Without `--json` the line also carries `table`, the same as lines for a person.
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Deps, Output } from './cli.ts';
import { usage } from './cli.ts';
import { ROOT } from './factory.ts';
import type { LogFolder } from './statuses.ts';
import { statusOf, table } from './statuses.ts';

export function status(args: string[], _deps: Deps): Output {
  const at = args.indexOf('--logs');
  const rest = at === -1 ? args : args.filter((_, i) => i !== at && i !== at + 1);
  if (rest.some((a) => a !== '--json') || (at !== -1 && !args[at + 1])) usage('usage: status [--json] [--logs <folder>]');
  const logs = at === -1 ? join(mainOf(ROOT), '.claude', 'worktrees', 'logs') : args[at + 1];
  const result = statusOf(readLogs(logs));
  return { ok: true, ...result, ...(args.includes('--json') ? {} : { table: table(result) }) };
}

// The main folder of the repository: a copy lives in `<main>/.claude/worktrees/<name>`, and its logs are the main one's.
export function mainOf(root: string): string {
  const worktrees = dirname(root);
  return basename(worktrees) === 'worktrees' && basename(dirname(worktrees)) === '.claude' ? dirname(dirname(worktrees)) : root;
}

// The ticket folders of the log folder with the text of their files. A file that goes away while it is read (a new run of
// the ticket empties its folder) is left out; a missing log folder is a run that never started.
function readLogs(logs: string): LogFolder[] {
  const found: LogFolder[] = [];
  for (const d of safe(() => readdirSync(logs, { withFileTypes: true }), [])) {
    if (!d.isDirectory() || !/^[1-9]\d*$/.test(d.name)) continue;
    const files: Record<string, string> = {};
    for (const name of safe(() => readdirSync(join(logs, d.name)), [])) {
      const text = safe(() => readFileSync(join(logs, d.name, name), 'utf8'), null);
      if (text !== null && name.endsWith('.jsonl')) files[name] = text;
    }
    found.push({ ticket: Number(d.name), files });
  }
  return found;
}

function safe<T>(read: () => T, otherwise: T): T {
  try {
    return read();
  } catch {
    return otherwise;
  }
}
