// `dynamo merge <n>`: merges the ticket's branch `ticket/<n>-*` into the working branch, in the main folder, the way
// `/implement` does: `--no-ff`, then every command of `project.checks` with `<base>` = HEAD~1 (the base before the merge),
// a revert when one fails, and the done label added and read back. A branch already merged is not merged again: only the
// label is done. One merge at a time: the lock (merging.ts) is taken first and freed whatever happens.
import type { Deps, Output } from './cli.ts';
import { usage } from './cli.ts';
import type { Check } from './checks.ts';
import { endOf, parseChecks, withBase, words } from './checks.ts';
import type { Settings } from './merging.ts';
import { LOCK, hasLabel, refusal, settings, subject, ticketBranches } from './merging.ts';

export function merge(args: string[], deps: Deps): Output {
  if (args.length !== 1 || !/^[1-9]\d*$/.test(args[0])) usage('usage: merge <n>');
  const n = Number(args[0]);
  const { project } = deps.factory();
  const s = settings(project);
  const commands = parseChecks(project.checks);

  const lock = deps.git(['update-ref', LOCK, 'HEAD', '']);
  if (lock.code !== 0) {
    // Only a lock that exists is another merge's; any other failure (not a repository, no HEAD) is git's own.
    if (deps.git(['show-ref', '--verify', '--quiet', LOCK]).code !== 0) throw new Error(`the lock ${LOCK} could not be taken: ${lock.stderr.trim()}`);
    throw new Error(`another merge holds the lock (${LOCK}): nothing was merged. If none is running, free it with `
      + `git update-ref -d ${LOCK}`);
  }
  try {
    return mergeLocked(n, s, commands, deps);
  } finally {
    deps.git(['update-ref', '-d', LOCK]);
  }
}

function mergeLocked(n: number, s: Settings, commands: string[], deps: Deps): Output {
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
  let checks: Check[] = [];
  if (!already) {
    const m = deps.git(['merge', '--no-ff', branch, '-m', subject(branch, s.base, n)]);
    if (m.code !== 0) {
      const abort = deps.git(['merge', '--abort']);
      throw new Error(`merge of ${branch} into ${s.base} failed (${abort.code === 0 ? 'aborted' : 'NOT aborted: the main folder may be in the middle of a merge'}): `
        + endOf(m));
    }
    checks = commands.map((command) => {
      const [program, ...rest] = words(withBase(command, 'HEAD~1'));
      const r = deps.exec([program], rest, { cwd: top });
      return { command, code: r.code, output: endOf(r) };
    });
    const failed = checks.find((c) => c.code !== 0);
    if (failed) {
      const revert = deps.git(['revert', '-m', '1', '--no-edit', 'HEAD']);
      return { ok: false, branch, base: s.base, failed, reverted: revert.code === 0, ...(revert.code === 0 ? {} : { revert: endOf(revert) }) };
    }
  }

  const issue = String(n);
  const edit = deps.gh(['issue', 'edit', issue, '-R', s.repo, '--add-label', s.doneLabel]);
  if (edit.code !== 0) throw new Error(`${branch} is in ${s.base}, but the label ${s.doneLabel} was not added: ${endOf(edit)}`);
  const view = deps.gh(['issue', 'view', issue, '-R', s.repo, '--json', 'labels']);
  if (view.code !== 0 || !hasLabel(view.stdout, s.doneLabel)) {
    throw new Error(`${branch} is in ${s.base}, but the label ${s.doneLabel} did not read back on #${n}: ${endOf(view)}`);
  }
  return { ok: true, branch, base: s.base, merged: !already, head: read(deps, ['rev-parse', '--short', 'HEAD']), checks, label: s.doneLabel };
}

// A git read that must work: its output, trimmed.
function read(deps: Deps, args: string[]): string {
  const r = deps.git(args);
  if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
}
