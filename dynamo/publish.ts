// `dynamo publish <tag> <clone>` prepares the public release: one commit that holds only the allowlisted files of the tag, in
// the public clone, on `publish/x.y.z` with the tip of the public `main` as its only parent (in an empty clone: on `main`,
// with no parent). Author and committer are the noreply identity, and `plugin.json` carries the version of the tag. It
// prints the push and `gh pr create` commands for the human and pushes nothing. The clone is always an argument: no path of
// the machine is stored anywhere. Everything that can fail is checked before the clone is touched, the review of the snapshot
// included (snapshot.ts: a secret, an email, a user path or a mention of the private repository refuses it), and the identity
// of the commit is read back once it is made: another one is refused and the clone put back. With `--merged`, after the merge, it
// checks the commit the merge left on the public `main` instead (publish-merged.ts).
import { resolve } from 'node:path';
import type { Deps, Output } from './cli.ts';
import { read, setting, usage } from './cli.ts';
import { endOf } from './checks.ts';
import { assertClone } from './publish-clone.ts';
import { publishMerged } from './publish-merged.ts';
import { reviewSnapshot, writeSnapshot } from './snapshot.ts';
import { IDENTITY_FORMAT, PUBLIC_FILES, commandsFor, identitiesOf, identityEnv, missingPublicFiles, preparedProblems, publishBranch, publishedFiles, versionOf } from './publishing.ts';

export async function publish(args: string[], deps: Deps): Promise<Output> {
  const [tag, folder, ...rest] = args;
  const merged = rest.length === 1 && rest[0] === '--merged';
  if (tag === undefined || folder === undefined || (rest.length > 0 && !merged)) usage('usage: publish <tag> <clone> [--merged]');
  const version = versionOf(tag);
  if (version === null) usage(`${tag} is not a release tag (vX.Y.Z)`);
  if (merged) return publishMerged(tag, version, folder, deps);
  const main = setting(deps.factory().project, 'project', 'mainBranch');
  const clone = resolve(folder);

  // The tag, read from the development repository this runs in.
  const top = read(deps, ['rev-parse', '--show-toplevel']);
  const found = deps.git(['rev-parse', '--verify', '-q', `refs/tags/${tag}^{commit}`], { cwd: top });
  if (found.code !== 0) throw new Error(`there is no tag ${tag}: nothing was committed`);
  const listing = deps.git(['ls-tree', '-r', '-z', '--full-tree', '--name-only', tag], { cwd: top });
  if (listing.code !== 0) throw new Error(`git ls-tree ${tag} failed: ${endOf(listing)}`);
  const files = publishedFiles(listing.stdout);
  if (!files.includes('.claude-plugin/plugin.json')) throw new Error(`${tag} has no .claude-plugin/plugin.json to publish`);
  const lacking = missingPublicFiles(listing.stdout);
  if (lacking.length > 0) throw new Error(`${tag} has no ${lacking.join(', ')}: the public CI and Dependabot come from there; nothing was committed`);
  // The public CI and Dependabot are read now, before the clone is touched.
  const placed = Object.entries(PUBLIC_FILES).map(([source, place]) => {
    const blob = deps.git(['cat-file', 'blob', `${tag}:${source}`], { cwd: top });
    if (blob.code !== 0) throw new Error(`git cat-file ${tag}:${source} failed: ${endOf(blob)}`);
    return { place, text: blob.stdout };
  });

  // The clone: a repository other than this one, with nothing of anyone's in its folder.
  assertClone(deps, top, clone);
  if (read(deps, ['status', '--porcelain'], clone) !== '') throw new Error(`${clone} has changes; commit or remove them first`);

  // The review: the snapshot is written to a temporary folder and checked before anything is fetched, checked out or committed.
  const snap = { top, tag, version, files, placed };
  await reviewSnapshot(deps, snap, setting(deps.factory().project, 'project', 'repo'));

  if (read(deps, ['remote'], clone).split('\n').includes('origin')) {
    const fetched = deps.git(['fetch', '-q', 'origin'], { cwd: clone });
    if (fetched.code !== 0) throw new Error(`git fetch origin in the clone failed: ${endOf(fetched)}`);
  }
  const exists = (ref: string) => deps.git(['rev-parse', '--verify', '-q', ref], { cwd: clone }).code === 0;
  const parent = exists(`refs/remotes/origin/${main}`) ? `refs/remotes/origin/${main}` : exists(`refs/heads/${main}`) ? `refs/heads/${main}` : null;
  const first = read(deps, ['for-each-ref', '--count=1', 'refs/heads', 'refs/remotes'], clone) === '';
  if (parent === null && !first) throw new Error(`the clone has history but no ${main}: its first commit would not be the tip of ${main}`);
  const branch = publishBranch(version);
  if (parent !== null && exists(`refs/heads/${branch}`)) throw new Error(`${branch} already exists in the clone; delete it to prepare the release again`);

  // From here the clone is touched; a failure puts it back.
  const tip = parent === null ? null : read(deps, ['rev-parse', '--short', parent], clone);
  const named = deps.git(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd: clone }).stdout.trim();
  const before = parent === null ? null : named !== '' ? named : read(deps, ['rev-parse', 'HEAD'], clone);
  try {
    if (parent === null) read(deps, ['symbolic-ref', 'HEAD', `refs/heads/${main}`], clone);
    else {
      read(deps, ['checkout', '-q', '--no-track', '-b', branch, parent], clone);
      read(deps, ['rm', '-r', '-q', '--ignore-unmatch', '--', '.'], clone);
    }
    writeSnapshot(deps, snap, clone);
    read(deps, ['-c', 'core.autocrlf=false', 'add', '-A'], clone);
    // The identity comes from the environment, which beats any config; no signature, since a key carries an email.
    const commit = deps.git(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', `Dynamo ${version}`], { cwd: clone, env: { ...process.env, ...identityEnv() } });
    if (commit.code !== 0) throw new Error(`git commit failed: ${endOf(commit)}`);
    // Read back, not assumed: a hook or a wrapper may have changed who made the commit. Another identity is never offered.
    const problems = preparedProblems(identitiesOf(read(deps, ['log', '-1', `--format=${IDENTITY_FORMAT}`, 'HEAD'], clone)));
    if (problems.length > 0) throw new Error(`the prepared commit has another identity (${problems.join('; ')}): nothing is offered to push`);
  } catch (e) {
    if (before !== null) restore(deps, clone, before, branch);
    else emptyAgain(deps, clone, main);
    throw e;
  }
  const { push, pr } = commandsFor(clone, branch, main, parent === null, version);
  return { ok: true, tag, version, branch: parent === null ? main : branch, commit: read(deps, ['rev-parse', '--short', 'HEAD'], clone), parent: tip, first: parent === null, files: files.length + placed.length, clone, push, pr };
}

// Back to where the clone was: its changes dropped, the branch (or commit) it was on, and the publish branch deleted.
function restore(deps: Deps, clone: string, before: string, branch: string): void {
  deps.git(['reset', '-q', '--hard'], { cwd: clone });
  deps.git(['clean', '-fdq'], { cwd: clone });
  deps.git(['checkout', '-q', before], { cwd: clone });
  deps.git(['branch', '-D', branch], { cwd: clone });
}

// An empty clone again: the first commit gone from `main`, and the index and folder empty as they were.
function emptyAgain(deps: Deps, clone: string, main: string): void {
  deps.git(['update-ref', '-d', `refs/heads/${main}`], { cwd: clone });
  deps.git(['read-tree', '--empty'], { cwd: clone });
  deps.git(['clean', '-fdq'], { cwd: clone });
}
