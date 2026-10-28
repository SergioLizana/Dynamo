// A card on the board as data: where it lives (the `project` block of factory.json), the option id of a column (`options`),
// the gh arguments that move it and read it, and the column a read-back says it is in. Pure: the subcommand `card` runs them.
import { setting } from './cli.ts';

export type Where = { repo: string; owner: string; number: string; boardName: string };
export type Status = { name: string | null; optionId: string | null };

export function where(project: Record<string, unknown>): Where {
  const w = {
    repo: setting(project, 'project', 'repo'), owner: setting(project, 'project', 'boardOwner'),
    number: setting(project, 'project', 'boardNumber'), boardName: setting(project, 'project', 'boardName'),
  };
  if (!/^[\w.-]+\/[\w.-]+$/.test(w.repo)) throw new Error(`factory.json: project.repo «${w.repo}» is not owner/name`);
  return w;
}

// The option id of a column, or null when factory.json does not know it. Own keys only: «toString» is not a column.
export function optionOf(options: unknown, column: string): string | null {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) throw new Error('factory.json has no options');
  const id = Object.hasOwn(options, column) ? (options as Record<string, unknown>)[column] : undefined;
  return typeof id === 'string' && id !== '' ? id : null;
}

export function columns(options: unknown): string[] {
  return typeof options === 'object' && options !== null ? Object.keys(options) : [];
}

// By the issue URL and the column name, as `documentation/github-board.md` says: it needs no card id, so no list of cards.
export function moveArgs(w: Where, n: number, column: string): string[] {
  return ['project', 'item-edit', w.number, '--owner', w.owner, '--url', `https://github.com/${w.repo}/issues/${n}`, '--field', 'Status', '--value', column];
}

export function viewArgs(w: Where, n: number): string[] {
  return ['issue', 'view', String(n), '-R', w.repo, '--json', 'projectItems'];
}

// The status of the card on our board in what `gh issue view --json projectItems` printed; unknown until checked. A card
// on no board, on another one, or with no state has no name.
export function statusOf(json: string, boardName: string): Status {
  let data: unknown;
  try { data = JSON.parse(json); } catch { throw new Error('gh did not print JSON for projectItems'); }
  const items = typeof data === 'object' && data !== null ? (data as Record<string, unknown>).projectItems : undefined;
  if (!Array.isArray(items)) throw new Error('gh printed no projectItems list');
  const item = items.find((i): i is Record<string, unknown> => typeof i === 'object' && i !== null && (i as Record<string, unknown>).title === boardName);
  const status = item?.status;
  if (typeof status !== 'object' || status === null) return { name: null, optionId: null };
  const { name, optionId } = status as Record<string, unknown>;
  return { name: typeof name === 'string' ? name : null, optionId: typeof optionId === 'string' ? optionId : null };
}

// How many times a card is moved before it fails: the move, and once more.
export const MOVES = 2;

export type Step = 'already' | 'done' | 'again' | 'fail';

// What to do with a card after reading it, given the option id of the wanted column and the moves made so far: leave it
// (it was there before any move), finish (it got there), move it again, or give up.
export function decide(status: Status, optionId: string, moves: number): Step {
  if (status.optionId === optionId) return moves === 0 ? 'already' : 'done';
  return moves < MOVES ? 'again' : 'fail';
}
