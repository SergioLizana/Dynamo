// `dynamo merge <n> [--verified <sha>]`: merges the ticket's branch `ticket/<n>-*` with `--no-ff` in a copy of the working branch, runs every
// command of `project.checks` there with `<base>` = HEAD~1 (the base before the merge), and only if they all pass moves
// the working branch to the merge by fast-forward, then adds the done label and reads it back. A failed check or a conflict
// leaves the working branch untouched (no revert). A branch already merged is not merged again: only the label is done, and only if it is missing.
// With `--verified <sha>`, the commit Verify passed for the ticket: if the merged tree is that commit's tree, the checks it
// ran are not run again and the line says so (`skipped`); with no sha, or another tree, every check runs.
// A command of the check past `project.checkTimeoutMinutes` is closed with its tree and is a failed check.
// One merge at a time: the lock (merging.ts) is taken first and freed whatever happens. The checks run asynchronously, so
// the merges of one `dynamo run` wait for each other (serial.ts) before they reach the lock.
import { join } from 'node:path';
import type { Deps, Output } from './cli.ts';
import { read, usage } from './cli.ts';
import type { Check } from './checks.ts';
import { checkTimeoutOf, endOf, parseChecks, runChecks } from './checks.ts';
import type { Settings } from './merging.ts';
import { LOCK, hasLabel, refusal, settings, subject, ticketBranches } from './merging.ts';
import { releaseBranch } from './working.ts';
import { serially } from './serial.ts';

export function merge(args: string[], deps: Deps): Promise<Output> {
  return serially(() => mergeOne(args, deps));
}

async function mergeOne(args: string[], deps: Deps): Promise<Output> {
  const form = 'usage: merge <n> [--verified <sha>]';
  if (args.length !== 1 && args.length !== 3) usage(form);
  if (!/^[1-9]\d*$/.test(args[0])) usage(form);
  if (args.length === 3 && (args[1] !== '--verified' || !/^[0-9a-f]{7,40}$/.test(args[2]))) usage(form);
  const n = Number(args[0]);
  const verified = args.length === 3 ? args[2] : null;
  const factory = deps.factory();
  const s = settings(factory.project, releaseBranch(deps));
  const commands = parseChecks(factory.project.checks);
  const limit = checkTimeoutOf(factory.project);

  const lock = deps.git(['update-ref', LOCK, 'HEAD', '']);
  if (lock.code !== 0) {
    // Only a lock that exists is another merge's; any other failure (not a repository, no HEAD) is git's own.
    if (deps.git(['show-ref', '--verify', '--quiet', LOCK]).code !== 0) throw new Error(`the lock ${LOCK} could not be taken: ${lock.stderr.trim()}`);
    throw new Error(`another merge holds the lock (${LOCK}): nothing was merged. If none is running, free it with `
      + `git update-ref -d ${LOCK}`);
  }
  try {
    return await mergeLocked(n, verified, s, commands, limit, deps);
  } finally {
    deps.git(['update-ref', '-d', LOCK]);
  }
}

