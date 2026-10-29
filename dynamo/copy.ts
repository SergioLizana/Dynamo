// `dynamo copy add <n>` makes ticket n's copy of the repository: a git worktree on a new branch `ticket/<n>-<slug>`, started
// at the tip of the working branch, in a gitignored folder of the main folder. `dynamo copy remove <n>` deletes the copy
// and the branch, but only a branch that is in the working branch: a ticket that was blocked keeps both for the human.
// Neither touches the main folder's branch or files, so they run from any copy too.
import type { Deps, Output } from './cli.ts';
import { usage } from './cli.ts';
import { endOf } from './checks.ts';
import { branchName, copyPath, parseWorktrees, refuseAdd, removal, titleOf } from './copies.ts';
import type { Copy } from './copies.ts';
import type { Settings } from './merging.ts';
import { settings, ticketBranches } from './merging.ts';

export function copy(args: string[], deps: Deps): Output {
  const [action, number, ...rest] = args;
  if ((action !== 'add' && action !== 'remove') || !/^[1-9]\d*$/.test(number ?? '') || rest.length > 0) usage('usage: copy add|remove <n>');
  const n = Number(number);
  const s = settings(deps.factory().project);

  const [main, ...linked] = copies(deps);
  const branches = read(deps, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/']).split('\n');
  return action === 'add'
    ? add(n, s, { root: main.path, linked, branches }, deps)
    : remove(n, s.base, { linked, branches }, deps);
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
  const why = refuseAdd({ n, base: s.base, main: s.main, branches: found.branches, copies: found.linked, path, ignored: ignore.code === 0 });
  if (why !== null) throw new Error(`no copy was made: ${why}`);

  const branch = branchName(n, title);
  const made = deps.git(['worktree', 'add', '-b', branch, path, s.base]);
  if (made.code !== 0) throw new Error(`no copy was made: git worktree add ${branch} from ${s.base} failed: ${endOf(made)}`);
  return { ok: true, ticket: n, branch, base: s.base, path, commit: read(deps, ['rev-parse', '--short', 'HEAD'], path) };
}

function remove(n: number, base: string, found: Omit<Found, 'root'>, deps: Deps): Output {
  const merged: string[] = [];
  for (const branch of ticketBranches(found.branches, n)) {
    const ancestor = deps.git(['merge-base', '--is-ancestor', branch, base]);
    if (ancestor.code > 1) throw new Error(`git merge-base --is-ancestor ${branch} ${base} failed: ${ancestor.stderr.trim()}`);
    if (ancestor.code === 0) merged.push(branch);
  }
  const plan = removal({ n, base, branches: found.branches, copies: found.linked, merged });
  if ('why' in plan) throw new Error(`nothing was removed: ${plan.why}`);

  // No --force: a copy with changes that were never committed is the Builder's work, and git refuses to remove it.
  if (plan.copy !== null) {
    const r = deps.git(['worktree', 'remove', plan.copy]);
    if (r.code !== 0) throw new Error(`nothing was removed: the copy ${plan.copy} and ${plan.branch} are kept: ${endOf(r)}`);
  }
  // -D, since `-d` asks whether the branch is in the folder's own branch, which need not be the working one: it was
  // checked above against the working branch.
  const r = deps.git(['branch', '-D', plan.branch]);
  if (r.code !== 0) throw new Error(`${plan.copy === null ? '' : 'the copy was removed, but '}${plan.branch} was not deleted: ${endOf(r)}`);
  return { ok: true, ticket: n, branch: plan.branch, base, removedCopy: plan.copy !== null, ...(plan.copy === null ? {} : { path: plan.copy }) };
}

// The copies git lists, the main folder first.
function copies(deps: Deps): Copy[] {
  const list = parseWorktrees(read(deps, ['worktree', 'list', '--porcelain']));
  if (list.length === 0) throw new Error('git worktree list gave no folder');
  return list;
}

// A git read that must work: its output, trimmed.
function read(deps: Deps, args: string[], cwd?: string): string {
  const r = deps.git(args, cwd === undefined ? {} : { cwd });
  if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
}
