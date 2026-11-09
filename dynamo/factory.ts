// `.claude/factory.json`, the project data (what each value means: `guides/factory.md`).
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type Factory = {
  project: { repo: string; mainBranch: string; checks: string[]; [key: string]: unknown };
  [key: string]: unknown;
};

// The main folder of the project `from` is in (the current folder by default), not the folder this file is in: inside a
// plugin that is the plugin's cache. It looks up for `.git`: a folder is the main folder; a file is a copy's, and names the
// `.git/worktrees/<name>` of the main folder. It only reads files, since `status` runs no git.
export function projectRoot(from: string = process.cwd()): string {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const dot = join(dir, '.git');
    if (existsSync(dot)) return statSync(dot).isDirectory() ? dir : mainOfCopy(dot);
    if (dirname(dir) === dir) throw new Error(`${from} is not inside a git repository: dynamo works on the project it is run in`);
  }
}

// The `.git` file of a copy holds `gitdir: <main>/.git/worktrees/<name>`, absolute or relative to the file.
function mainOfCopy(dotFile: string): string {
  const named = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotFile, 'utf8'));
  if (named === null) throw new Error(`${dotFile} names no gitdir`);
  return dirname(dirname(dirname(resolve(dirname(dotFile), named[1]))));
}

// The version of the format of factory.json that this program reads (not Dynamo's release). Another one is refused, with
// no migration; the template in the repository is the file of this version.
export const FORMAT_VERSION = 1;

export function readFactory(root: string = projectRoot()): Factory {
  const factory = JSON.parse(readFileSync(join(root, '.claude', 'factory.json'), 'utf8'));
  if (factory?.version !== FORMAT_VERSION) {
    const found = factory?.version === undefined ? 'has no version' : `is version ${JSON.stringify(factory.version)}`;
    throw new Error(`factory.json ${found}: this dynamo reads version ${FORMAT_VERSION}. Start from the template of the format (see guides/factory.md of the plugin); there is no migration`);
  }
  if (typeof factory?.project !== 'object' || factory.project === null) throw new Error('factory.json has no project block');
  return factory;
}
