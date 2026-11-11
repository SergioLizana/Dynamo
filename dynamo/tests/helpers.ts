// What the tests of dynamo share: a scratch folder, and an environment with no gh or claude on the PATH.
import { after } from 'node:test';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Factory } from '../factory.ts';

export const FAKE_GH = join(import.meta.dirname, 'fake-gh.ts');
export const FAKE_CLAUDE = join(import.meta.dirname, 'fake-claude.ts');
export const DYNAMO = join(import.meta.dirname, '..', 'dynamo.ts');

// The engine reads the factory.json of the folder it is run in: this puts this repository's own into `dir`, a scratch project.
// The public repository has none of its own (it is the development one's), so there the template stands in, with the
// placeholders it asks the project to fill given a value.
export function withFactory(dir: string): string {
  mkdirSync(join(dir, '.claude'), { recursive: true });
  const root = join(import.meta.dirname, '..', '..');
  const own = join(root, '.claude', 'factory.json');
  const target = join(dir, '.claude', 'factory.json');
  if (existsSync(own)) copyFileSync(own, target);
  else {
    const text = readFileSync(join(root, 'templates', 'factory.json'), 'utf8');
    writeFileSync(target, text.replace('"repo": "<…>"', '"repo": "owner/name"').replace('"boardOwner": "<…>"', '"boardOwner": "owner"').replace('"<…>"', '"true"'));
  }
  return dir;
}

const PREFIX = 'claude-dynamo-';
const DAY = 24 * 60 * 60 * 1000;

// Removes the `claude-dynamo-*` folders of `root` last changed more than `maxAge` ms before `now`: what a suite killed before
// its `after()` left behind. Newer ones stay, since another suite may be using them. A folder that cannot be removed (still in
// use, on Windows) is skipped. Returns the names it removed.
export function removeOldScratch(root: string, now: number, maxAge: number): string[] {
  const removed: string[] = [];
  for (const name of readdirSync(root)) {
    if (!name.startsWith(PREFIX)) continue;
    try {
      const path = join(root, name);
      if (now - statSync(path).mtimeMs <= maxAge) continue;
      rmSync(path, { recursive: true, force: true });
      removed.push(name);
    } catch {
      // gone already, or in use: not ours to settle
    }
  }
  return removed;
}

// A suite that starts clears the folders of the ones that were killed.
removeOldScratch(tmpdir(), Date.now(), DAY);

// A new folder in the temp folder (a `claude*` one, where the hook lets writes go), removed when the tests end. It is given
// in the system's own real form (`.native` expands the 8.3 short names of Windows, `realpathSync` alone does not), so a test
// compares the same form of a path as a child process sees.
export function scratch(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), PREFIX)));
  after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A project of its own for the tests that need a board: the data of a factory.json, fixed here, so they run the same in any
// checkout (the public repository has no factory.json of its own, and a test must not depend on the one of this repository).
export const TEST_FACTORY: Factory = {
  version: 1,
  project: {
    repo: 'owner/project', mainBranch: 'main', boardOwner: 'owner', doneLabel: 'in-release', epicLabel: 'epic', ideaLabel: 'idea', checks: ['true'],
    budgetUsd: { builder: 10, reviewer: 4 }, timeoutMinutes: { builder: 30, reviewer: 15 }, checkTimeoutMinutes: 15,
    ticketsAtOnce: 5, documentsLanguage: 'English',
  },
  board: {
    boardNumber: 1, boardId: 'PVT_board', boardName: 'Dynamo', statusFieldId: 'PVTSSF_status',
    options: { Backlog: 'o1', Todo: 'o2', Build: 'o3', Verify: 'o4', Review: 'o5', Merge: 'o6', 'Needs Human': 'o7', Done: 'o8' },
  },
};

// A scratch folder that is a project (a `.git` folder and a `.claude/factory.json` with TEST_FACTORY), to run the program in
// through `cwd`: the program reads the factory.json of the folder it is run in.
export function scratchProject(): string {
  const dir = scratch();
  mkdirSync(join(dir, '.git'));
  mkdirSync(join(dir, '.claude'));
  writeFileSync(join(dir, '.claude', 'factory.json'), JSON.stringify(TEST_FACTORY, null, 2));
  return dir;
}

// The process environment with PATH set to an empty folder (so no real gh or claude can be found) and `extra` on top. On
// Windows the variable may be spelled `Path`: every spelling is dropped first.
export function noGhEnv(extra: Record<string, string> = {}): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.toUpperCase() !== 'PATH' && k !== 'DYNAMO_GH' && k !== 'DYNAMO_CLAUDE') env[k] = v;
  }
  const empty = join(scratch(), 'empty-path');
  mkdirSync(empty);
  return { ...env, PATH: empty, ...extra };
}

// The environment that replaces gh with the fake, its state in `state`.
export function fakeGhEnv(state: string): Record<string, string | undefined> {
  return noGhEnv({ DYNAMO_GH: JSON.stringify([process.execPath, FAKE_GH]), FAKE_GH: state });
}

// The environment that replaces claude with the fake, its state in `state`.
export function fakeClaudeEnv(state: string): Record<string, string | undefined> {
  return noGhEnv({ DYNAMO_CLAUDE: JSON.stringify([process.execPath, FAKE_CLAUDE]), FAKE_CLAUDE: state });
}
