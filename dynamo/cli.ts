// What every subcommand shares with the entry point: the result it returns, what it is given to reach gh, git and the
// config, and the error that means it was called wrong (the entry point prints the JSON line and sets the exit code).
import type { Options, Result } from './exec.ts';
import type { Factory } from './factory.ts';

export type Output = { ok: boolean; [key: string]: unknown };

// The edges, passed in so that a test can hand a subcommand fakes instead.
export type Deps = {
  gh: (args: string[], options?: Options) => Result;
  git: (args: string[], options?: Options) => Result;
  exec: (command: string[], args: string[], options?: Options) => Result;
  factory: () => Factory;
};

export type Subcommand = (args: string[], deps: Deps) => Output;

// Thrown when the arguments are wrong: the entry point exits 2 with its message.
export class UsageError extends Error {}

export function usage(message: string): never {
  throw new UsageError(message);
}

// A text value of a block of factory.json (a whole number counts as its digits), or the error that says what is missing.
export function setting(block: unknown, blockName: string, key: string): string {
  const value = typeof block === 'object' && block !== null ? (block as Record<string, unknown>)[key] : undefined;
  const text = typeof value === 'number' && Number.isInteger(value) ? String(value) : value;
  if (typeof text !== 'string' || text === '') throw new Error(`factory.json has no ${blockName}.${key}`);
  return text;
}
