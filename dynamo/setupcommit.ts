// What `dynamo setup` does with git once its files are written: copies start from the working branch and `dynamo merge` needs a
// clean main folder, so what the setup wrote is committed on `release/x.y.z` (made if there is none) and nothing is pushed:
// the push is printed for the human. Only the paths the setup wrote are added; any other file of the folder is left as it was.
import type { Deps } from './cli.ts';
import { read } from './cli.ts';
import { findRelease, firstRelease } from './versions.ts';

export const MESSAGE = 'Set up the factory with dynamo setup';

export type Committed = { release: string; releaseCreated: boolean; commit: string | null; push: string; clean: boolean };

// The command the human runs to publish the branch, as the setup prints it.
export const pushOf = (release: string): string => `git push -u origin ${release}`;

// Commits `paths` (relative to the project, all written by this run) on the working branch. With nothing different from HEAD in
// them there is no commit (a second run makes none); the branch is made at HEAD if it does not exist, and the folder is moved
// to it, commit or not, carrying the changes along. A failure of git throws, saying what failed; the files stay written.
export function commitSetup(deps: Deps, root: string, paths: string[]): Committed {
  const at = (args: string[]) => read(deps, args, root);
  const found = findRelease(at(['for-each-ref', '--format=%(refname:short)', 'refs/heads/release', 'refs/remotes/origin/release']), at(['tag', '--list', 'v*']));
  const release = found ?? firstRelease(at(['tag', '--list', 'v*']));
  if (paths.length > 0) at(['add', '--', ...paths]);
  const staged = paths.length === 0 ? '' : at(['diff', '--cached', '--name-only', '--', ...paths]);
  // The folder ends on the working branch with or without a commit, so `dynamo merge` finds it there.
  if (found === null) at(['branch', release]);
  if (at(['branch', '--show-current']) !== release) at(['switch', release]);
  if (staged !== '') at(['commit', '-q', '-m', MESSAGE, '--', ...paths]);
  return {
    release, releaseCreated: found === null, commit: staged === '' ? null : at(['rev-parse', '--short', 'HEAD']),
    push: pushOf(release), clean: at(['status', '--porcelain']) === '',
  };
}
