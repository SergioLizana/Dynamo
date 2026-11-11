// The second check `dynamo run` makes before it moves any card (after repocheck.ts): the main folder must be clean. `dynamo merge`
// refuses to merge into a dirty folder, so a run that starts on one builds and reviews every ticket and fails only at the merge,
// with the whole ticket spent. Listing the dirty files at the start costs nothing. Files git ignores (the copies, the logs) are not dirty.
import type { Deps, Output } from './cli.ts';
import { mainFolder } from './holds.ts';

// null when the main folder has no uncommitted or untracked file; otherwise the failed result, listing them.
export function checkClean(deps: Deps): Output | null {
  const main = mainFolder(deps);
  // -z: paths come NUL-separated and unquoted; `--untracked-files=all` names the files of a new folder, not the folder.
  const r = deps.git(['status', '--porcelain', '-z', '--untracked-files=all'], { cwd: main });
  if (r.code !== 0) return { ok: false, error: `could not check that the main folder ${main} is clean: ${r.stderr.trim()}; nothing was started`, main };
  const dirty = dirtyFiles(r.stdout);
  if (dirty.length === 0) return null;
  return { ok: false, error: `the main folder is not clean: ${dirty.join(', ')}; commit or remove them and run again; nothing was started`, main, dirty };
}

// The paths of `git status --porcelain -z`: entries `XY path`; a rename or copy is followed by its origin as an entry of its own.
export function dirtyFiles(porcelainZ: string): string[] {
  const parts = porcelainZ.split('\0').filter((p) => p !== '');
  const files: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i].slice(0, 2);
    files.push(parts[i].slice(3));
    if (/[RC]/.test(code)) i++;
  }
  return files;
}
