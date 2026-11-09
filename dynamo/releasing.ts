// What `report`, `release check` and `release close` read the same way, so that they cannot disagree: a branch name that is safe to put in a
// command, a git answer or an error, and the epics a release closes (the rule is `epicIsComplete`).
import type { Deps } from './cli.ts';
import { setting, usage } from './cli.ts';
import { endOf } from './checks.ts';
import type { Options } from './exec.ts';
import { epicIsComplete, epicOf } from './releases.ts';
import { releaseBranch } from './working.ts';

// A branch name goes into commands the human copies and into git's arguments: nothing that a shell could read as something
// else, and no option.
export const SAFE = /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/;

export function gitText(git: Deps['git'], args: string[], what: string, options?: Options): string {
  const r = git(args, options);
  if (r.code !== 0) throw new Error(`${what} failed (git ${args[0]} exited ${r.code}): ${endOf(r)}`);
  return r.stdout.trim();
}

export type Target = { repo: string; main: string; base: string };

// The repository, the main branch and the release branch an action works on (`base` given, else the working branch read from git). What is
// not safe to put in a command, or is the main branch itself, is refused.
export function targetOf(deps: Deps, base: string | undefined): Target {
  const project = deps.factory().project;
  const repo = setting(project, 'project', 'repo');
  const main = setting(project, 'project', 'mainBranch');
  const branch = base ?? releaseBranch(deps);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`factory.json: project.repo «${repo}» is not owner/name`);
  if (!SAFE.test(branch)) usage(`${branch} is not a branch name that is safe to use`);
  if (branch === main) throw new Error(`the base is the main branch (${main}): there is no release to work on`);
  return { repo, main, base: branch };
}

// Of the parents of the merged tickets, the epics that are open with every sub-issue in the release (merged in it or closed
// before). One that cannot be read is left out, and `notes` says so. With `afterMerge` the release PR is already merged, and
// GitHub closed the epics its `Closes` lines name: a complete epic counts whether it is open or closed.
export function closedEpics(gh: Deps['gh'], repo: string, parents: Iterable<number>, merged: number[], notes: string[], afterMerge = false): number[] {
  return [...new Set(parents)].sort((a, b) => a - b).filter((n) => {
    const r = gh(['issue', 'view', String(n), '-R', repo, '--json', 'state,subIssues']);
    try {
      if (r.code !== 0) throw new Error(endOf(r));
      const e = epicOf(r.stdout);
      return (afterMerge || e.open) && epicIsComplete(e.subs, merged);
    } catch (e) {
      notes.push(`epic #${n} could not be read, so it is not closed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  });
}
