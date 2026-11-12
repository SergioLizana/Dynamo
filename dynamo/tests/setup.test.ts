import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UsageError, setting } from '../cli.ts';
import { checkTimeoutOf, parseChecks } from '../checks.ts';
import { updateOf } from '../setupupdate.ts';
import { boardOf, boardTitle, checksOf, copiedNumber, dependabotFile, failedCheck, hintFor, isPublic, mainBranchOf, managerOf, missingLabels, repoOf, setupArgsOf, withBoard, withValues } from '../setups.ts';
import { setup } from '../setup.ts';
import { missingChecks, runLinesOf, seedOf } from '../setupci.ts';
import { fillSettings, gapsOf, keptSettings, mergeSettings, neededSettings, ruleOf, withIgnore } from '../setupsettings.ts';
import { files, readTemplate } from '../setupfiles.ts';
import { execAsync } from '../exec.ts';
import { gh } from '../gh.ts';
import { git } from '../git.ts';
import { DYNAMO, fakeGhEnv, scratch, scratchProject } from './helpers.ts';
import { budgetOf, timeoutOf } from '../runs.ts';
import { readFactory } from '../factory.ts';
import type { Deps } from '../cli.ts';
import type { Factory } from '../factory.ts';

// --- The pure part (setups.ts): data in, data out.

test('checksOf reads each --check, in order, as «--check x» or «--check=x»; an empty one or any other argument is a usage error; none is allowed', () => {
  assert.deepEqual(checksOf(['--check', 'a b', '--check=c d ', '--check', ' e']), ['a b', 'c d', 'e']);
  assert.deepEqual(checksOf([]), []);
  for (const bad of [['--check'], ['--check', ' '], ['--check='], ['x'], ['--check', 'a', '--other']]) {
    assert.throws(() => checksOf(bad), UsageError, JSON.stringify(bad));
  }
});

test('setupArgsOf reads --language as «--language x» or «--language=x», trimmed, null when not given; an empty one is a usage error and --check is read as before', () => {
  assert.deepEqual(setupArgsOf(['--check', 'a', '--language', ' Español ']), { checks: ['a'], language: 'Español' });
  assert.deepEqual(setupArgsOf(['--language=Deutsch', '--check=b']), { checks: ['b'], language: 'Deutsch' });
  assert.deepEqual(setupArgsOf(['--check', 'a']), { checks: ['a'], language: null });
  for (const bad of [['--language'], ['--language', ' '], ['--language=']]) assert.throws(() => setupArgsOf(bad), UsageError, JSON.stringify(bad));
  assert.deepEqual(checksOf(['--language', 'Español', '--check', 'a']), ['a']);
});

test('withValues sets project.documentsLanguage from the language given, and keeps English when none is', () => {
  const template = readTemplate();
  const values = { repo: 'o/r', boardOwner: 'o', mainBranch: 'main' };
  assert.equal(withValues(template, values, ['x'], 'Español').project.documentsLanguage, 'Español');
  assert.equal(withValues(template, values, ['x']).project.documentsLanguage, 'English');
  assert.equal(template.project.documentsLanguage, 'English');
});

test('repoOf reads the name and the owner of the repository from gh and nothing from anything else', () => {
  assert.deepEqual(repoOf('{"nameWithOwner":"o/r","owner":{"login":"o","id":"x"}}'), { repo: 'o/r', boardOwner: 'o' });
  for (const bad of ['', 'null', '[]', '{}', '{"nameWithOwner":"o/r"}', '{"nameWithOwner":"","owner":{"login":"o"}}', '{"nameWithOwner":"o/r","owner":{"login":""}}']) {
    assert.equal(repoOf(bad), null, bad);
  }
});

test('mainBranchOf is the branch origin/HEAD points to, else the branch checked out, else nothing', () => {
  assert.equal(mainBranchOf('origin/trunk\n', 'feature'), 'trunk');
  assert.equal(mainBranchOf('origin/release/x', ''), 'release/x');
  assert.equal(mainBranchOf('', 'main\n'), 'main');
  assert.equal(mainBranchOf('main', 'dev'), 'dev');
  assert.equal(mainBranchOf('', ''), null);
});

test('withValues keeps every value of the template but the three read and the checks, and does not change the template', () => {
  const template: Factory = { project: { repo: '<…>', mainBranch: 'main', boardOwner: '<…>', checks: ['<…>'], ticketsAtOnce: 1 } } as Factory;
  const made = withValues(template, { repo: 'o/r', boardOwner: 'o', mainBranch: 'dev' }, ['x', 'y']);
  assert.deepEqual(made.project, { repo: 'o/r', mainBranch: 'dev', boardOwner: 'o', checks: ['x', 'y'], ticketsAtOnce: 1 });
  assert.deepEqual(template.project.checks, ['<…>']);
});

test('hintFor suggests node --run only for a check that gave 127, with the script when it is an npm one', () => {
  assert.match(String(hintFor('npm run build', 127)), /`node --run build`/);
  assert.match(String(hintFor('npm run-script lint -- --fix', 127)), /`node --run lint`/);
  assert.match(String(hintFor('npm test', 127)), /`node --run test`/);
  assert.match(String(hintFor('pnpm build', 127)), /`node --run <script>`/);
  for (const code of [0, 1, 2, 124, 126]) assert.equal(hintFor('npm run build', code), null, String(code));
});

test('failedCheck is the first check that did not exit 0', () => {
  const ok = { command: 'a', code: 0, output: '' };
  const bad = { command: 'b', code: 2, output: '' };
  assert.equal(failedCheck([ok, ok]), null);
  assert.equal(failedCheck([ok, bad, { ...bad, command: 'c' }]), bad);
});

const COLUMN_NAMES = ['Backlog', 'Todo', 'Build', 'Verify', 'Review', 'Merge', 'Needs Human', 'Done'];
const view = JSON.stringify({ number: 7, id: 'PVT_new', title: 'shop' });
const fieldList = (names: string[] = COLUMN_NAMES) => JSON.stringify({
  fields: [{ id: 'F0', name: 'Title', type: 'ProjectV2Field' }, { id: 'PVTSSF_new', name: 'Status', type: 'ProjectV2SingleSelectField', options: names.map((name) => ({ id: 'id-' + name, name })) }],
  totalCount: 2,
});

test('boardTitle is the name of the repository without its owner', () => {
  assert.equal(boardTitle('acme/shop'), 'shop');
  assert.equal(boardTitle('shop'), 'shop');
});

test('copiedNumber is the number gh printed for the new board, and nothing else', () => {
  assert.equal(copiedNumber('{"number":7,"id":"x","title":"shop"}'), 7);
  for (const bad of ['', 'null', '[]', '{}', '{"number":"7"}', '{"number":0}', '{"number":1.5}', 'not json']) assert.equal(copiedNumber(bad), null, bad);
});

