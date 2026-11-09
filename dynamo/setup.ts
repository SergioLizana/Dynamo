// `dynamo setup --check <command>...` puts the factory in a project: it reads the repository and the board owner from gh and the
// main branch from git, takes every other value from the template of the plugin, rehearses each check in a temporary copy of
// the repository (a detached worktree of HEAD, as Verify runs it, with `<base>` as HEAD) and only then copies the template
// board for the project, links it to the repository, reads its ids back into the `board` block, writes factory.json, creates
// `.claude/settings.json` (the permission rules, `attribution`, `worktree` and the plugin, merged into what the file has) and the
// worktrees folder in .gitignore, creates the labels `project.doneLabel` and `project.epicLabel` if they are missing, writes a Dependabot file for an npm project and,
// for a public repository, turns on the default setup of code scanning. A check that fails leaves nothing written; one that
// gives 127 comes back with the `node --run <script>` form to write instead.
// Run again, it changes nothing it has made: with a `board` block it copies no second board and reads the ids again, with no
// `--check` it keeps the checks the file has, the settings and .gitignore get nothing twice, and the labels, the Dependabot file and the code scanning that exist are left alone, and with nothing new to commit it makes no commit.
// What it wrote is committed on `release/x.y.z` (made if there is none; setupcommit.ts) and nothing is pushed: the push is in the output, for the human.
// The CI: a project with no workflow gets a seed (`.github/workflows/ci.yml`: pull requests to the main branch, Node 24, one step per check);
// one that has workflows keeps them untouched, and the checks none of their `run:` lines runs are named in `ciMissing`.
import type { Deps, Output } from './cli.ts';
import { read, setting, usage } from './cli.ts';
import { checkTimeoutOf, endOf, runChecks } from './checks.ts';
import type { Check } from './checks.ts';
import type { Factory } from './factory.ts';
import type { Board } from './setups.ts';
import { SEED_PATH, missingChecks, runLinesOf, seedOf } from './setupci.ts';
import { copyBoard, ensureLabels, readBoard } from './setupboard.ts';
import { gapsOf, fillSettings, keptSettings, mergeSettings, neededSettings, withIgnore } from './setupsettings.ts';
import { commitSetup } from './setupcommit.ts';
import { checksOf, dependabotFile, failedCheck, hintFor, isPublic, mainBranchOf, managerOf, repoOf, withBoard, withValues } from './setups.ts';

const FACTORY = '.claude/factory.json';
const SETTINGS = '.claude/settings.json';

export async function setup(args: string[], deps: Deps): Promise<Output> {
  const commands = checksOf(args);
  const given = deps.files;
  if (!given) throw new Error('setup was given no files to read and write');
  const written: string[] = [FACTORY, SETTINGS];
  const files: NonNullable<Deps['files']> = { ...given, write: (r, p, text) => { written.push(p); given.write(r, p, text); } };
  const root = read(deps, ['rev-parse', '--show-toplevel']);
  const had = files.hasFactory(root) ? files.readFactory(root) : null;
  if (had === null && commands.length === 0) usage('usage: setup --check <command> [--check <command>]... (a project with no .claude/factory.json needs its checks)');

  const view = deps.gh(['repo', 'view', '--json', 'nameWithOwner,owner,isPrivate'], { cwd: root });
  if (view.code !== 0) throw new Error(`the repository could not be read with gh: ${endOf(view)}; nothing was written`);
  const factory = had === null ? fresh(view.stdout, commands, root, deps) : { ...had, project: { ...had.project, ...(commands.length > 0 ? { checks: commands } : {}) } };
  const settingsHad = files.readSettings(root);
  const checks = commands.length === 0 ? [] : await rehearse(commands, checkTimeoutOf(factory.project), root, deps, files);
  const failed = failedCheck(checks);
  if (failed !== null) {
    return { ok: false, error: `the check «${failed.command}» failed (${failed.code}); nothing was written`, checks: checks.map(describe) };
  }

  const repo = setting(factory.project, 'project', 'repo');
  const owner = setting(factory.project, 'project', 'boardOwner');
  const known = typeof had?.board === 'object' && had.board !== null ? (had.board as Record<string, unknown>).boardNumber : undefined;
  const copied = typeof known === 'number' && Number.isInteger(known) && known > 0 ? null : copyBoard(deps.gh, root, owner, repo);
  const board = readBoard(deps.gh, root, owner, copied ?? (known as number));
  const path = files.writeFactory(root, withBoard(factory, board));
  const { path: settings, kept: settingsKept } = writeSettings(root, factory, board, settingsHad, files);
  const gitignore = ignoreWorktrees(root, files);
  const labels = ensureLabels(deps.gh, root, repo, [setting(factory.project, 'project', 'doneLabel'), setting(factory.project, 'project', 'epicLabel')]);
  const dependabot = seedDependabot(root, files);
  const { ci, ciMissing } = seedCi(root, factory.project.mainBranch, factory.project.checks, files);
  const codeScanning = turnOnCodeScanning(repo, isPublic(view.stdout), root, deps);
  const committed = commitSetup(deps, root, written);
  return {
    ok: true, path, repo, boardOwner: owner, mainBranch: factory.project.mainBranch, board: board.boardNumber, boardCopied: copied !== null,
    settings, settingsKept, gitignore, labelsCreated: labels, dependabot, ci, ciMissing, codeScanning, ...committed, checksKept: commands.length === 0, checks: checks.map(describe),
  };
}

