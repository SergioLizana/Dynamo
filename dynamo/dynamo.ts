// dynamo: the deterministic steps of the factory as a program of our own (documentation/orchestrator-review.md, phase 1).
// `node dynamo/dynamo.ts <subcommand> [arguments]`. It runs git and gh itself. Every call prints one short JSON line and
// exits with a real code: 0 when the subcommand did what it says, 1 when it failed, 2 when it was called wrong.
import type { Output, Subcommand } from './cli.ts';
import { exit } from './cli.ts';
import { runAgent } from './claude.ts';
import { exec } from './exec.ts';
import { readFactory } from './factory.ts';
import { gh } from './gh.ts';
import { git } from './git.ts';
import { board } from './board.ts';
import { card } from './card.ts';
import { comment } from './comment.ts';
import { copy } from './copy.ts';
import { merge } from './merge.ts';
import { report } from './report.ts';
import { run } from './run.ts';
import { status } from './status.ts';
import { verify } from './verify.ts';

// Each subcommand comes with its own ticket: its module, and its line here.
const subcommands = new Map<string, Subcommand>([
  ['board', board],
  ['verify', verify],
  ['merge', merge],
  ['card', card],
  ['comment', comment],
  ['copy', copy],
  ['report', report],
  ['run', run],
  ['status', status],
]);

async function main(argv: string[]): Promise<number> {
  const [name, ...args] = argv;
  const subcommand = name === undefined ? undefined : subcommands.get(name);
  if (!subcommand) {
    print({ ok: false, error: name === undefined ? 'no subcommand' : `unknown subcommand: ${name}` });
    return 2;
  }
  const { code, out } = await exit(() => subcommand(args, { gh, git, exec, factory: () => readFactory(), agent: runAgent }));
  print(out);
  return code;
}

function print(out: Output): void {
  process.stdout.write(JSON.stringify(out) + '\n');
}

process.exitCode = await main(process.argv.slice(2));
