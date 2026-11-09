// The checks of the public clone that `dynamo publish` shares in both of its steps (preparing the commit, and checking the
// commit the merge left): it is a folder, it is a git repository, and it is not the development repository this runs in.
import type { Deps } from './cli.ts';
import { isFolder } from './disk.ts';

export function assertClone(deps: Deps, top: string, clone: string): void {
  const common = (cwd: string) => {
    const r = deps.git(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd });
    return r.code === 0 ? r.stdout.trim() : null;
  };
  if (!isFolder(clone)) throw new Error(`${clone} is not a folder`);
  const there = common(clone);
  if (there === null) throw new Error(`${clone} is not a git repository`);
  if (there === common(top)) throw new Error(`${clone} is the development repository: the public repository is a clone of its own`);
}
