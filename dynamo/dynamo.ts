// dynamo: the deterministic steps of the factory as a program of our own (documentation/orchestrator-review.md, phase 1).
// `node dynamo/dynamo.ts <subcommand> [arguments]`. It runs git and gh itself. Every call prints one short JSON line and
// exits with a real code: 0 when the subcommand did what it says, 1 when it failed, 2 when it was called wrong.

type Output = { ok: boolean; [key: string]: unknown };

// Each subcommand comes with its own ticket.
const subcommands = new Map<string, (args: string[]) => Output>();

function main(argv: string[]): number {
  const [name, ...args] = argv;
  const run = name === undefined ? undefined : subcommands.get(name);
  if (!run) {
    print({ ok: false, error: name === undefined ? 'no subcommand' : `unknown subcommand: ${name}` });
    return 2;
  }
  try {
    const out = run(args);
    print(out);
    return out.ok ? 0 : 1;
  } catch (e) {
    print({ ok: false, error: e instanceof Error ? e.message : String(e) });
    return 1;
  }
}

function print(out: Output): void {
  process.stdout.write(JSON.stringify(out) + '\n');
}

process.exitCode = main(process.argv.slice(2));
