// What a run that goes on from a dead run's ticket asks git and gh before it acts (resumes.ts decides where it starts): where
// the ticket's branch and copy are, whether the branch is already in the working branch, and whether the result comment is
// already on the ticket. Every step looks before it acts, so launching `dynamo run` again never repeats what was done.
import type { Deps } from './cli.ts';
import { parseWorktrees } from './copies.ts';
import { ticketBranches } from './merging.ts';

// The branch `ticket/<n>-*` and the copy that has it checked out; each is null when there is none.
export function findTicket(deps: Deps, n: number): { copy: string | null; branch: string | null } {
  const list = deps.git(['worktree', 'list', '--porcelain']);
  const names = deps.git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/ticket/']);
  if (list.code !== 0 || names.code !== 0) throw new Error(`git could not list the copies and branches of #${n}: ${(list.code !== 0 ? list : names).stderr.trim()}`);
  const branches = ticketBranches(names.stdout.split('\n'), n);
  if (branches.length > 1) throw new Error(`there is more than one ticket/${n}-* branch: ${branches.join(', ')}`);
  const [branch = null] = branches;
  const [, ...linked] = parseWorktrees(list.stdout);
  return { copy: branch === null ? null : linked.find((c) => c.branch === branch)?.path ?? null, branch };
}

// Whether `branch` is already in `base` (`git merge-base --is-ancestor`); any other git failure is an error.
export function isMerged(deps: Deps, branch: string, base: string): boolean {
  const r = deps.git(['merge-base', '--is-ancestor', branch, base]);
  if (r.code > 1) throw new Error(`git merge-base --is-ancestor ${branch} ${base} failed: ${r.stderr.trim()}`);
  return r.code === 0;
}

// Whether the result comment of a merged ticket (`run · PASS and merged …`, runs.ts) is already on the issue.
export function hasMergedComment(deps: Deps, repo: string, n: number): boolean {
  const r = deps.gh(['issue', 'view', String(n), '-R', repo, '--json', 'comments']);
  if (r.code !== 0) return false;
  let answer: unknown;
  try { answer = JSON.parse(r.stdout); } catch { return false; }
  const comments = typeof answer === 'object' && answer !== null ? (answer as Record<string, unknown>).comments : undefined;
  return Array.isArray(comments) && comments.some((c) => typeof c === 'object' && c !== null && typeof (c as Record<string, unknown>).body === 'string'
    && String((c as Record<string, unknown>).body).startsWith('run · PASS and merged'));
}
