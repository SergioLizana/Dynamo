// What a ticket's copy is left with when the ticket ends: whatever git does not track (temporary folders a Builder cannot
// remove, since `rm` and `git clean` are denied to it) is removed, and named in the ticket's comment. The copy belongs to
// that ticket alone. Ignored files stay (no `-x`): they do not keep `git worktree remove` from removing the copy.
// Tracked files, their uncommitted changes and the commits are never touched by `git clean`.
import type { Deps } from './cli.ts';

// The paths `git clean` says it removed: one «Removing <path>» line each (a folder ends in «/»).
export function removedOf(output: string): string[] {
  return output.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.startsWith('Removing ')).map((l) => l.slice('Removing '.length));
}

// Removes the untracked files and folders of `copy` and returns what it removed. A copy that cannot be cleaned (gone, or git
// fails) is not an error of the ticket: nothing is named that was not removed.
export function cleanCopy(deps: Deps, copy: string): string[] {
  try {
    return removedOf(deps.git(['clean', '-fd'], { cwd: copy }).stdout);
  } catch {
    return [];
  }
}
