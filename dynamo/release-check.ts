// `dynamo release check [base]`: the `Closes` lines of the open release PR of the working branch (or of the base given)
// against what was merged: every ticket merged into it since the main branch (a ticket brought back by a revert of a revert
// among them) and every epic the release completes, by the same rule as the release report. Read-only. It is ok with no
// difference and fails with it, naming what is missing and what is extra. What it cannot read it does not guess: it throws.
// `checkRelease` is the same check for a PR already merged, which `release close` runs before it writes anything.
import type { Deps, Output } from './cli.ts';
import { usage } from './cli.ts';
import { endOf } from './checks.ts';
import { closesOf, differenceOf, differenceText, parentOf } from './closes.ts';
import { mergedPrOf, mergedTickets, prOf } from './releases.ts';
import type { Pr } from './releases.ts';
import { closedEpics, gitText, targetOf } from './releasing.ts';
import type { Target } from './releasing.ts';

export type Checked = { out: Output; pr: Pr & { merge: string | null }; tickets: number[] };

// `state` is the PR to read: the open one (the release is still to be merged) or the merged one. The tickets of a merged
// release are the merges of the base since the first parent of the PR's merge commit, which is the main branch as it was
// before: since then the main branch holds the release itself.
export function checkRelease(deps: Deps, { repo, main, base }: Target, state: 'open' | 'merged'): Checked {
  const prs = deps.gh(['pr', 'list', '-R', repo, '--head', base, '--base', main, '--state', state, '--json', state === 'open' ? 'number,body' : 'number,body,mergeCommit']);
  if (prs.code !== 0) throw new Error(`reading the pull requests of ${base} failed: ${endOf(prs)}`);
  const pr = state === 'open' ? prOf(prs.stdout) : mergedPrOf(prs.stdout);
  if (pr === null) throw new Error(state === 'open' ? `there is no open pull request from ${base} into ${main} to check` : `the release PR of ${base} is not merged: there is no merged pull request from ${base} into ${main}`);
  const merge = 'merge' in pr ? pr.merge : null;
  // The merge commit was made on GitHub: this clone may not have it yet. Stop and say what to do, not git's «unknown revision».
  if (merge !== null && deps.git(['cat-file', '-e', `${merge}^{commit}`]).code !== 0) {
    throw new Error(`the merge commit ${merge} of PR #${pr.number} is not in the local repository: run \`git fetch origin\` and try again; nothing was written`);
  }

  const since = merge === null ? main : `${merge}^1`;
  const merged = mergedTickets(gitText(deps.git, ['log', '--first-parent', '--format=%p%x09%s', `${since}..${base}`], `reading the merges of ${base} since ${main}`));

  const unread: string[] = [];
  const parents = merged.flatMap((n) => {
    const r = deps.gh(['issue', 'view', String(n), '-R', repo, '--json', 'parent']);
    try {
      if (r.code !== 0) throw new Error(endOf(r));
      const p = parentOf(r.stdout);
      return p === null ? [] : [p];
    } catch (e) {
      unread.push(`#${n}: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  });
  const epics = closedEpics(deps.gh, repo, parents, merged, unread, state === 'merged');
  if (unread.length > 0) throw new Error(`cannot tell what the release closes: ${unread.join('; ')}`);

  const difference = differenceOf([...merged, ...epics], closesOf(pr.body));
  const text = differenceText(difference);
  return {
    pr: { number: pr.number, body: pr.body, merge },
    tickets: merged,
    out: {
      ok: text === null, base, pr: pr.number, merged: merged.length, epics, ...difference,
      message: text ?? `the Closes lines of PR #${pr.number} match what was merged into ${base}`,
    },
  };
}

export function releaseCheck(args: string[], deps: Deps): Output {
  if (args.length > 1) usage('usage: release check [base]');
  return checkRelease(deps, targetOf(deps, args[0]), 'open').out;
}
