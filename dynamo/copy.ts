// `dynamo copy add <n>` makes ticket n's copy of the repository: a git worktree on a new branch `ticket/<n>-<slug>`, started
// at the tip of the working branch, in a gitignored folder of the main folder. `dynamo copy remove <n>` deletes the copy
// and the branch, but only a branch that is in the working branch: a ticket that was blocked keeps both for the human.
// A copy left detached at the ticket's path is removed too, if its commit is in the working branch. `add` says so when a
// folder that git does not know is in the way, and does not touch it.
// Neither touches the main folder's branch or files, so they run from any copy too.
import type { Deps, Output } from './cli.ts';
import { read, usage } from './cli.ts';
import { endOf } from './checks.ts';
import { branchName, copyPath, parseWorktrees, refuseAdd, removal, titleOf } from './copies.ts';
import type { Copy } from './copies.ts';
import { occupied } from './disk.ts';
import type { Settings } from './merging.ts';
import { settings, ticketBranches } from './merging.ts';
import { releaseBranch } from './working.ts';

export function copy(args: string[], deps: Deps): Output {
  const [action, number, ...rest] = args;
  if ((action !== 'add' && action !== 'remove') || !/^[1-9]\d*$/.test(number ?? '') || rest.length > 0) usage('usage: copy add|remove <n>');
  const n = Number(number);
  const s = settings(deps.factory().project, releaseBranch(deps));

  const [main, ...linked] = copies(deps);
  const branches = read(deps, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/']).split('\n');
  return action === 'add'
    ? add(n, s, { root: main.path, linked, branches }, deps)
    : remove(n, s.base, { root: main.path, linked, branches }, deps);
}

type Found = { root: string; linked: Copy[]; branches: string[] };

function add(n: number, s: Settings, found: Found, deps: Deps): Output {
  const view = deps.gh(['issue', 'view', String(n), '-R', s.repo, '--json', 'title']);
  if (view.code !== 0) throw new Error(`the title of #${n} could not be read: ${endOf(view)}`);
  const title = titleOf(view.stdout);
  if (title === null) throw new Error(`#${n} has no title to make the branch from`);

  const path = copyPath(found.root, n);
  // A path that does not exist yet is checked through a file inside it: a folder pattern only matches what is known as one.
  const ignore = deps.git(['check-ignore', '-q', `${path}/x`], { cwd: found.root });
  if (ignore.code > 1) throw new Error(`git check-ignore failed: ${ignore.stderr.trim()}`);
  const why = refuseAdd({ n, base: s.base, main: s.main, branches: found.branches, copies: found.linked, path, ignored: ignore.code === 0, occupied: occupied(path) });
  if (why !== null) throw new Error(`no copy was made: ${why}`);

  const branch = branchName(n, title);
  const made = deps.git(['worktree', 'add', '-b', branch, path, s.base]);
  if (made.code !== 0) throw new Error(`no copy was made: git worktree add ${branch} from ${s.base} failed: ${endOf(made)}`);
  return { ok: true, ticket: n, branch, base: s.base, path, commit: read(deps, ['rev-parse', '--short', 'HEAD'], path) };
}

function remove(n: number, base: string, found: Found, deps: Deps): Output {
  const merged: string[] = [];
  for (const branch of ticketBranches(found.branches, n)) {
    if (isIn(deps, branch, base)) merged.push(branch);
  }
  // A copy detached at the ticket's path has no branch to ask about: its own commit is asked instead.
  const path = copyPath(found.root, n);
  const detached = found.linked.some((c) => c.branch === null && c.path === path);
  const detachedMerged = detached && isIn(deps, 'HEAD', base, path);
  const plan = removal({ n, base, path, branches: found.branches, copies: found.linked, merged, detachedMerged });
  if ('why' in plan) throw new Error(`nothing was removed: ${plan.why}`);

  // No --force: a copy with changes that were never committed is the Builder's work, and git refuses to remove it.
  const kept = plan.branch === null ? '' : ` and ${plan.branch}`;
  if (plan.copy !== null) {
    const r = deps.git(['worktree', 'remove', plan.copy]);
    if (r.code !== 0) throw new Error(`nothing was removed: the copy ${plan.copy}${kept} are kept: ${endOf(r)}`);
  }
  if (plan.branch === null) return { ok: true, ticket: n, base, removedCopy: true, path: plan.copy };
  // -D, since `-d` asks whether the branch is in the folder's own branch, which need not be the working one: it was
  // checked above against the working branch.
  const r = deps.git(['branch', '-D', plan.branch]);
  if (r.code !== 0) throw new Error(`${plan.copy === null ? '' : 'the copy was removed, but '}${plan.branch} was not deleted: ${endOf(r)}`);
  return { ok: true, ticket: n, branch: plan.branch, base, removedCopy: plan.copy !== null, ...(plan.copy === null ? {} : { path: plan.copy }) };
}

// Whether `rev` (read in `cwd` when given) is in `base`; any other git failure is an error.
function isIn(deps: Deps, rev: string, base: string, cwd?: string): boolean {
  const r = deps.git(['merge-base', '--is-ancestor', rev, base], cwd === undefined ? {} : { cwd });
  if (r.code > 1) throw new Error(`git merge-base --is-ancestor ${rev} ${base} failed: ${r.stderr.trim()}`);
  return r.code === 0;
}

// The copies git lists, the main folder first.
function copies(deps: Deps): Copy[] {
  const list = parseWorktrees(read(deps, ['worktree', 'list', '--porcelain']));
  if (list.length === 0) throw new Error('git worktree list gave no folder');
  return list;
}
