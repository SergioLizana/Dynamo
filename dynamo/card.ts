// `dynamo card <n> <column>`: moves the card of ticket n to a column of the board and checks it by reading that one issue
// again, never the board's list of cards. A card already in the column is not moved; one that is not there after the
// move is moved once more, and if it is still not there it fails.
import type { Deps, Output } from './cli.ts';
import { usage } from './cli.ts';
import { endOf } from './checks.ts';
import { columns, decide, moveArgs, optionOf, statusOf, viewArgs, where } from './cards.ts';

export function card(args: string[], deps: Deps): Output {
  if (args.length !== 2 || !/^[1-9]\d*$/.test(args[0]) || args[1] === '') usage('usage: card <n> <column>');
  const n = Number(args[0]);
  const column = args[1];
  const factory = deps.factory();
  const w = where(factory.project);
  const optionId = optionOf(factory.options, column);
  if (optionId === null) usage(`${column} is not a column of factory.json (${columns(factory.options).join(', ')})`);

  // The card is in the column when its option id is the column's: the name alone could belong to another option.
  const read = () => {
    const r = deps.gh(viewArgs(w, n));
    if (r.code !== 0) throw new Error(`could not read #${n}: ${endOf(r)}`);
    return statusOf(r.stdout, w.boardName);
  };
  let status = read();
  let moves = 0;
  let refused = '';
  for (let step = decide(status, optionId, moves); step === 'again'; step = decide(status, optionId, moves)) {
    const r = deps.gh(moveArgs(w, n, column));
    refused = r.code === 0 ? '' : endOf(r);
    moves++;
    status = read();
  }
  const step = decide(status, optionId, moves);
  if (step === 'already' || step === 'done') return { ok: true, ticket: n, column, moved: step === 'done' };
  return { ok: false, ticket: n, column, found: status.name, error: `the card of #${n} did not move to ${column}${refused === '' ? '' : `: ${refused}`}` };
}