test('boardOf reads the number, id, name, Status field and the id of each column of Dynamo, and ignores any other option', () => {
  const board = boardOf(7, view, fieldList([...COLUMN_NAMES, 'Extra']));
  assert.deepEqual(board, {
    boardNumber: 7, boardId: 'PVT_new', boardName: 'shop', statusFieldId: 'PVTSSF_new',
    options: Object.fromEntries(COLUMN_NAMES.map((n) => [n, 'id-' + n])),
  });
});

test('boardOf throws, saying what is wrong, for a board with a column missing, with no Status field, or that gh did not describe', () => {
  assert.throws(() => boardOf(7, view, fieldList(COLUMN_NAMES.filter((n) => n !== 'Merge' && n !== 'Done'))), /no column Merge, Done/);
  assert.throws(() => boardOf(7, view, '{"fields":[{"id":"F0","name":"Title"}]}'), /no Status field/);
  assert.throws(() => boardOf(7, view, 'nope'), /no Status field/);
  assert.throws(() => boardOf(7, '{}', fieldList()), /no id or title for board 7/);
});

test('missingLabels are the wanted labels that the list does not show, once each, in order', () => {
  assert.deepEqual(missingLabels('[{"name":"bug"}]', ['in-release', 'epic', 'in-release']), ['in-release', 'epic']);
  assert.deepEqual(missingLabels('[{"name":"epic"},{"name":"in-release"}]', ['in-release', 'epic']), []);
  assert.throws(() => missingLabels('{}', ['x']), /no list of labels/);
});

test('withBoard sets the board block and changes nothing else, nor the factory it is given', () => {
  const factory = { version: 1, project: { repo: 'o/r', mainBranch: 'main', checks: ['x'] } } as Factory;
  const board = boardOf(7, view, fieldList());
  assert.deepEqual(withBoard(factory, board), { ...factory, board });
  assert.equal(Object.hasOwn(factory, 'board'), false);
});

// --- The subcommand, on a temporary git repository, with real git and real processes, and the fake gh.

