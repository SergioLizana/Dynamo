// `dynamo board [n ...]`: for each ticket (the numbers given, or every open issue) its column on the board, its done
// label, its blockers, whether it is ready and why not. It reads only those issues, never the board's list of cards.
import type { Deps, Output } from './cli.ts';
import { setting, usage } from './cli.ts';
import { COLUMNS } from './columns.ts';
import type { Row } from './frontier.ts';
import { frontier } from './frontier.ts';
import { readTickets } from './tickets.ts';

export function board(args: string[], deps: Deps): Output {
  const numbers = [...new Set(args.map((a) => (/^[1-9]\d*$/.test(a) ? Number(a) : usage(`${a} is not a ticket number`))))];
  return { ok: true, tickets: rows(numbers, deps) };
}

// The rows of the tickets given (every open issue when none is), as `run` reads them for its list.
export function rows(numbers: number[], deps: Deps): Row[] {
  const factory = deps.factory();
  const where = {
    repo: setting(factory.project, 'project', 'repo'), boardId: setting(factory.board, 'board', 'boardId'),
    statusFieldId: setting(factory.board, 'board', 'statusFieldId'), doneLabel: setting(factory.project, 'project', 'doneLabel'),
  };
  if (!/^[\w.-]+\/[\w.-]+$/.test(where.repo)) throw new Error(`factory.json: project.repo «${where.repo}» is not owner/name`);
  const rules = { doneLabel: where.doneLabel, todo: COLUMNS.todo };
  return frontier(readTickets(deps.gh, where, numbers), rules);
}
