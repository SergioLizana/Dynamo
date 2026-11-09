// The part of `dynamo setup` that talks to GitHub about the board and the labels: copy the template board for the project,
// link it to the repository, read its ids back, and create the two labels the factory needs. The decisions are in setups.ts;
// this module only calls gh, which it is given. The owner is always passed by name (`--target-owner @me` failed in the probe).
import type { Deps } from './cli.ts';
import { endOf } from './checks.ts';
import { TEMPLATE_BOARD, boardOf, boardTitle, copiedNumber, missingLabels } from './setups.ts';
import type { Board } from './setups.ts';

type Gh = Deps['gh'];

// A copy of the template board, titled as the repository and owned by `owner`, and linked to the repository (a copy loses
// that link). Returns its number. A failed link leaves the copy made, so the error names it.
export function copyBoard(gh: Gh, root: string, owner: string, repo: string): number {
  const copy = gh(['project', 'copy', String(TEMPLATE_BOARD.number), '--source-owner', TEMPLATE_BOARD.owner, '--target-owner', owner, '--title', boardTitle(repo), '--format', 'json'], { cwd: root });
  if (copy.code !== 0) throw new Error(`the template board could not be copied: ${endOf(copy)}; nothing was written`);
  const number = copiedNumber(copy.stdout);
  if (number === null) throw new Error('gh gave no number for the copied board; nothing was written');
  const link = gh(['project', 'link', String(number), '--owner', owner, '--repo', repo], { cwd: root });
  if (link.code !== 0) throw new Error(`board ${number} was copied but could not be linked to ${repo}: ${endOf(link)}; nothing was written`);
  return number;
}

// The ids of board `number`, always read back from GitHub: the id of the Status field changes in a copy, and a column
// renamed on the board gets a new one.
export function readBoard(gh: Gh, root: string, owner: string, number: number): Board {
  const n = String(number);
  const view = gh(['project', 'view', n, '--owner', owner, '--format', 'json'], { cwd: root });
  if (view.code !== 0) throw new Error(`board ${number} could not be read: ${endOf(view)}`);
  const fields = gh(['project', 'field-list', n, '--owner', owner, '--format', 'json'], { cwd: root });
  if (fields.code !== 0) throw new Error(`the fields of board ${number} could not be read: ${endOf(fields)}`);
  return boardOf(number, view.stdout, fields.stdout);
}

// Creates the labels of `wanted` that the repository does not have. Returns the ones it created.
export function ensureLabels(gh: Gh, root: string, repo: string, wanted: string[]): string[] {
  const list = gh(['label', 'list', '-R', repo, '--json', 'name', '--limit', '1000'], { cwd: root });
  if (list.code !== 0) throw new Error(`the labels of ${repo} could not be read: ${endOf(list)}`);
  const missing = missingLabels(list.stdout, wanted);
  for (const name of missing) {
    const made = gh(['label', 'create', name, '-R', repo], { cwd: root });
    if (made.code !== 0) throw new Error(`the label ${name} could not be created in ${repo}: ${endOf(made)}`);
  }
  return missing;
}
