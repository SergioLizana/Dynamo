// What every subcommand shares with the entry point: the result it returns, what it is given to reach gh, git, claude and
// the config, the error that means it was called wrong, and the exit code of a call (the entry point prints the JSON line
// and sets that code; `run` reads it from the subcommands it calls).
import type { RunAgent } from './claude.ts';
import type { Options, Result } from './exec.ts';
import type { Factory } from './factory.ts';
import type { Notify } from './notify.ts';
import type { Files } from './setupfiles.ts';

export type Output = { ok: boolean; [key: string]: unknown };

// The edges, passed in so that a test can hand a subcommand fakes instead. Only `run` uses `agent` and `notify`.
export type Deps = {
  gh: (args: string[], options?: Options) => Result;
  git: (args: string[], options?: Options) => Result;
  // What takes minutes (the automatic check) and so does not block the loop: see `execAsync`.
  exec: (command: string[], args: string[], options?: Options) => Promise<Result>;
  factory: () => Factory;
  agent?: RunAgent;
  // The notice to the human (notify.ts); only `run` uses it, and a test hands it a fake edge.
  notify?: Notify;
  // The disk `setup` touches (setupfiles.ts); only `setup` uses it, and a test hands it its own.
  files?: Files;
  // The wait for an outage to end (loop.ts); with none it is real time, and a test hands it one that does not wait.
  wait?: (ms: number) => Promise<void>;
};

export type Subcommand = (args: string[], deps: Deps) => Output | Promise<Output>;

// Thrown when the arguments are wrong: the entry point exits 2 with its message.
export class UsageError extends Error {}

export function usage(message: string): never {
  throw new UsageError(message);
}

export type Exit = { code: 0 | 1 | 2; out: Output };

// A subcommand called as the entry point calls it: 0 when it did what it says, 1 when it failed, 2 when it was called
// wrong. An error it throws becomes `{ ok: false, error }`.
export async function exit(call: () => Output | Promise<Output>): Promise<Exit> {
  try {
    const out = await call();
    return { code: out.ok ? 0 : 1, out };
  } catch (e) {
    return { code: e instanceof UsageError ? 2 : 1, out: { ok: false, error: e instanceof Error ? e.message : String(e) } };
  }
}

// A text value of a block of factory.json (a whole number counts as its digits), or the error that says what is missing.
export function setting(block: unknown, blockName: string, key: string): string {
  const value = typeof block === 'object' && block !== null ? (block as Record<string, unknown>)[key] : undefined;
  const text = typeof value === 'number' && Number.isInteger(value) ? String(value) : value;
  if (typeof text !== 'string' || text === '') throw new Error(`factory.json has no ${blockName}.${key}`);
  return text;
}

// A git read that must work: its output, trimmed. A failed one throws `git <args> failed: <stderr>`.
export function read(deps: Deps, args: string[], cwd?: string): string {
  const r = deps.git(args, cwd === undefined ? {} : { cwd });
  if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
}
