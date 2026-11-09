// `dynamo publish <tag> <clone> --merged`: the step after the human merged the pull request. It reads the commit the merge
// left on the public `main` of the clone, refuses it unless its author and committer carry the noreply identity (or GitHub's
// own, for the committer of a squash merge), and only then prints the command that makes the tag and the GitHub Release.
// It reads and prints; it changes nothing in the clone, which only has its `origin` fetched.
import { resolve } from 'node:path';
import type { Deps, Output } from './cli.ts';
import { read, setting } from './cli.ts';
import { endOf } from './checks.ts';
import { assertClone } from './publish-clone.ts';
import { IDENTITY_FORMAT, identitiesOf, mergedProblems, releaseCommand, versionIn } from './publishing.ts';

export function publishMerged(tag: string, version: string, folder: string, deps: Deps): Output {
  const main = setting(deps.factory().project, 'project', 'mainBranch');
  const clone = resolve(folder);
  const top = read(deps, ['rev-parse', '--show-toplevel']);
  assertClone(deps, top, clone);

  if (read(deps, ['remote'], clone).split('\n').includes('origin')) {
    const fetched = deps.git(['fetch', '-q', 'origin'], { cwd: clone });
    if (fetched.code !== 0) throw new Error(`git fetch origin in the clone failed: ${endOf(fetched)}`);
  }
  const exists = (ref: string) => deps.git(['rev-parse', '--verify', '-q', ref], { cwd: clone }).code === 0;
  const ref = exists(`refs/remotes/origin/${main}`) ? `refs/remotes/origin/${main}` : exists(`refs/heads/${main}`) ? `refs/heads/${main}` : null;
  if (ref === null) throw new Error(`the clone has no ${main}: there is no merged commit to check`);
  const sha = read(deps, ['rev-parse', ref], clone);

  // The commit must be this release: a tag on the previous one, before the merge, would fix the wrong commit.
  const plugin = deps.git(['show', `${sha}:.claude-plugin/plugin.json`], { cwd: clone });
  const there = plugin.code === 0 ? versionIn(plugin.stdout) : null;
  if (there !== version) throw new Error(`${main} of the clone is at version ${there ?? 'unknown'}, not ${version}: merge the pull request and try again`);

  const problems = mergedProblems(identitiesOf(read(deps, ['log', '-1', `--format=${IDENTITY_FORMAT}`, sha], clone)));
  if (problems.length > 0) {
    throw new Error(`the commit ${sha.slice(0, 7)} on ${main} has another identity (${problems.join('; ')}): no tag, no Release`);
  }
  return { ok: true, tag, version, commit: read(deps, ['rev-parse', '--short', sha], clone), clone, release: releaseCommand(clone, tag, version, sha) };
}
