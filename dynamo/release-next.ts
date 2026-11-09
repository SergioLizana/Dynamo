// The branch `release/<next>` that follows a closed release: it points at the merge commit and nothing more. The working
// branch is read from git, so factory.json has no part in it. Made with `update-ref`, so the folder the human works in
// (its files, its index, its branch) is not touched.
import type { Deps } from './cli.ts';
import { gitText } from './releasing.ts';

// Points the new branch at the merge commit; git refuses if the branch appeared in the meantime.
export function openBranch(git: Deps['git'], branch: string, commit: string): void {
  gitText(git, ['update-ref', `refs/heads/${branch}`, commit, '0'.repeat(commit.length)], `making the branch ${branch}`);
}
