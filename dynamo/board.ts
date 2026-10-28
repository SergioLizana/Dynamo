// `dynamo board [n ...]`: for each ticket (the numbers given, or every open issue) its column on the board, its done
// label, its blockers, whether it is ready and why not. It reads only those issues, never the board's list of cards.
import type { Deps, Output } from './cli.ts';
import { usage } from './cli.ts';
import { frontier } from './frontier.ts';
import { readTickets } from './tickets.ts';

export function board(args: string[], deps: Deps): Output {
  const numbers = [...new Set(args.map((a) => (/^[1-9]\d*$/.test(a) ? Number(a) : usage(`${a} is not a ticket number`))))];
  const factory = deps.factory();
  const where = {
    repo: setting(factory.project, 'project', 'repo'), boardId: setting(factory.project, 'project', 'boardId'),
    statusFieldId: setting(factory.project, 'project', 'statusFieldId'), doneLabel: setting(factory.project, 'project', 'doneLabel'),
  };
  if (!/^[\w.-]+\/[\w.-]+$/.test(where.repo)) throw new Error(`factory.json: project.repo «${where.repo}» is not owner/name`);
  const rules = { doneLabel: where.doneLabel, needsHuman: setting(factory.columns, 'columns', 'needsHuman') };
  return { ok: true, tickets: frontier(readTickets(deps.gh, where, numbers), rules) };
}

function setting(block: unknown, blockName: string, key: string): string {
  const value = typeof block === 'object' && block !== null ? (block as Record<string, unknown>)[key] : undefined;
  if (typeof value !== 'string' || value === '') throw new Error(`factory.json has no ${blockName}.${key}`);
  return value;
}