async function mergeLocked(n: number, verified: string | null, s: Settings, commands: string[], limit: number, deps: Deps): Promise<Output> {
  const top = read(deps, ['rev-parse', '--show-toplevel']);
  const folder = {
    clean: read(deps, ['status', '--porcelain']) === '',
    current: read(deps, ['branch', '--show-current']),
    branches: ticketBranches(read(deps, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/ticket/']).split('\n'), n),
  };
  const why = refusal(s, folder, n);
  if (why !== null) throw new Error(`nothing was merged: ${why}`);
  const [branch] = folder.branches;

  const ancestor = deps.git(['merge-base', '--is-ancestor', branch, 'HEAD']);
  if (ancestor.code > 1) throw new Error(`git merge-base --is-ancestor ${branch} HEAD failed: ${ancestor.stderr.trim()}`);
  const already = ancestor.code === 0;
  let checks: Check[] = [], skipped: string | null = null;
  if (!already) {
    const done = await inCopy(n, branch, verified, s, commands, limit, top, deps);
    if (!done.ok) return done.out;
    checks = done.checks;
    skipped = done.skipped;
  }

  const issue = String(n);
  const labels = () => deps.gh(['issue', 'view', issue, '-R', s.repo, '--json', 'labels']);
  // A branch already in the base needs only the label, and not even that when it is there.
  let view = already ? labels() : null;
  if (view === null || view.code !== 0 || !hasLabel(view.stdout, s.doneLabel)) {
    const edit = deps.gh(['issue', 'edit', issue, '-R', s.repo, '--add-label', s.doneLabel]);
    if (edit.code !== 0) throw new Error(`${branch} is in ${s.base}, but the label ${s.doneLabel} was not added: ${endOf(edit)}`);
    view = labels();
  }
  if (view.code !== 0 || !hasLabel(view.stdout, s.doneLabel)) {
    throw new Error(`${branch} is in ${s.base}, but the label ${s.doneLabel} did not read back on #${n}: ${endOf(view)}`);
  }
  const done = { ok: true as const, branch, base: s.base, merged: !already, head: read(deps, ['rev-parse', '--short', 'HEAD']), checks };
  const line = skipped === null ? done : { ...done, skipped };
  return { ...line, label: s.doneLabel };
}

// The merge and its check in a copy of the working branch's tip (a detached worktree, gone whatever happens). Only when every
// check passes does the working branch move, and only by fast-forward to the merge: a failed check or a conflict leaves it
// where it was, so nothing is ever reverted and the same merge can be run again.
async function inCopy(n: number, branch: string, verified: string | null, s: Settings, commands: string[], limit: number, top: string, deps: Deps):
  Promise<{ ok: true; checks: Check[]; skipped: string | null } | { ok: false; out: Output }> {
  const path = join(top, '.claude', 'worktrees', `merge-${n}`);
  // A copy left by a merge that died is stale: the lock is ours, so no other merge is using it.
  deps.git(['worktree', 'remove', '--force', path]);
  deps.git(['worktree', 'prune']);
  const made = deps.git(['worktree', 'add', '--detach', path, 'HEAD']);
  if (made.code !== 0) throw new Error(`no copy for the merge was made: git worktree add ${path} failed: ${endOf(made)}`);
  try {
    const m = deps.git(['merge', '--no-ff', branch, '-m', subject(branch, s.base, n)], { cwd: path });
    if (m.code !== 0) {
      const files = deps.git(['diff', '--name-only', '--diff-filter=U'], { cwd: path }).stdout.split('\n').map((f) => f.trim()).filter((f) => f !== '');
      return { ok: false, out: { ok: false, branch, base: s.base, conflict: true, files, output: endOf(m) } };
    }
    // Verify passed the tree of `verified`: the same tree in the merge proves nothing new, so the checks are not run again.
    const passed = verified === null ? null : deps.git(['rev-parse', '--verify', '--quiet', `${verified}^{tree}`]);
    const same = passed !== null && passed.code === 0 && passed.stdout.trim() === read(deps, ['rev-parse', 'HEAD^{tree}'], path);
    const skipped = same ? `the merged tree is the tree of ${String(verified).slice(0, 7)}, which Verify passed: the checks were not run again` : null;
    const checks = skipped === null ? await runChecks(commands, 'HEAD~1', path, deps.exec, limit) : [];
    const failed = checks.find((c) => c.code !== 0);
    if (failed) return { ok: false, out: { ok: false, branch, base: s.base, failed, checks } };

    const sha = read(deps, ['rev-parse', 'HEAD'], path);
    const ff = deps.git(['merge', '--ff-only', sha]);
    if (ff.code !== 0) {
      throw new Error(`cannot fast-forward ${s.base} to the merge ${sha.slice(0, 7)} of ${branch}: it moved or changed while the check ran, `
        + `so nothing was merged and nothing was reverted: ${endOf(ff)}`);
    }
    return { ok: true, checks, skipped };
  } finally {
    deps.git(['worktree', 'remove', '--force', path]);
  }
}
