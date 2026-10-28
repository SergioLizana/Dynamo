// The copies of a run as data: the name of a ticket's branch and folder, what git says about the copies that exist, and
// the reasons not to make or not to remove one. Pure: the subcommand `copy` reads git and gh and runs it.
import { posix } from 'node:path';
import { ticketBranches } from './merging.ts';

// Where the copies go, inside the repository and gitignored (`.gitignore` holds it), so `git status` shows nothing.
const FOLDER = '.claude/worktrees';
const SLUG_MAX = 40;

export type Copy = { path: string; branch: string | null };

// The title as words in lower case joined by «-», cut before the word that would pass SLUG_MAX. With no letters or
// digits at all it is «ticket», so a branch is never `ticket/<n>-`.
export function slug(title: string): string {
  const words = title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w !== '');
  let out = '';
  for (const word of words) {
    const next = out === '' ? word : `${out}-${word}`;
    if (next.length > SLUG_MAX) {
      if (out === '') out = word.slice(0, SLUG_MAX);
      break;
    }
    out = next;
  }
  return out === '' ? 'ticket' : out;
}

export function branchName(n: number, title: string): string {
  return `ticket/${n}-${slug(title)}`;
}

// Forward slashes, which git takes on every system and prints on Windows too.
export function copyPath(root: string, n: number): string {
  return posix.join(root.replace(/\\/g, '/'), FOLDER, `ticket-${n}`);
}

// The copies of `git worktree list --porcelain`: blocks apart by a blank line, `worktree <path>` first, and `branch
// refs/heads/<name>` unless the copy is detached. The first one is the main folder.
export function parseWorktrees(porcelain: string): Copy[] {
  const copies: Copy[] = [];
  for (const block of porcelain.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const path = lines.find((l) => l.startsWith('worktree '));
    if (path === undefined) continue;
    const branch = lines.find((l) => l.startsWith('branch refs/heads/'));
    copies.push({ path: path.slice('worktree '.length), branch: branch === undefined ? null : branch.slice('branch refs/heads/'.length) });
  }
  return copies;
}

// The title of `gh issue view --json title`, unknown until read.
export function titleOf(json: string): string | null {
  let answer: unknown;
  try { answer = JSON.parse(json); } catch { return null; }
  const title = typeof answer === 'object' && answer !== null ? (answer as Record<string, unknown>).title : undefined;
  return typeof title === 'string' && title.trim() !== '' ? title : null;
}

export type AddState = { n: number; base: string; main: string; branches: string[]; copies: Copy[]; path: string; ignored: boolean };

// The first reason not to make the copy, or null. `branches` are all local branch names, `copies` the linked ones. Nothing
// has been changed when one applies.
export function refuseAdd(s: AddState): string | null {
  if (s.base === s.main) return `the working branch is the main branch (${s.main}): no ticket is built from it`;
  const branches = ticketBranches(s.branches, s.n);
  if (branches.length > 0) return `there is already a ticket/${s.n}-* branch: ${branches.join(', ')}`;
  const here = s.copies.filter((c) => c.path === s.path || (c.branch !== null && ticketBranches([c.branch], s.n).length > 0));
  if (here.length > 0) return `there is already a copy of ticket ${s.n}: ${here.map((c) => c.path).join(', ')}`;
  if (!s.ignored) return `${s.path} is not ignored by git: the main folder would show it`;
  return null;
}

// `merged` are the ticket's branches that are in the working branch.
export type RemoveState = { n: number; base: string; branches: string[]; copies: Copy[]; merged: string[] };
export type Removal = { why: string } | { branch: string; copy: string | null };

// What to remove: the ticket's one branch and its copy, only when the branch is in the working branch. Otherwise the
// reason, and nothing is removed.
export function removal(s: RemoveState): Removal {
  const branches = ticketBranches(s.branches, s.n);
  const mine = s.copies.filter((c) => c.branch !== null && ticketBranches([c.branch], s.n).length > 0);
  if (branches.length === 0) {
    if (mine.length === 0) return { why: `there is nothing of ticket ${s.n} to remove (no ticket/${s.n}-* branch, no copy)` };
    return { why: `there is no ticket/${s.n}-* branch to remove; the copy ${mine[0].path} is kept` };
  }
  if (branches.length > 1) return { why: `there is more than one ticket/${s.n}-* branch: ${branches.join(', ')}` };
  const [branch] = branches;
  const copy = mine.find((c) => c.branch === branch)?.path ?? null;
  if (!s.merged.includes(branch)) return { why: `${branch} is not merged into ${s.base}: ${copy === null ? 'branch' : 'copy and branch'} kept` };
  return { branch, copy };
}
