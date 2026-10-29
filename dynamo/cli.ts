// What every subcommand shares with the entry point: the result it returns, what it is given to reach gh, git, claude and
// the config, the error that means it was called wrong, and the exit code of a call (the entry point prints the JSON line
// and sets that code; `run` reads it from the subcommands it calls).
import type { RunAgent } from './claude.ts';
import type { Options, Result } from './exec.ts';
import type { Factory } from './factory.ts';

export type Output = { ok: boolean; [key: string]: unknown };

// The edges, passed in so that a test can hand a subcommand fakes instead. Only `run` uses `agent`.
export type Deps = {
  gh: (args: string[], options?: Options) => Result;
  git: (args: string[], options?: Options) => Result;
  exec: (command: string[], args: string[], options?: Options) => Result;
  factory: () => Factory;
  agent?: RunAgent;
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