// The factory of a project that has none: the template with the values read from gh and git.
function fresh(viewed: string, commands: string[], root: string, deps: Deps): Factory {
  const files = deps.files as NonNullable<Deps['files']>;
  const found = repoOf(viewed);
  if (found === null) throw new Error('gh gave no repository name or owner; nothing was written');
  const head = deps.git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: root });
  const branch = deps.git(['branch', '--show-current'], { cwd: root });
  const mainBranch = mainBranchOf(head.code === 0 ? head.stdout : '', branch.code === 0 ? branch.stdout : '');
  if (mainBranch === null) throw new Error('the main branch could not be read from git (no origin/HEAD, and no branch is checked out); nothing was written');
  return withValues(files.template(), { ...found, mainBranch }, commands);
}

// The permission rules, `attribution`, `worktree` and the plugin, from templates/settings.json with its gaps filled and one rule
// per check, merged into the settings the project already had. A value the file has that differs from what the factory wants is
// kept and named in `kept`, for the output.
function writeSettings(root: string, factory: Factory, board: Board, had: unknown, files: NonNullable<Deps['files']>): { path: string; kept: string[] } {
  const project = factory.project;
  const gaps = gapsOf({ repo: setting(project, 'project', 'repo'), boardOwner: setting(project, 'project', 'boardOwner'), mainBranch: setting(project, 'project', 'mainBranch') }, board);
  const needed = neededSettings(fillSettings(files.settingsTemplate(), gaps), project.checks);
  return { path: files.writeSettings(root, mergeSettings(had, needed)), kept: keptSettings(had, needed) };
}

// `.claude/worktrees/` in .gitignore, once: a line that already ignores it leaves the file alone.
function ignoreWorktrees(root: string, files: NonNullable<Deps['files']>): string {
  const next = withIgnore(files.read(root, '.gitignore'));
  if (next === null) return '.gitignore already ignores .claude/worktrees/: not touched';
  files.write(root, '.gitignore', next);
  return 'added .claude/worktrees/ to .gitignore';
}

// Dependabot for npm, grouped, from package-lock.json. A file the project already has is not touched, and another package
// manager is said and left: the setup goes on either way.
function seedDependabot(root: string, files: NonNullable<Deps['files']>): string {
  const path = ['.github/dependabot.yml', '.github/dependabot.yaml'].find((p) => files.has(root, p));
  if (path !== undefined) return `${path} already exists: not touched`;
  const manager = managerOf((name) => files.has(root, name));
  if (manager === null) return 'no Dependabot file: there is no package-lock.json (only npm is supported)';
  if (manager !== 'npm') return `no Dependabot file: the project uses ${manager} (only npm is supported)`;
  files.write(root, '.github/dependabot.yml', dependabotFile());
  return 'wrote .github/dependabot.yml for npm, grouped';
}

// The CI of the project. With none, the seed is written once (the project owns it from then on); with one, it is not changed and
// each check is looked for in the `run:` lines of its workflows: the ones no line runs are named and the setup goes on.
function seedCi(root: string, mainBranch: string, checks: string[], files: NonNullable<Deps['files']>): { ci: string; ciMissing: string[] } {
  const workflows = files.workflows(root);
  if (workflows.length === 0) {
    files.write(root, SEED_PATH, seedOf(mainBranch, checks));
    return { ci: `wrote ${SEED_PATH}: on pull requests to ${mainBranch}, on Node 24, one step per check`, ciMissing: [] };
  }
  const ciMissing = missingChecks(checks, workflows.flatMap(runLinesOf));
  const said = ciMissing.length === 0 ? 'it runs every check' : `it does not run ${ciMissing.length} of the checks (ciMissing)`;
  return { ci: `the project has a CI: not changed; ${said}`, ciMissing };
}

// Code scanning (the default setup of CodeQL) for a public repository only. A refusal of gh is said, not fatal: the factory.json
// is already written.
function turnOnCodeScanning(repo: string, isOpen: boolean, root: string, deps: Deps): string {
  if (!isOpen) return 'no code scanning: the repository is private (or gh did not say it is public)';
  const r = deps.gh(['api', '--method', 'PATCH', `repos/${repo}/code-scanning/default-setup`, '-f', 'state=configured'], { cwd: root });
  return r.code === 0 ? 'default setup of code scanning configured' : `code scanning was not turned on: ${endOf(r)}`;
}

// A check as reported, with the form to write instead when its program could not start.
function describe(c: Check): Check & { hint?: string } {
  const hint = hintFor(c.command, c.code);
  return hint === null ? c : { ...c, hint };
}

// The checks in a detached worktree of HEAD in a temporary folder; the worktree and the folder are removed after them,
// whatever the checks did.
async function rehearse(commands: string[], limit: number, root: string, deps: Deps, files: NonNullable<Deps['files']>): Promise<Check[]> {
  const sha = read(deps, ['rev-parse', 'HEAD'], root);
  const folder = files.tempFolder();
  const copy = `${folder}/copy`.replace(/\\/g, '/');
  try {
    const made = deps.git(['worktree', 'add', '--detach', copy, sha], { cwd: root });
    if (made.code !== 0) throw new Error(`the temporary copy could not be made: ${endOf(made)}; nothing was written`);
    return await runChecks(commands, sha, copy, deps.exec, limit);
  } finally {
    deps.git(['worktree', 'remove', '--force', copy], { cwd: root });
    files.removeFolder(folder);
    deps.git(['worktree', 'prune'], { cwd: root });
  }
}