const run = (cwd: string, ...args: string[]) => {
  const r = git(['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd });
  assert.equal(r.code, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

// A project with one commit that holds two scripts, and a file that is not committed. No `.claude/factory.json`.
function project(): string {
  const dir = scratch();
  run(dir, 'init', '-q', '-b', 'main');
  run(dir, 'config', 'user.name', 't');
  run(dir, 'config', 'user.email', 't@t');
  writeFileSync(join(dir, 'pass.js'), '');
  writeFileSync(join(dir, 'fail.js'), "console.log('what failed'); process.exit(3);");
  writeFileSync(join(dir, 'where.js'), 'console.log("in " + process.cwd() + (process.getBuiltinModule("fs").existsSync("loose.txt") ? " with loose" : " no loose"));');
  run(dir, 'add', '.');
  run(dir, 'commit', '-q', '-m', 'A');
  writeFileSync(join(dir, 'loose.txt'), 'not committed');
  return dir;
}

const REPO = '{"nameWithOwner":"acme/shop","owner":{"login":"acme"}}';
type Answer = { args: string[]; stdout?: string; stderr?: string; code?: number };
// What gh says about the board of a project: the copy, its link, its description and its fields, and the labels of the repository.
const boardAnswers = (labels: string[] = ['epic', 'idea']): Answer[] => [
  { args: ['project', 'copy'], stdout: '{"number":7,"id":"PVT_new","title":"shop"}' },
  { args: ['project', 'link'] },
  { args: ['project', 'view'], stdout: view },
  { args: ['project', 'field-list'], stdout: fieldList() },
  { args: ['label', 'list'], stdout: JSON.stringify(labels.map((name) => ({ name }))) },
  { args: ['label', 'create'] },
];
const answering = (what: string, change: Partial<Answer>, labels?: string[]): Answer[] => boardAnswers(labels).map((a) => (a.args[1] === what ? { ...a, ...change } : a));

function gitWith(dir: string, state: string = scratch(), repo: string = REPO, more: object[] = []): Deps {
  writeFileSync(join(state, 'answers.json'), JSON.stringify([{ args: ['repo', 'view'], stdout: repo }, ...more, ...boardAnswers()]));
  const env = fakeGhEnv(state);
  return {
    gh: (args, options) => gh(args, { ...options, env }), git: (args, options) => git(args, { cwd: dir, ...options }), exec: execAsync,
    factory: () => { throw new Error('setup reads no factory.json'); }, files,
  };
}

const factoryOf = (dir: string) => join(dir, '.claude', 'factory.json');
const readBack = (dir: string) => JSON.parse(readFileSync(factoryOf(dir), 'utf8')) as Factory;

// The calls the fake gh got, each as its arguments joined.
const callsOf = (state: string): string[] => readFileSync(join(state, 'calls.jsonl'), 'utf8').split('\n').filter((l) => l !== '').map((l) => (JSON.parse(l).args as string[]).join(' '));

test('run again with no language it keeps the one the file has; with a language it changes it', async () => {
  const dir = project();
  assert.equal((await setup(['--check', 'node pass.js', '--language', 'Español'], gitWith(dir))).ok, true);
  assert.equal((await setup([], gitWith(dir))).ok, true);
  assert.equal(readBack(dir).project.documentsLanguage, 'Español');
  assert.equal((await setup(['--language', 'Deutsch'], gitWith(dir))).ok, true);
  assert.equal(readBack(dir).project.documentsLanguage, 'Deutsch');
});

test('gh failing, or a repository with no commit, is an error and writes nothing', async () => {
  const dir = project();
  const broken = gitWith(dir);
  broken.gh = () => ({ code: 1, stdout: '', stderr: 'no repo' });
  await assert.rejects(setup(['--check', 'node pass.js'], broken), /could not be read with gh.*no repo.*nothing was written/);
  const empty = scratch();
  run(empty, 'init', '-q', '-b', 'main');
  await assert.rejects(setup(['--check', 'node pass.js'], gitWith(empty)), /rev-parse HEAD failed/);
  assert.equal(existsSync(factoryOf(dir)) || existsSync(factoryOf(empty)), false);
});

test('called through the entry point in a project with no config, it writes the file; with no --check it exits 2', () => {
  const dir = project();
  const state = scratch();
  writeFileSync(join(state, 'answers.json'), JSON.stringify([{ args: ['repo', 'view'], stdout: REPO }, ...boardAnswers()]));
  // git and node are needed on the PATH here (the fake gh replaces only gh).
  const call = (...args: string[]) => spawnSync(process.execPath, [DYNAMO, 'setup', ...args], { cwd: dir, encoding: 'utf8', env: { ...fakeGhEnv(state), PATH: process.env.PATH, Path: process.env.Path } });
  const none = call();
  assert.equal(none.status, 2, none.stdout);
  const done = call('--check', 'node pass.js');
  assert.equal(done.status, 0, done.stdout + done.stderr);
  assert.equal(JSON.parse(done.stdout.split('\n')[0]).ok, true);
  assert.equal((JSON.parse(readFileSync(factoryOf(dir), 'utf8')) as Factory).project.repo, 'acme/shop');
});

// --- The board and the labels.

const COPY = 'project copy 3 --source-owner SergioLizana --target-owner acme --title shop --format json';
const LINK = 'project link 7 --owner acme --repo acme/shop';

test('a board that is not a copy of the template (a column missing) writes no factory.json', async () => {
  const dir = project();
  const answers = answering('field-list', { stdout: fieldList(['Backlog', 'Todo']) });
  await assert.rejects(setup(['--check', 'node pass.js'], gitWith(dir, scratch(), REPO, answers)), /no column Build/);
  assert.equal(existsSync(factoryOf(dir)), false);
});

test('a copy that gh refuses, or a board that cannot be linked, is an error and writes nothing', async () => {
  const a = project();
  await assert.rejects(setup(['--check', 'node pass.js'], gitWith(a, scratch(), REPO, answering('copy', { code: 1, stdout: '', stderr: 'denied' }))), /could not be copied: denied/);
  const b = project();
  await assert.rejects(setup(['--check', 'node pass.js'], gitWith(b, scratch(), REPO, answering('link', { code: 1, stdout: '', stderr: 'denied' }))), /board 7 was copied but could not be linked to acme\/shop: denied/);
  assert.equal(existsSync(factoryOf(a)) || existsSync(factoryOf(b)), false);
});

test('run again, it copies no second board and reads the ids again, even if a column was recreated', async () => {
  const dir = project();
  assert.equal((await setup(['--check', 'node pass.js'], gitWith(dir))).ok, true);
  const before = readBack(dir);
  const state = scratch();
  const renamed = fieldList().replace('id-Review', 'id-Review-new');
  const again = await setup([], gitWith(dir, state, REPO, answering('field-list', { stdout: renamed }, ['epic', 'idea', 'in-release'])));
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(again.boardCopied, false);
  const calls = callsOf(state);
  assert.deepEqual(calls.filter((c) => c.startsWith('project copy') || c.startsWith('project link') || c.startsWith('label create')), []);
  assert.ok(calls.includes('project view 7 --owner acme --format json'));
  const after = readBack(dir);
  assert.equal((after.board as { options: Record<string, string> }).options.Review, 'id-Review-new');
  assert.deepEqual({ ...after, board: undefined }, { ...before, board: undefined });
});

test('run again with no --check, it keeps the checks it has and runs none; with a --check it replaces them only if that passes', async () => {
  const dir = project();
  assert.equal((await setup(['--check', 'node pass.js', '--check', 'node where.js'], gitWith(dir))).ok, true);
  const kept = await setup([], gitWith(dir));
  assert.equal(kept.checksKept, true);
  assert.deepEqual(kept.checks, []);
  assert.deepEqual(readBack(dir).project.checks, ['node pass.js', 'node where.js']);
  assert.equal((await setup(['--check', 'node fail.js'], gitWith(dir))).ok, false);
  assert.deepEqual(readBack(dir).project.checks, ['node pass.js', 'node where.js']);
  assert.equal((await setup(['--check', 'node pass.js'], gitWith(dir))).ok, true);
  assert.deepEqual(readBack(dir).project.checks, ['node pass.js']);
});

test('a project with no factory.json and no --check is a usage error', async () => {
  await assert.rejects(setup([], gitWith(project())), UsageError);
});

test('a factory.json with no board block (a run that stopped after writing it) gets its board copied', async () => {
  const dir = project();
  const template = readTemplate();
  files.writeFactory(dir, { ...template, project: { ...template.project, repo: 'acme/shop', boardOwner: 'acme', checks: ['node pass.js'] } });
  const out = await setup([], gitWith(dir));
  assert.equal(out.boardCopied, true, JSON.stringify(out));
  assert.equal(readBack(dir).board !== undefined, true);
});

// --- Bringing an installed factory.json up to date

test('updateOf adds a missing key with the template value, asks one with none, removes one the template lacks, and keeps the values the file has', () => {
  const template = { repo: '<…>', mainBranch: 'main', ideaLabel: 'idea', checks: ['<…>'], levels: { low: { model: 'sonnet' }, high: { model: 'opus' } } };
  const had = { repo: 'a/b', mainBranch: 'dev', backlog: 'old', levels: { low: { model: 'haiku' }, extra: 1 } };
  const out = updateOf(template, had, ['repo', 'mainBranch']);
  assert.deepEqual(out.project, { repo: 'a/b', mainBranch: 'dev', ideaLabel: 'idea', levels: { low: { model: 'haiku' }, high: { model: 'opus' } } });
  assert.deepEqual(out.added, ['ideaLabel', 'levels.high']);
  assert.deepEqual(out.asked, ['checks']);
  assert.deepEqual(out.removed.sort(), ['backlog', 'levels.extra']);
  assert.equal(Object.hasOwn(had, 'ideaLabel'), false);
  assert.deepEqual(updateOf(template, { mainBranch: 'main' }, ['repo', 'mainBranch']).asked, ['repo', 'checks']);
});

test('setup run again adds the keys the template has and the file lacks, removes the ones nothing reads, and names both', async () => {
  const dir = project();
  const template = readTemplate();
  const { ideaLabel: _gone, ...rest } = template.project;
  files.writeFactory(dir, { ...template, project: { ...rest, backlog: 'old', repo: 'acme/shop', boardOwner: 'acme', checks: ['node pass.js'] } });
  const out = await setup([], gitWith(dir));
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual(out.keysAdded, ['ideaLabel']);
  assert.deepEqual(out.keysRemoved, ['backlog']);
  const back = readBack(dir).project;
  assert.equal(back.ideaLabel, template.project.ideaLabel);
  assert.equal(Object.hasOwn(back, 'backlog'), false);
  assert.deepEqual(back.checks, ['node pass.js']);
});

test('setup run again on a file with no checks asks for them like a first install, and fills the repository from gh', async () => {
  const dir = project();
  const template = readTemplate();
  const { repo: _r, checks: _c, ...rest } = template.project;
  files.writeFactory(dir, { ...template, project: rest as Factory['project'] });
  await assert.rejects(setup([], gitWith(dir)), UsageError);
  const out = await setup(['--check', 'node pass.js'], gitWith(dir));
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual(out.keysFilled, ['repo', 'checks']);
  assert.equal(readBack(dir).project.repo, 'acme/shop');
  assert.deepEqual(readBack(dir).project.checks, ['node pass.js']);
});

test('the error for a missing key of factory.json says to run /dynamo:setup', () => {
  assert.throws(() => setting({}, 'project', 'ideaLabel'), /has no project\.ideaLabel; run \/dynamo:setup to bring factory\.json up to date/);
  assert.throws(() => parseChecks([]), /run \/dynamo:setup to bring factory\.json up to date/);
  assert.throws(() => checkTimeoutOf({}), /run \/dynamo:setup to bring factory\.json up to date/);
  assert.throws(() => budgetOf({}, 'builder'), /run \/dynamo:setup to bring factory\.json up to date/);
  assert.throws(() => timeoutOf({}, 'builder'), /run \/dynamo:setup to bring factory\.json up to date/);
  const dir = scratchProject();
  writeFileSync(join(dir, '.claude', 'factory.json'), JSON.stringify({ version: 1 }));
  assert.throws(() => readFactory(dir), /has no project block; run \/dynamo:setup to bring factory\.json up to date/);
});

// --- Dependabot and code scanning (pure part)

test('managerOf is npm with package-lock.json, the name of another manager from its lock file, else null', () => {
  const only = (...names: string[]) => (n: string) => names.includes(n);
  assert.equal(managerOf(only('package-lock.json')), 'npm');
  assert.equal(managerOf(only('package-lock.json', 'yarn.lock')), 'npm');
  assert.equal(managerOf(only('pnpm-lock.yaml')), 'pnpm');
  assert.equal(managerOf(only('yarn.lock')), 'yarn');
  assert.equal(managerOf(only('bun.lock')), 'bun');
  assert.equal(managerOf(only('bun.lockb')), 'bun');
  assert.equal(managerOf(only()), null);
});

test('dependabotFile updates npm from the root and groups its updates in one', () => {
  const text = dependabotFile();
  assert.match(text, /^version: 2$/m);
  assert.match(text, /package-ecosystem: npm/);
  assert.match(text, /directory: \//);
  assert.match(text, /groups:\n\s+\S+:\n\s+patterns:\n\s+- "\*"/);
});

test('isPublic is true only when gh says the repository is not private', () => {
  assert.equal(isPublic('{"nameWithOwner":"o/r","isPrivate":false}'), true);
  for (const other of ['{"isPrivate":true}', '{}', '', 'null', '{"isPrivate":"no"}']) assert.equal(isPublic(other), false, other);
});

// --- Dependabot and code scanning (the subcommand)

const dependabotPath = (dir: string) => join(dir, '.github', 'dependabot.yml');
const calls = (state: string) => readFileSync(join(state, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { args: string[] });
const scanning = (state: string) => calls(state).filter((c) => c.args[0] === 'api' && c.args.some((a) => a.includes('code-scanning/default-setup')));
const PUBLIC = '{"nameWithOwner":"acme/shop","owner":{"login":"acme"},"isPrivate":false}';
const PRIVATE = '{"nameWithOwner":"acme/shop","owner":{"login":"acme"},"isPrivate":true}';

function withLock(dir: string, name: string): void {
  writeFileSync(join(dir, name), '');
  run(dir, 'add', name);
  run(dir, 'commit', '-q', '-m', name);
}

test('with another package manager the setup says so, writes no Dependabot file and goes on', async () => {
  for (const [lock, name] of [['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn']]) {
    const dir = project();
    withLock(dir, lock);
    const out = await setup(['--check', 'node pass.js'], gitWith(dir));
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.match(String(out.dependabot), new RegExp(name));
    assert.equal(existsSync(dependabotPath(dir)), false);
    assert.equal(existsSync(factoryOf(dir)), true, 'it went on');
  }
});

test('an existing Dependabot file, .yml or .yaml, is not touched', async () => {
  for (const name of ['dependabot.yml', 'dependabot.yaml']) {
    const dir = project();
    withLock(dir, 'package-lock.json');
    mkdirSync(join(dir, '.github'));
    const mine = join(dir, '.github', name);
    writeFileSync(mine, 'version: 2\nupdates: []\n');
    const out = await setup(['--check', 'node pass.js'], gitWith(dir));
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(readFileSync(mine, 'utf8'), 'version: 2\nupdates: []\n');
    assert.deepEqual(readdirSync(join(dir, '.github')).filter((n) => n !== 'workflows'), [name]);
    assert.match(String(out.dependabot), /already/);
  }
});

test('code scanning refused by gh is reported and the setup still ends with its files written', async () => {
  const dir = project();
  const state = scratch();
  const out = await setup(['--check', 'node pass.js'], gitWith(dir, state, PUBLIC, [{ args: ['api'], code: 1, stderr: 'HTTP 403' }]));
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.match(String(out.codeScanning), /HTTP 403/);
  assert.equal(existsSync(factoryOf(dir)), true);
});

// --- The permission rules, attribution, worktree and the plugin (pure part: setupsettings.ts)

const GAPS = gapsOf({ repo: 'acme/shop', boardOwner: 'acme', mainBranch: 'trunk' }, boardOf(7, view, fieldList()));
const strings = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : typeof v === 'object' && v !== null ? Object.values(v).flatMap(strings) : []);
type Template = { permissions: { allow: string[]; deny: string[]; ask: string[] } };

test('fillSettings replaces every gap at any depth, leaves a <base> of a check alone, and does not change the template', () => {
  const template = { a: ['x <repo> <boardNumber>', { b: '<boardId>/<statusFieldId> <boardOwner> <mainBranch>' }], c: 3, d: 'git diff <base>' };
  const filled = fillSettings(template, GAPS);
  assert.deepEqual(filled, { a: ['x acme/shop 7', { b: 'PVT_new/PVTSSF_new acme trunk' }], c: 3, d: 'git diff <base>' });
  assert.equal(template.a[0], 'x <repo> <boardNumber>');
  assert.deepEqual(strings(fillSettings(files.settingsTemplate(), GAPS)).filter((s) => /<\w+>/.test(s)), []);
});

test('there is one rule per check, added to the allow list of the filled template', () => {
  const made = neededSettings(fillSettings(files.settingsTemplate(), GAPS), ['node --run build', 'git diff --check <base>']) as Template;
  assert.equal(ruleOf('node --run build'), 'Bash(node --run build)');
  assert.equal(made.permissions.allow.filter((r) => r === 'Bash(node --run build)').length, 1);
  assert.equal(made.permissions.allow.filter((r) => r === 'Bash(git diff --check *)').length, 1);
  assert.ok(!made.permissions.allow.some((r) => r.includes('<base>')));
  assert.equal(ruleOf('git diff --check <base>'), 'Bash(git diff --check *)');
  assert.equal(made.permissions.allow.length, (files.settingsTemplate() as Template).permissions.allow.length + 2);
  assert.throws(() => neededSettings([], []), /not a JSON object/);
});

const needed = () => neededSettings(fillSettings(files.settingsTemplate(), GAPS), ['node --run build']);

test('the merge writes attribution, worktree, the plugin and the rules into no file at all', () => {
  const made = mergeSettings(null, needed()) as Record<string, unknown>;
  assert.deepEqual(made.worktree, { baseRef: 'head' });
  assert.deepEqual(made.attribution, { commit: '', pr: '' });
  assert.deepEqual(made.enabledPlugins, { 'dynamo@dynamo': true });
  assert.deepEqual(made, needed());
});

test('the merge keeps what the file already had: its rules in their order, its keys, and the keys of the blocks it shares', () => {
  const mine = {
    model: 'opus', env: { A: '1' },
    enabledPlugins: { 'other@market': true, 'dynamo@dynamo': false },
    worktree: { baseRef: 'fresh', symlinkDirectories: ['node_modules'] },
    attribution: { commit: 'signed' },
    permissions: { allow: ['Bash(mine *)', 'Bash(git status*)'], deny: ['Bash(never)'], defaultMode: 'plan' },
    hooks: { Stop: [] },
  };
  const snapshot = structuredClone(mine);
  const made = mergeSettings(mine, needed()) as Record<string, any>;
  assert.deepEqual(mine, snapshot, 'the file read is not changed');
  assert.equal(made.model, 'opus');
  assert.deepEqual(made.env, { A: '1' });
  assert.deepEqual(made.hooks, { Stop: [] });
  assert.equal(made.permissions.defaultMode, 'plan');
  assert.deepEqual(made.permissions.allow.slice(0, 2), ['Bash(mine *)', 'Bash(git status*)']);
  assert.equal(made.permissions.allow.filter((r: string) => r === 'Bash(git status*)').length, 1);
  assert.ok(made.permissions.allow.includes('Bash(node --run build)'));
  assert.deepEqual(made.permissions.deny.slice(0, 1), ['Bash(never)']);
  assert.ok(made.permissions.deny.includes('Bash(git reset --hard*)'));
  assert.ok(made.permissions.ask.includes('Bash(git push*)'));
  assert.deepEqual(made.enabledPlugins, { 'other@market': true, 'dynamo@dynamo': false });
  assert.deepEqual(made.worktree, { baseRef: 'fresh', symlinkDirectories: ['node_modules'] });
  assert.deepEqual(made.attribution, { commit: 'signed', pr: '' });
  assert.deepEqual(keptSettings(mine, needed()), [
    'worktree.baseRef is "fresh" in the file and was kept; the factory wants "head"',
    'attribution.commit is "signed" in the file and was kept; the factory wants ""',
    'enabledPlugins.dynamo@dynamo is false in the file and was kept; the factory wants true',
  ]);
});

test('the merge keeps every value the file has, of any shape, and still writes what is missing', () => {
  const made = mergeSettings({ worktree: { baseRef: 'fresh' }, attribution: { commit: 'signed', pr: 'by me' }, enabledPlugins: { 'dynamo@dynamo': false }, permissions: { allow: 'Bash(x)' } }, needed()) as Record<string, any>;
  assert.deepEqual(made.worktree, { baseRef: 'fresh' });
  assert.deepEqual(made.attribution, { commit: 'signed', pr: 'by me' });
  assert.deepEqual(made.enabledPlugins, { 'dynamo@dynamo': false });
  assert.equal(made.permissions.allow, 'Bash(x)');
  assert.ok(Array.isArray(made.permissions.deny) && made.permissions.deny.length > 0, 'a missing key is still written');
  const odd = mergeSettings({ worktree: 'x', permissions: 3 }, needed()) as Record<string, any>;
  assert.equal(odd.worktree, 'x');
  assert.equal(odd.permissions, 3);
  assert.deepEqual(mergeSettings({}, needed()), needed());
  assert.deepEqual(keptSettings(null, needed()), []);
  assert.deepEqual(keptSettings(needed(), needed()), []);
});

test('merging twice is merging once: nothing is duplicated', () => {
  const once = mergeSettings({ permissions: { allow: ['Bash(mine *)'] } }, needed());
  assert.deepEqual(mergeSettings(once, needed()), once);
  const rules = (once as unknown as Template).permissions.allow;
  assert.equal(new Set(rules).size, rules.length);
});

test('a settings file that is not an object is an error', () => {
  for (const bad of [[], 'x', 3]) assert.throws(() => mergeSettings(bad, needed()), /not a JSON object/);
});

test('withIgnore adds .claude/worktrees/ once, keeps the endings of the file, and does nothing if a line already ignores the folder', () => {
  assert.equal(withIgnore(null), '.claude/worktrees/\n');
  assert.equal(withIgnore(''), '.claude/worktrees/\n');
  assert.equal(withIgnore('node_modules/\n'), 'node_modules/\n.claude/worktrees/\n');
  assert.equal(withIgnore('node_modules/'), 'node_modules/\n.claude/worktrees/\n');
  assert.equal(withIgnore('a\r\nb\r\n'), 'a\r\nb\r\n.claude/worktrees/\r\n');
  for (const has of ['.claude/worktrees/\n', 'a\n/.claude/worktrees\n', '  .claude/worktrees  \r\nb', '.claude/worktrees']) assert.equal(withIgnore(has), null, has);
  assert.notEqual(withIgnore('# .claude/worktrees/\n'), null);
  assert.notEqual(withIgnore('.claude/worktrees-old/\n'), null);
});

// --- The same, through the subcommand

const settingsOf = (dir: string) => JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8')) as Record<string, any>;
const ignoreOf = (dir: string) => readFileSync(join(dir, '.gitignore'), 'utf8');

test('the setup keeps the settings the project already had', async () => {
  const dir = project();
  mkdirSync(join(dir, '.claude'));
  writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({ model: 'opus', enabledPlugins: { 'x@y': true }, permissions: { allow: ['Bash(mine *)'], deny: ['Bash(no)'] } }));
  assert.equal((await setup(['--check', 'node pass.js'], gitWith(dir))).ok, true);
  const s = settingsOf(dir);
  assert.equal(s.model, 'opus');
  assert.deepEqual(s.enabledPlugins, { 'x@y': true, 'dynamo@dynamo': true });
  assert.equal(s.permissions.allow[0], 'Bash(mine *)');
  assert.equal(s.permissions.deny[0], 'Bash(no)');
  assert.ok(s.permissions.allow.includes('Bash(node pass.js)'));
});

test('the setup keeps a value the project had that is not what the factory wants, and says so', async () => {
  const dir = project();
  mkdirSync(join(dir, '.claude'));
  writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({ worktree: { baseRef: 'fresh' } }));
  const out = await setup(['--check', 'node pass.js'], gitWith(dir));
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(settingsOf(dir).worktree.baseRef, 'fresh');
  assert.deepEqual(out.settingsKept, ['worktree.baseRef is "fresh" in the file and was kept; the factory wants "head"']);
});

test('a settings file that is not JSON is an error and nothing is written or copied', async () => {
  const dir = project();
  mkdirSync(join(dir, '.claude'));
  writeFileSync(join(dir, '.claude', 'settings.json'), '{ nope');
  const state = scratch();
  await assert.rejects(setup(['--check', 'node pass.js'], gitWith(dir, state)), /settings\.json is not valid JSON; nothing was written/);
  assert.equal(existsSync(factoryOf(dir)), false);
  assert.equal(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8'), '{ nope');
  assert.equal(existsSync(join(state, 'calls.jsonl')) && callsOf(state).some((c) => c.startsWith('project')), false);
});

test('run again, nothing of the settings or .gitignore is duplicated, and an ignore line the project had is enough', async () => {
  const dir = project();
  assert.equal((await setup(['--check', 'node pass.js'], gitWith(dir))).ok, true);
  const settings = readFileSync(join(dir, '.claude', 'settings.json'), 'utf8');
  const ignore = ignoreOf(dir);
  const again = await setup([], gitWith(dir));
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.match(String(again.gitignore), /not touched/);
  assert.equal(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8'), settings);
  assert.equal(ignoreOf(dir), ignore);
  const mine = project();
  writeFileSync(join(mine, '.gitignore'), '/.claude/worktrees\n');
  await setup(['--check', 'node pass.js'], gitWith(mine));
  assert.equal(ignoreOf(mine), '/.claude/worktrees\n');
});

// --- The CI (setupci.ts and the subcommand)

const CHECKS = ['claude plugin validate . --strict', 'git diff --check <base>...HEAD', 'node --test "dynamo/tests/*.test.ts"'];
const ciPath = (dir: string) => join(dir, '.github', 'workflows', 'ci.yml');

test('seedOf runs on pull requests to the main branch, on Node 24, with one step per check and <base> as the branch the pull request goes to', () => {
  const seed = seedOf('trunk', CHECKS);
  assert.match(seed, /^on:\n  pull_request:\n    branches: \["trunk"\]$/m);
  assert.match(seed, /node-version: 24$/m);
  assert.equal(seed.match(/^ {8}run: \|$/gm)?.length, CHECKS.length);
  assert.deepEqual(runLinesOf(seed), ['claude plugin validate . --strict', 'git diff --check origin/${{ github.base_ref }}...HEAD', 'node --test "dynamo/tests/*.test.ts"']);
  assert.equal(seed.includes('<base>'), false);
  assert.match(seed, /fetch-depth: 0/);
});

test('the checks the seed runs are the checks it was made from, for any shape of <base>', () => {
  for (const cs of [CHECKS, ['git diff <base> --stat'], ['git diff <base>'], ['echo a && echo b']]) assert.deepEqual(missingChecks(cs, runLinesOf(seedOf('main', cs))), [], cs.join());
});

test('runLinesOf reads one-line values, quoted values, literal and folded blocks with or without an indicator, and skips comments', () => {
  const yaml = [
    'jobs:', '  a:', '    steps:',
    '      - run: node a.js # why', '      - run: "node b.js"', "      - run: 'node c.js'",
    '      - name: x', '        run: |', '          # node d.js', '          node e.js', '', '          node f.js',
    '      - run: |2-', '            node g.js', '      - run: >-', '          node h.js', '          --flag', '      - uses: z',
  ].join('\n');
  assert.deepEqual(runLinesOf(yaml), ['node a.js', 'node b.js', 'node c.js', 'node e.js', 'node f.js', 'node g.js', 'node h.js --flag']);
  assert.deepEqual(runLinesOf('run:\r\n'), []);
});

test('missingChecks finds a check by its whole words, in any line, with any spacing', () => {
  assert.deepEqual(missingChecks(['node --run build'], ['npm ci && node --run build', 'echo done']), []);
  assert.deepEqual(missingChecks(['node  --run build'], ['node --run   build']), []);
  assert.deepEqual(missingChecks(['node --run build', 'npm test'], ['node --run build:prod', 'npm test:ci']), ['node --run build', 'npm test']);
  assert.deepEqual(missingChecks(['node --run build'], ['xnode --run build', 'node --run builds']), ['node --run build']);
  assert.deepEqual(missingChecks(['a', 'b', 'c'], ['b']), ['a', 'c']);
  assert.deepEqual(missingChecks(['a'], []), ['a']);
});

test('<base> in a check matches any single word, also the expression a CI spells it with, wherever it sits', () => {
  const expr = 'origin/${{ github.base_ref }}';
  assert.deepEqual(missingChecks(['git diff --check <base>'], [`git diff --check ${expr}`, 'x']), []);
  assert.deepEqual(missingChecks(['git diff --check <base>...HEAD'], [`git diff --check ${expr}...HEAD`]), []);
  assert.deepEqual(missingChecks(['git diff <base> --stat'], [`git diff ${expr} --stat`]), []);
  assert.deepEqual(missingChecks(['git diff --check <base>'], ['git diff --check origin/main']), []);
  assert.deepEqual(missingChecks(['git diff <base> --stat'], ['git diff origin/main']), ['git diff <base> --stat']);
});

test('a comment of a run block does not run a check', () => {
  const yaml = 'steps:\n  - run: |\n      # node pass.js\n      echo done\n';
  assert.deepEqual(missingChecks(['node pass.js'], runLinesOf(yaml)), ['node pass.js']);
});

test('run again, the seed is the project\'s: it is not written again', async () => {
  const dir = project();
  await setup(['--check', 'node pass.js'], gitWith(dir));
  writeFileSync(ciPath(dir), readFileSync(ciPath(dir), 'utf8') + '# mine\n');
  const text = readFileSync(ciPath(dir), 'utf8');
  const out = await setup([], gitWith(dir));
  assert.equal(readFileSync(ciPath(dir), 'utf8'), text);
  assert.deepEqual(out.ciMissing, []);
});

test('with a CI, nothing is changed, a check no run line has is reported, and the setup goes on', async () => {
  const dir = project();
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
  const mine = join(dir, '.github', 'workflows', 'mine.yaml');
  const text = 'name: mine\non: push\njobs:\n  a:\n    steps:\n      - run: node pass.js\n      - run: |\n          # node where.js\n          echo hi\n';
  writeFileSync(mine, text);
  const out = await setup(['--check', 'node pass.js', '--check', 'node where.js'], gitWith(dir));
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual(out.ciMissing, ['node where.js']);
  assert.match(String(out.ci), /not changed/);
  assert.equal(readFileSync(mine, 'utf8'), text);
  assert.deepEqual(readdirSync(join(dir, '.github', 'workflows')), ['mine.yaml']);
  assert.equal(existsSync(factoryOf(dir)), true, 'it went on');
});

// --- The commit on the working branch

const tracked = (dir: string, ref: string) => run(dir, 'ls-tree', '-r', '--name-only', ref).split('\n');
const branches = (dir: string) => run(dir, 'branch', '--list', '--format=%(refname:short)').split('\n').filter((b) => b !== '').sort();
const cleanProject = (): string => { const dir = project(); rmSync(join(dir, 'loose.txt')); return dir; };

test('an existing release branch above the last tag gets the commit, and no other branch is made', async () => {
  const dir = project();
  run(dir, 'tag', 'v0.4.0');
  run(dir, 'branch', 'release/0.5.0');
  const out = await setup(['--check', 'node pass.js'], gitWith(dir));
  assert.equal(out.release, 'release/0.5.0');
  assert.equal(out.releaseCreated, false);
  assert.deepEqual(branches(dir), ['main', 'release/0.5.0']);
  assert.equal(run(dir, 'branch', '--show-current'), 'release/0.5.0');
  assert.equal(tracked(dir, 'release/0.5.0').includes('.claude/factory.json'), true);
});

test('run again, it makes no empty commit; what it did not write itself is not committed', async () => {
  const dir = cleanProject();
  await setup(['--check', 'node pass.js'], gitWith(dir));
  const head = run(dir, 'rev-parse', 'HEAD');
  const again = await setup([], gitWith(dir));
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(again.commit, null);
  assert.equal(again.releaseCreated, false);
  assert.equal(run(dir, 'rev-parse', 'HEAD'), head);
  writeFileSync(ciPath(dir), readFileSync(ciPath(dir), 'utf8') + '# mine\n');
  const edited = await setup([], gitWith(dir));
  assert.equal(edited.commit, null);
  assert.equal(run(dir, 'rev-parse', 'HEAD'), head);
  assert.equal(run(dir, 'status', '--porcelain'), 'M .github/workflows/ci.yml');
});

test('with nothing to commit, a setup that started off the working branch leaves the folder on it, made now or already there', async () => {
  const made = cleanProject();
  await setup(['--check', 'node pass.js'], gitWith(made));
  run(made, 'switch', '-q', 'main');
  run(made, 'merge', '-q', '--ff-only', 'release/0.1.0');
  run(made, 'branch', '-D', 'release/0.1.0');
  const again = await setup([], gitWith(made));
  assert.equal(again.commit, null);
  assert.equal(again.releaseCreated, true);
  assert.equal(run(made, 'branch', '--show-current'), 'release/0.1.0');
  const fresh = cleanProject();
  await setup(['--check', 'node pass.js'], gitWith(fresh));
  run(fresh, 'switch', '-q', '-c', 'other');
  const ours = run(fresh, 'rev-parse', 'release/0.1.0');
  const back = await setup([], gitWith(fresh));
  assert.equal(back.commit, null);
  assert.equal(back.releaseCreated, false);
  assert.equal(run(fresh, 'branch', '--show-current'), 'release/0.1.0');
  assert.equal(run(fresh, 'rev-parse', 'HEAD'), ours);
});

// --- The two runs every setup scenario shares: one that passes and one that fails, each run once.

type Out = Awaited<ReturnType<typeof setup>>;
const worktreesOf = (dir: string): number => run(dir, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).length;
const checkedOut = (dir: string): Factory => JSON.parse(run(dir, 'show', 'HEAD:.claude/factory.json')) as Factory;

// A passing setup of a project that has everything: a lock file, a .gitignore, a tag, a public repository and a remote
// whose origin/HEAD is not the branch checked out; it ends clean, and is given a language.
describe('a setup that passes', () => {
  const MADE = ['.claude/factory.json', '.claude/settings.json', '.gitignore', '.github/dependabot.yml', '.github/workflows/ci.yml'];
  const CHECKS = ['node pass.js', 'node where.js', 'git diff --check <base>'];
  let dir: string;
  let remote: string;
  let state: string;
  let out: Out;
  // The folders are made here, not in before(): scratch() removes them after the hook that made them, and a hook is one.
  dir = cleanProject();
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
  run(dir, 'add', '.gitignore');
  run(dir, 'commit', '-q', '-m', 'ignore');
  withLock(dir, 'package-lock.json');
  run(dir, 'checkout', '-q', '-b', 'trunk');
  run(dir, 'tag', 'v0.4.0');
  remote = scratch();
  run(remote, 'init', '-q', '--bare', '-b', 'stable');
  run(dir, 'remote', 'add', 'origin', remote);
  run(dir, 'push', '-q', 'origin', 'trunk:stable');
  run(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/stable');
  const remoteHead = run(remote, 'rev-parse', 'stable');
  state = scratch();
  const deps = gitWith(dir, state, PUBLIC, [{ args: ['api'], stdout: '{}' }]);

  before(async () => {
    out = await setup([...CHECKS.flatMap((c) => ['--check', c]), '--language', 'Español'], deps);
  });

  test('it passes, and each check ran in a temporary copy of the committed repository that is gone after', () => {
    assert.equal(out.ok, true, JSON.stringify(out));
    const [, where, diff] = out.checks as { code: number; output: string }[];
    assert.match(where.output, / no loose$/);
    assert.ok(!where.output.includes(dir), where.output);
    assert.equal(diff.code, 0);
    assert.equal(worktreesOf(dir), 1);
    assert.deepEqual(readdirSync(dir).filter((n) => n.startsWith('dynamo-setup')), []);
  });

  test('the repository, the board owner and the main branch (origin/HEAD) come from gh and git, the language from the argument; the rest from the template', () => {
    const template = readTemplate();
    const written = readBack(dir);
    assert.deepEqual(written.project, { ...template.project, repo: 'acme/shop', boardOwner: 'acme', mainBranch: 'stable', checks: CHECKS, documentsLanguage: 'Español' });
    assert.equal(written.version, template.version);
    assert.equal(checkedOut(dir).project.documentsLanguage, 'Español');
  });

  test('the board is a copy of the template named as the repository, linked, and its ids are read back into factory.json', () => {
    const calls = callsOf(state);
    assert.ok(calls.includes(COPY), calls.join('\n'));
    assert.ok(calls.includes(LINK), calls.join('\n'));
    assert.ok(calls.indexOf(COPY) < calls.indexOf(LINK));
    assert.equal(calls.some((c) => c.includes('@me')), false);
    assert.equal(out.board, 7);
    assert.equal(out.boardCopied, true);
    assert.deepEqual(readBack(dir).board, boardOf(7, view, fieldList()));
    assert.ok(calls.includes('project view 7 --owner acme --format json'));
    assert.ok(calls.includes('project field-list 7 --owner acme --format json'));
  });

  test('only the label the repository lacks is created', () => {
    assert.deepEqual(out.labelsCreated, ['in-release']);
    assert.deepEqual(callsOf(state).filter((c) => c.startsWith('label create')), ['label create in-release -R acme/shop']);
  });

  test('a lock file of npm gets a grouped Dependabot file, and a public repository gets the call to code scanning', () => {
    assert.equal(readFileSync(dependabotPath(dir), 'utf8'), dependabotFile());
    assert.match(String(out.dependabot), /npm/);
    const [call, ...rest] = scanning(state);
    assert.equal(rest.length, 0);
    assert.ok(call.args.includes('PATCH') && call.args.includes('repos/acme/shop/code-scanning/default-setup') && call.args.includes('state=configured'), call.args.join(' '));
    assert.match(String(out.codeScanning), /configured|on/);
  });

  test('the settings hold the rules filled with the repository and the board, one rule per check, attribution, worktree and the plugin', () => {
    const s = settingsOf(dir);
    assert.deepEqual(s.worktree, { baseRef: 'head' });
    assert.deepEqual(s.attribution, { commit: '', pr: '' });
    assert.deepEqual(s.enabledPlugins, { 'dynamo@dynamo': true });
    const allow: string[] = s.permissions.allow;
    assert.ok(allow.includes('Bash(node pass.js)') && allow.includes('Bash(git diff --check *)'));
    assert.ok(allow.includes('Bash(gh project item-list 7 --owner acme *)'));
    assert.ok(allow.includes('Bash(gh api repos/acme/shop/issues/*)'));
    assert.ok(allow.includes('Bash(gh project item-edit --id * --project-id PVT_new --field-id PVTSSF_new --single-select-option-id *)'));
    assert.ok(s.permissions.deny.includes('Bash(git checkout stable*)'));
    assert.deepEqual(strings(s).filter((x) => /<(repo|boardOwner|boardNumber|boardId|statusFieldId|mainBranch)>/.test(x)), []);
    assert.equal(out.settings, join(dir, '.claude', 'settings.json'));
    assert.deepEqual(out.settingsKept, []);
  });

  test('the worktrees folder is added to the .gitignore after what the file had', () => {
    assert.match(String(out.gitignore), /added/);
    assert.equal(ignoreOf(dir), 'node_modules/\n.claude/worktrees/\n');
  });

  test('with no CI, the seed is written for the main branch and the checks, and the output says so', () => {
    assert.equal(readFileSync(ciPath(dir), 'utf8'), seedOf('stable', CHECKS));
    assert.match(String(out.ci), /ci\.yml/);
    assert.deepEqual(out.ciMissing, []);
  });

  test('everything the setup wrote is one commit on the next release branch after the tag, and the working branch has none of it', () => {
    assert.equal(out.release, 'release/0.5.0');
    assert.equal(out.releaseCreated, true);
    assert.deepEqual(branches(dir), ['main', 'release/0.5.0', 'trunk']);
    assert.equal(run(dir, 'branch', '--show-current'), 'release/0.5.0');
    assert.deepEqual(run(dir, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort(), [...MADE].sort());
    assert.equal(out.commit, run(dir, 'rev-parse', '--short', 'HEAD'));
    assert.equal(run(dir, 'rev-list', '--count', 'trunk..release/0.5.0'), '1');
    // The .gitignore was already committed there; the setup changed it.
    for (const file of MADE.filter((f) => f !== '.gitignore')) assert.equal(tracked(dir, 'trunk').includes(file), false, file);
    assert.equal(run(dir, 'status', '--porcelain', '--', ...MADE), '');
  });

  test('nothing is pushed, the push is printed for the human, and the folder ends clean', () => {
    assert.equal(out.push, 'git push -u origin release/0.5.0');
    assert.equal(run(remote, 'branch', '--list', '--format=%(refname:short)'), 'stable');
    assert.equal(run(remote, 'rev-parse', 'stable'), remoteHead);
    assert.equal(out.clean, true);
    assert.equal(run(dir, 'status', '--porcelain'), '');
  });
});

// A passing setup of the plainest project: no tag, no remote, no .gitignore, no lock file, a private repository that has
// none of the labels, no language, and a file of the human that is not committed.
describe('a setup that passes in a plain project', () => {
  const dir = project();
  const state = scratch();
  const deps = gitWith(dir, state, PRIVATE, [{ args: ['api'], stdout: '{}' }, ...answering('copy', {}, [])]);
  let out: Out;

  before(async () => {
    out = await setup(['--check', 'node pass.js'], deps);
  });

  test('it makes the first release branch and stays on it, writes English, and creates the three labels', () => {
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(out.release, 'release/0.1.0');
    assert.equal(out.releaseCreated, true);
    assert.deepEqual(branches(dir), ['main', 'release/0.1.0']);
    assert.equal(run(dir, 'branch', '--show-current'), 'release/0.1.0');
    assert.equal(readBack(dir).project.documentsLanguage, 'English');
    assert.equal(checkedOut(dir).project.documentsLanguage, 'English');
    assert.deepEqual(out.labelsCreated, ['in-release', 'epic', 'idea']);
  });

  test('with no lock file there is no Dependabot file, and a private repository gets no call to code scanning', () => {
    assert.match(String(out.dependabot), /package-lock\.json/);
    assert.equal(existsSync(dependabotPath(dir)), false);
    assert.deepEqual(scanning(state), []);
    assert.match(String(out.codeScanning), /private/);
  });

  test('a .gitignore is made, and a file of the human that the setup did not write is left as it was', () => {
    assert.equal(ignoreOf(dir), '.claude/worktrees/\n');
    assert.equal(out.clean, false);
    assert.equal(run(dir, 'status', '--porcelain'), '?? loose.txt');
  });
});

// A failing setup: the second check fails and the third gives 127, in a project that has a lock file and a public repository.
describe('a setup whose check fails', () => {
  const dir = project();
  withLock(dir, 'package-lock.json');
  const state = scratch();
  const deps = gitWith(dir, state, PUBLIC, [{ args: ['api'], stdout: '{}' }]);
  let out: Out;

  before(async () => {
    out = await setup(['--check', 'node pass.js', '--check', 'node fail.js', '--check', 'no-such-program-here run build'], deps);
  });

  test('the output says which check failed and what it printed, and suggests node --run <script> for a 127', () => {
    assert.equal(out.ok, false);
    assert.match(String(out.error), /node fail\.js.*failed \(3\).*nothing was written/);
    const checks = out.checks as { code: number; output: string; hint?: string }[];
    assert.deepEqual(checks.map((c) => c.code), [0, 3, 127]);
    assert.equal(checks[1].output, 'what failed');
    assert.match(String(checks[2].hint), /node --run <script>/);
  });

  test('nothing is written: no factory.json, settings, .gitignore, Dependabot file or CI', () => {
    assert.equal(existsSync(factoryOf(dir)), false);
    assert.equal(existsSync(join(dir, '.claude')), false);
    assert.equal(existsSync(join(dir, '.gitignore')), false);
    assert.equal(existsSync(join(dir, '.github')), false);
  });

  test('no board is copied, no label is created and no code scanning is called', () => {
    assert.deepEqual(callsOf(state).filter((c) => c.startsWith('project') || c.startsWith('label')), []);
    assert.deepEqual(scanning(state), []);
  });

  test('no branch and no commit are made, and the temporary copy is gone', () => {
    assert.deepEqual(branches(dir), ['main']);
    assert.equal(run(dir, 'rev-list', '--count', 'HEAD'), '2');
    assert.equal(worktreesOf(dir), 1);
  });
});
