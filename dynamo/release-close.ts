// `dynamo release close [--dry-run]`: once the release PR of the working branch is merged, the milestone `v<x.y.z>` with the
// tickets merged in the release, the tag `v<x.y.z>` on the PR's merge commit and a GitHub Release whose text is the body of
// that PR; no branch is made (`release new` opens the next one when the human decides). factory.json is not changed. It runs
// `release check` first (on the merged PR) and writes nothing if there is a difference or if the release PR is not merged.
// `--dry-run` says what it would do and writes nothing. The milestone is made first, then the tag, then the Release, and each
// is taken back if a later step fails, so a failure leaves nothing behind. Last, the milestone is closed.
import type { Deps, Output } from './cli.ts';
import { usage } from './cli.ts';
import { endOf } from './checks.ts';
import { closeMilestone, deleteMilestone, makeMilestone } from './milestones.ts';
import { checkRelease } from './release-check.ts';
import { targetOf } from './releasing.ts';
import { versionOf } from './versions.ts';

const USAGE = 'usage: release close [--dry-run]';

function parse(args: string[]): { dryRun: boolean } {
  let dryRun = false;
  for (const a of args) {
    if (a === '--dry-run' && !dryRun) dryRun = true;
    else usage(USAGE);
  }
  return { dryRun };
}

export function releaseClose(args: string[], deps: Deps): Output {
  const { dryRun } = parse(args);
  const target = targetOf(deps, undefined);
  const { repo, base } = target;

  const { out: check, pr, tickets } = checkRelease(deps, target, 'merged');
  if (!check.ok) return { ...check, dryRun, message: `${String(check.message)}; nothing was written` };
  const merge = pr.merge as string;

  const version = versionOf(base);
  const tag = `v${version}`;
  const sha = merge.slice(0, 7);
  const done = { base, version, tag, milestone: tag, tickets: tickets.length, epics: check.epics, pr: pr.number, commit: sha, dryRun };
  const plan = `the milestone ${tag} with ${tickets.length} ticket${tickets.length === 1 ? '' : 's'}, tag ${tag} on ${sha} and the GitHub Release ${tag} with the text of PR #${pr.number}`;
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
  // Last: the release is complete, so the milestone is closed.
  const notClosed = closeMilestone(deps.gh, repo, milestone.number);
  if (notClosed !== null) throw new Error(`the milestone ${tag} could not be closed: ${notClosed}`);
  return { ok: true, ...done, message: `made ${plan} and closed the milestone ${tag}` };
}
