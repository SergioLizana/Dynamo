// `dynamo status [--json] [--logs <folder>]`: one row per ticket of the run, read only from the log folder that `dynamo run`
// writes (`.claude/worktrees/logs/<n>/` of the main folder): column, round, the agent's last step, turns and cost; then the
// blocked and the skipped tickets with their reason. It runs no gh and no git, so it is quick to call while a list runs.
// Without `--json` the line also carries `table`, the same as lines for a person.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Deps, Output } from './cli.ts';
import { usage } from './cli.ts';
import { projectRoot } from './factory.ts';
import type { LogFolder } from './statuses.ts';
import { latestAttemptOf, statusOf, table } from './statuses.ts';

export function status(args: string[], _deps: Deps): Output {
  const at = args.indexOf('--logs');
  const rest = at === -1 ? args : args.filter((_, i) => i !== at && i !== at + 1);
  if (rest.some((a) => a !== '--json') || (at !== -1 && !args[at + 1])) usage('usage: status [--json] [--logs <folder>]');
  const logs = at === -1 ? join(projectRoot(), '.claude', 'worktrees', 'logs') : args[at + 1];
  const result = statusOf(readLogs(logs));
  return { ok: true, ...result, ...(args.includes('--json') ? {} : { table: table(result) }) };
}

// The ticket folders of the log folder with the text of the files of the latest attempt of each (`attempt-<k>`; the earlier
// ones are not read). A file that goes away while it is read is left out; a missing log folder is a run that never started.
function readLogs(logs: string): LogFolder[] {
  const found: LogFolder[] = [];
  for (const d of safe(() => readdirSync(logs, { withFileTypes: true }), [])) {
    if (!d.isDirectory() || !/^[1-9]\d*$/.test(d.name)) continue;
    const files: Record<string, string> = {};
    const attempt = latestAttemptOf(safe(() => readdirSync(join(logs, d.name)), []));
    if (attempt === 0) continue;
    const dir = join(logs, d.name, `attempt-${attempt}`);
    for (const name of safe(() => readdirSync(dir), [])) {
      const text = safe(() => readFileSync(join(dir, name), 'utf8'), null);
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
