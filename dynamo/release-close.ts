// `dynamo release close --bump <patch|minor|major> [--dry-run]`: once the release PR of the working branch is merged, the
// milestone `v<x.y.z>` with the tickets merged in the release, the tag `v<x.y.z>` on the PR's merge commit, a GitHub Release
// whose text is the body of that PR, and the next branch `release/<next>` (the version after the tag for the bump) on the
// merge commit; factory.json is not changed (the working branch is read from git, and the next branch, being greater than the
// working one, cannot exist yet). It runs `release check` first (on the merged PR) and writes nothing if there is a difference
// or if the release PR is not merged. `--dry-run` says what it would do and writes nothing. The milestone is made first, then
// the tag, then the Release, and each is taken back if a later step fails, so a failure leaves nothing behind. Last, once the
// next branch is open, the milestone is closed.
import type { Deps, Output } from './cli.ts';
import { usage } from './cli.ts';
import { endOf } from './checks.ts';
import { closeMilestone, deleteMilestone, makeMilestone } from './milestones.ts';
import { checkRelease } from './release-check.ts';
import { openBranch } from './release-next.ts';
import { targetOf } from './releasing.ts';
import { BUMPS, nextVersion, versionOf } from './versions.ts';
import type { Bump } from './versions.ts';

const USAGE = `usage: release close --bump <${BUMPS.join('|')}> [--dry-run]`;

function parse(args: string[]): { bump: Bump; dryRun: boolean } {
  let bump: string | undefined;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run' && !dryRun) dryRun = true;
    else if (args[i] === '--bump' && bump === undefined && i + 1 < args.length) bump = args[++i];
    else usage(USAGE);
  }
  if (bump === undefined || !(BUMPS as readonly string[]).includes(bump)) usage(USAGE);
  return { bump: bump as Bump, dryRun };
}

export function releaseClose(args: string[], deps: Deps): Output {
  const { bump, dryRun } = parse(args);
  const target = targetOf(deps, undefined);
  const { repo, base } = target;

  const { out: check, pr, tickets } = checkRelease(deps, target, 'merged');
  if (!check.ok) return { ...check, dryRun, message: `${String(check.message)}; nothing was written` };
  const merge = pr.merge as string;

  const version = versionOf(base);
  const tag = `v${version}`;
  const next = nextVersion(version, bump);
  const nextBranch = `release/${next}`;
  const sha = merge.slice(0, 7);
  const done = { base, version, tag, milestone: tag, tickets: tickets.length, epics: check.epics, bump, next, nextBranch, pr: pr.number, commit: sha, dryRun };
  const plan = `the milestone ${tag} with ${tickets.length} ticket${tickets.length === 1 ? '' : 's'}, tag ${tag} on ${sha}, the GitHub Release ${tag} with the text of PR #${pr.number} and the branch ${nextBranch} on ${sha}`;
  if (dryRun) return { ok: true, ...done, message: `would make ${plan} and close the milestone ${tag}; nothing was written` };

  const milestone = makeMilestone(deps.gh, repo, tag, tickets);
  // What was made so far is taken back, and the error says what could and what could not be.
  const fail = (what: string, back: string[]): never => {
    throw new Error(`${what}; ${[...back, deleteMilestone(deps.gh, repo, milestone.number)].join('; ')}`);
  };

  const tagged = deps.git(['tag', tag, merge]);
  if (tagged.code !== 0) fail(`making the tag ${tag} failed (git tag exited ${tagged.code}): ${endOf(tagged)}`, []);
  const created = deps.gh(['release', 'create', tag, '-R', repo, '--title', tag, '--target', merge, '--notes-file', '-'], { input: pr.body });
  if (created.code !== 0) {
    const back = deps.git(['tag', '-d', tag]);
    fail(`the GitHub Release ${tag} failed: ${endOf(created)}`, [back.code === 0 ? 'the tag was taken back' : `the tag ${tag} could not be taken back: ${endOf(back)}`]);
  }
  try {
    openBranch(deps.git, nextBranch, merge);
  } catch (e) {
    throw new Error(`the milestone ${tag}, the tag ${tag} and the GitHub Release ${tag} were made, but ${e instanceof Error ? e.message : String(e)}`);
  }
  // Last: the release is complete, so the milestone is closed.
  const notClosed = closeMilestone(deps.gh, repo, milestone.number);
  if (notClosed !== null) throw new Error(`the milestone ${tag} could not be closed: ${notClosed}`);
  return { ok: true, ...done, message: `made ${plan} and closed the milestone ${tag}` };
}
