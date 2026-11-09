// The working branch, read from git: the greatest `release/x.y.z` branch, local or on origin (as last fetched), above the
// last tag `v<x.y.z>`. It is state that changes with every release, so it is not kept in factory.json. The decision is
// `releaseBranchOf` (versions.ts); this reads git and calls it.
import type { Deps } from './cli.ts';
import { read } from './cli.ts';
import { releaseBranchOf } from './versions.ts';

export function releaseBranch(deps: Deps): string {
  const branches = read(deps, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/release', 'refs/remotes/origin/release']);
  return releaseBranchOf(branches, read(deps, ['tag', '--list', 'v*']));
}
