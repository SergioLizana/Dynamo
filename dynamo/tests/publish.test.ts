// `dynamo publish <tag> <clone>` on temporary repositories: a development repository with tags, and a public clone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Deps } from '../cli.ts';
import { exit } from '../cli.ts';
import type { Result } from '../exec.ts';
import { execAsync } from '../exec.ts';
import { git } from '../git.ts';
import { publish } from '../publish.ts';
import { mergedProblems, preparedProblems } from '../publishing.ts';
import { scanText } from '../reviewing.ts';
import { scratch } from './helpers.ts';

const NOREPLY = 'Sergio Lizana <28341710+SergioLizana@users.noreply.github.com>';

// Personal data, built piece by piece so that this file holds none of it as one string: the review of the published tree
// (tree-review.test.ts) reads this file too, and nothing is exempted from it.
const DEVELOPMENT_REPO = ['dynamo', 'develop'].join('-');
// What `project.repo` holds: the review gets the name of the private repository as data.
const PRIVATE_REPO = `SergioLizana/${DEVELOPMENT_REPO}`;
const MARY_EMAIL = ['mary', 'private.example'].join('@');
const BOB = ['bob', 'home.example'].join('@');
const HOME = ['', 'home'].join('/');
const USERS = ['', 'Users'].join('/');
const WIN = (drive: string, users = 'Users') => `${drive}:\\${users}\\bob\\project`;

const factory = () => ({ version: 1, project: { mainBranch: 'main', repo: PRIVATE_REPO } });

// Git with a personal identity in its environment, as the human's machine has.
const PERSONAL = { GIT_AUTHOR_NAME: 'Mary Private', GIT_AUTHOR_EMAIL: MARY_EMAIL, GIT_COMMITTER_NAME: 'Mary Private', GIT_COMMITTER_EMAIL: MARY_EMAIL };
function g(cwd: string, ...args: string[]): string {
  const r = git(args, { cwd, env: { ...process.env, ...PERSONAL } });
  assert.equal(r.code, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function put(root: string, files: Record<string, string>): void {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), text);
  }
}

const PLUGIN = (v: string) => `{\n  "name": "dynamo",\n  "version": "${v}",\n  "author": { "name": "Sergio Lizana" }\n}\n`;

// A development repository: v0.1.0 and v0.2.0 (which drops `skills/old/SKILL.md`), with files that are not published.
function develop(): string {
  const dir = scratch();
  g(dir, 'init', '-q', '-b', 'dev');
  put(dir, {
    '.claude-plugin/plugin.json': PLUGIN('0.0.1'), 'skills/old/SKILL.md': 'old', 'skills/new/SKILL.md': 'one', 'dynamo/dynamo.ts': 'x',
    'README.md': 'readme', 'LICENSE': 'mit', '.gitattributes': '* text=auto eol=lf', '.github/workflows/ci.yml': 'private ci', 'public/ci.yml': 'public ci', 'public/dependabot.yml': 'public dependabot', 'public/pages.yml': 'public pages', 'site/index.html': 'site', 'site/README.md': 'site readme', 'guides/g.md': 'g',
    'documentation/plan.md': 'private', '.claude/CLAUDE.md': 'private', '.claude/factory.json': '{}', 'mods/m.ts': 'mod', 'notes.txt': 'n',
  });
  g(dir, 'add', '-A');
  g(dir, 'commit', '-q', '-m', 'one');
  g(dir, 'tag', 'v0.1.0');
  g(dir, 'rm', '-q', 'skills/old/SKILL.md');
  put(dir, { 'skills/new/SKILL.md': 'two' });
  g(dir, 'add', '-A');
  g(dir, 'commit', '-q', '-m', 'two');
  g(dir, 'tag', 'v0.2.0');
  return dir;
}

// A public clone with one earlier release in it: its history is `main` with that commit.
function publicClone(): string {
  const dir = scratch();
  g(dir, 'init', '-q', '-b', 'main');
  put(dir, { 'skills/old/SKILL.md': 'old', 'leftover.txt': 'was published once', '.claude-plugin/plugin.json': PLUGIN('0.1.0') });
  g(dir, 'add', '-A');
  g(dir, 'commit', '-q', '-m', 'Dynamo 0.1.0');
  return dir;
}

// A public clone with an origin that has its `main`.
function cloneWithOrigin(): { clone: string; origin: string } {
  const clone = publicClone();
  const origin = scratch();
  g(origin, 'init', '-q', '--bare', '-b', 'main');
  g(clone, 'remote', 'add', 'origin', origin);
  g(clone, 'push', '-q', 'origin', 'main');
  return { clone, origin };
}

// A gitleaks that finds nothing: the tests of the other rules do not depend on it being installed.
const CLEAN = async (): Promise<Result> => ({ code: 0, stdout: '[]', stderr: '' });

// Runs `publish` as if the process were in the development repository: the git it is given works there. `exec` stands for
// gitleaks.
function run(dev: string, args: string[], exec: Deps['exec'] = CLEAN) {
  const deps = { git: (a, o = {}) => git(a, { cwd: dev, ...o }), exec, factory } as unknown as Deps;
  return exit(() => publish(args, deps));
}

test('the clone is a required second argument: with one argument or three it is called wrong and nothing is made', async () => {
  const dev = develop();
  for (const args of [[], ['v0.2.0'], ['v0.2.0', 'a', 'b']]) {
    const r = await run(dev, args);
    assert.equal(r.code, 2, args.join(' '));
    assert.match(String(r.out.error), /usage: publish <tag> <clone>/);
  }
});

// The passing publish, made once and read by every test about what it leaves. The machine has a personal identity in its
// environment and the clone in its config (with signing on), so the same run proves the noreply identity beats both.
// Its folders are made here, not inside a test: a scratch folder made in a test is removed when that test ends.
type Passing = { dev: string; clone: string; tip: string; r: Awaited<ReturnType<typeof run>> };
const PASSING = { dev: develop(), clone: publicClone() };
g(PASSING.clone, 'config', 'user.name', 'Mary Private');
g(PASSING.clone, 'config', 'user.email', MARY_EMAIL);
g(PASSING.clone, 'config', 'commit.gpgsign', 'true');
let passing: Promise<Passing> | undefined;
function passingRun(): Promise<Passing> {
  passing ??= (async () => {
    const { dev, clone } = PASSING;
    const tip = g(clone, 'rev-parse', 'main');
    Object.assign(process.env, PERSONAL);
    try {
      return { dev, clone, tip, r: await run(dev, ['v0.2.0', clone]) };
    } finally {
      for (const k of Object.keys(PERSONAL)) delete process.env[k];
    }
  })();
  return passing;
}

test('only the allowlisted files of the tag are in the commit', async () => {
  const { clone, r } = await passingRun();
  assert.equal(r.code, 0, JSON.stringify(r.out));
  const tracked = g(clone, 'ls-tree', '-r', '--name-only', 'HEAD').split('\n');
  assert.deepEqual(tracked, ['.claude-plugin/plugin.json', '.gitattributes', '.github/dependabot.yml', '.github/workflows/ci.yml', '.github/workflows/pages.yml', 'LICENSE', 'README.md', 'dynamo/dynamo.ts', 'guides/g.md', 'site/README.md', 'site/index.html', 'skills/new/SKILL.md']);
  assert.equal(readFileSync(join(clone, 'skills/new/SKILL.md'), 'utf8'), 'two');
});

test('.gitattributes is published, so the line endings of the clone are the ones the files were made with', async () => {
  const { clone } = await passingRun();
  assert.equal(readFileSync(join(clone, '.gitattributes'), 'utf8'), '* text=auto eol=lf');
  assert.match(g(clone, 'ls-tree', '-r', '--name-only', 'HEAD'), /^\.gitattributes$/m);
});

test('a file the tag no longer has is gone from the commit and from the folder', async () => {
  const { clone } = await passingRun();
  assert.equal(existsSync(join(clone, 'skills/old/SKILL.md')), false);
  assert.equal(existsSync(join(clone, 'leftover.txt')), false);
  assert.doesNotMatch(g(clone, 'ls-tree', '-r', '--name-only', 'HEAD'), /old|leftover/);
});

test('the commit is on publish/x.y.z with one parent, the tip of the public main', async () => {
  const { clone, tip, r } = await passingRun();
  assert.equal(g(clone, 'branch', '--show-current'), 'publish/0.2.0');
  assert.equal(g(clone, 'rev-list', '--parents', '-n1', 'HEAD'), `${g(clone, 'rev-parse', 'HEAD')} ${tip}`);
  assert.equal(g(clone, 'rev-parse', 'main'), tip, 'main is not moved');
  assert.equal(g(clone, 'rev-list', '--count', 'HEAD'), '2');
  assert.equal(r.out.commit, g(clone, 'rev-parse', '--short', 'HEAD'));
  assert.equal(g(clone, 'status', '--porcelain'), '');
});

test('author and committer are the noreply identity, whatever the local git config and environment say', async () => {
  const { clone, r } = await passingRun();
  assert.equal(r.code, 0, JSON.stringify(r.out));
  assert.equal(g(clone, 'log', '-1', '--format=%an <%ae>'), NOREPLY);
  assert.equal(g(clone, 'log', '-1', '--format=%cn <%ce>'), NOREPLY);
});

test('plugin.json of the public copy carries the version of the tag, and keeps its format', async () => {
  const { dev, clone } = await passingRun();
  assert.equal(readFileSync(join(clone, '.claude-plugin/plugin.json'), 'utf8'), PLUGIN('0.2.0'));
  assert.equal(g(dev, 'show', 'v0.2.0:.claude-plugin/plugin.json'), PLUGIN('0.0.1').trim(), 'the tag itself is not changed');
});

test('in an empty public clone the commit has no parent, goes on main and the push printed is the first release one', async () => {
  const dev = develop();
  const clone = scratch();
  g(clone, 'init', '-q', '-b', 'trunk');
  const r = await run(dev, ['v0.2.0', clone]);
  assert.equal(r.code, 0, JSON.stringify(r.out));
  assert.equal(g(clone, 'branch', '--show-current'), 'main');
  assert.equal(g(clone, 'rev-list', '--parents', '-n1', 'HEAD'), g(clone, 'rev-parse', 'HEAD'));
  assert.equal(g(clone, 'log', '-1', '--format=%an <%ae> %cn <%ce>'), `${NOREPLY} ${NOREPLY}`);
  assert.match(String(r.out.push), /push -u origin main$/);
  assert.equal(r.out.pr, null);
  assert.equal(r.out.first, true);
});

test('it prints the push and the gh pr create commands and pushes nothing', async () => {
  const dev = develop();
  const { clone, origin } = cloneWithOrigin();
  const before = g(origin, 'for-each-ref');
  const r = await run(dev, ['v0.2.0', clone]);
  assert.equal(r.code, 0, JSON.stringify(r.out));
  assert.match(String(r.out.push), /^git -C ".+" push -u origin publish\/0\.2\.0$/);
  assert.match(String(r.out.pr), /gh pr create --base main --head publish\/0\.2\.0/);
  assert.equal(g(origin, 'for-each-ref'), before, 'origin is the same');
});

test('the parent is the tip of origin/main after a fetch, when the clone has an origin', async () => {
  const dev = develop();
  const { clone, origin } = cloneWithOrigin();
  const other = scratch();
  g(other, 'clone', '-q', origin, 'w');
  put(join(other, 'w'), { 'x.txt': 'x' });
  g(join(other, 'w'), 'add', '-A');
  g(join(other, 'w'), 'commit', '-q', '-m', 'ahead');
  g(join(other, 'w'), 'push', '-q', 'origin', 'main');
  const r = await run(dev, ['v0.2.0', clone]);
  assert.equal(r.code, 0, JSON.stringify(r.out));
  assert.equal(g(clone, 'rev-parse', 'HEAD^'), g(origin, 'rev-parse', 'main'));
});

test('with an unknown tag it commits nothing and leaves the clone as it was', async () => {
  const dev = develop();
  const clone = publicClone();
  const before = { head: g(clone, 'rev-parse', 'HEAD'), branches: g(clone, 'branch', '--list') };
  const r = await run(dev, ['v9.9.9', clone]);
  assert.equal(r.code, 1);
  assert.match(String(r.out.error), /v9\.9\.9/);
  assert.deepEqual({ head: g(clone, 'rev-parse', 'HEAD'), branches: g(clone, 'branch', '--list') }, before);
  assert.equal(g(clone, 'status', '--porcelain'), '');
});

test('it refuses a clone that is the development repository itself, one with changes, and an existing publish branch', async () => {
  const dev = develop();
  assert.match(String((await run(dev, ['v0.2.0', dev])).out.error), /development repository/);
  assert.equal(g(dev, 'branch', '--list', 'publish/*'), '');

  const dirty = publicClone();
  put(dirty, { 'stray.txt': 'mine' });
  assert.match(String((await run(dev, ['v0.2.0', dirty])).out.error), /changes/);

  const taken = publicClone();
  g(taken, 'branch', 'publish/0.2.0');
  assert.match(String((await run(dev, ['v0.2.0', taken])).out.error), /publish\/0\.2\.0 already exists/);
});

// A post-commit hook that rewrites the commit under another identity, as a hook or a wrapper on a machine could.
function rewriteAfterCommit(clone: string, name: string, email: string, only: 'author' | 'committer' | 'both'): void {
  const hook = join(clone, '.git', 'hooks', 'post-commit');
  const author = only === 'committer' ? '' : `export GIT_AUTHOR_NAME="${name}" GIT_AUTHOR_EMAIL="${email}"\n`;
  const committer = only === 'author' ? '' : `export GIT_COMMITTER_NAME="${name}" GIT_COMMITTER_EMAIL="${email}"\n`;
  const reset = only === 'committer' ? '' : '--reset-author ';
  writeFileSync(hook, `#!/bin/sh\n[ -n "$REWRITTEN" ] && exit 0\nexport REWRITTEN=1\n${author}${committer}git commit --amend --no-edit -q ${reset}\n`);
  chmodSync(hook, 0o755);
}

const NOREPLY_EMAIL = '28341710+SergioLizana@users.noreply.github.com';
const who = (authorName: string, authorEmail: string, committerName: string, committerEmail: string) => ({ authorName, authorEmail, committerName, committerEmail });

test('the identity of the prepared commit: only the noreply identity as author and as committer has no problem', () => {
  const table: [string, ReturnType<typeof who>, string[]][] = [
    ['both noreply', who('Sergio Lizana', NOREPLY_EMAIL, 'Sergio Lizana', NOREPLY_EMAIL), []],
    ['email in another case', who('Sergio Lizana', NOREPLY_EMAIL.toUpperCase(), 'Sergio Lizana', NOREPLY_EMAIL), []],
    ['another author', who('Mary Private', MARY_EMAIL, 'Sergio Lizana', NOREPLY_EMAIL), [`author is Mary Private <${MARY_EMAIL}>`]],
    ['another committer', who('Sergio Lizana', NOREPLY_EMAIL, 'Mary Private', MARY_EMAIL), [`committer is Mary Private <${MARY_EMAIL}>`]],
    ['both another', who('Mary Private', MARY_EMAIL, 'Mary Private', MARY_EMAIL), [`author is Mary Private <${MARY_EMAIL}>`, `committer is Mary Private <${MARY_EMAIL}>`]],
    ['GitHub as committer is not enough here', who('Sergio Lizana', NOREPLY_EMAIL, 'GitHub', 'noreply@github.com'), ['committer is GitHub <noreply@github.com>']],
  ];
  for (const [name, identities, problems] of table) assert.deepEqual(preparedProblems(identities), problems, name);
});

test('another author or committer on the prepared commit is refused, and the clone is left as it was', async () => {
  const dev = develop();
  const clone = publicClone();
  const before = { head: g(clone, 'rev-parse', 'HEAD'), branches: g(clone, 'branch', '--list') };
  rewriteAfterCommit(clone, 'Mary Private', MARY_EMAIL, 'both');
  const r = await run(dev, ['v0.2.0', clone]);
  assert.equal(r.code, 1);
  assert.match(String(r.out.error), /identity/);
  assert.equal(r.out.push, undefined);
  assert.deepEqual({ head: g(clone, 'rev-parse', 'HEAD'), branches: g(clone, 'branch', '--list') }, before);
});

// A public clone whose origin holds `main` with the release merged on it, as GitHub leaves it: `who` is the commit's
// author and committer, `version` the one `plugin.json` carries.
function mergedClone(author: string, committer: string, version = '0.2.0'): string {
  const { clone } = cloneWithOrigin();
  put(clone, { '.claude-plugin/plugin.json': PLUGIN(version), 'merged.txt': 'the release' });
  g(clone, 'add', '-A');
  const [an, ae] = author.split('|');
  const [cn, ce] = committer.split('|');
  const env = { ...process.env, GIT_AUTHOR_NAME: an, GIT_AUTHOR_EMAIL: ae, GIT_COMMITTER_NAME: cn, GIT_COMMITTER_EMAIL: ce };
  const made = git(['commit', '-q', '-m', 'Dynamo 0.2.0 (#1)'], { cwd: clone, env });
  assert.equal(made.code, 0, made.stderr);
  g(clone, 'push', '-q', 'origin', 'main');
  return clone;
}
const ME = 'Sergio Lizana|28341710+SergioLizana@users.noreply.github.com';
const GITHUB = 'GitHub|noreply@github.com';

// The merged commit that passes, made once: the tag and Release commands are read from it.
const MERGED = { dev: develop(), clone: mergedClone(ME, GITHUB) };
let mergedPassing: Promise<{ clone: string; r: Awaited<ReturnType<typeof run>> }> | undefined;
function mergedPassingRun() {
  mergedPassing ??= (async () => {
    return { clone: MERGED.clone, r: await run(MERGED.dev, ['v0.2.0', MERGED.clone, '--merged']) };
  })();
  return mergedPassing;
}

// `Name|email` as the helper above takes it, as the identities a commit reads back.
const pair = (who: string) => who.split('|');
const identitiesOfPair = (author: string, committer: string) => who(pair(author)[0], pair(author)[1], pair(committer)[0], pair(committer)[1]);
const OTHER = `Mary Private|${MARY_EMAIL}`;
const MARY_ON_NOREPLY = `Mary Private|${NOREPLY_EMAIL}`;
const MARY_ON_GITHUB = 'Mary Private|noreply@github.com';
const GITHUB_ELSEWHERE = `GitHub|${['someone', 'github.com'].join('@')}`;

test('the identity of the commit the merge left: the noreply author with the noreply or the GitHub committer is the only pass', () => {
  for (const committer of [ME, GITHUB]) assert.deepEqual(mergedProblems(identitiesOfPair(ME, committer)), [], committer);
  assert.deepEqual(mergedProblems(identitiesOfPair(ME, 'github|NOREPLY@GITHUB.COM')), [`committer is github <NOREPLY@GITHUB.COM>`]);
  for (const [author, committer] of [
    [OTHER, ME], [ME, OTHER], [OTHER, OTHER], [ME, GITHUB_ELSEWHERE], [MARY_ON_NOREPLY, ME], [ME, MARY_ON_NOREPLY], [ME, MARY_ON_GITHUB],
  ]) {
    assert.notDeepEqual(mergedProblems(identitiesOfPair(author, committer)), [], `${author} / ${committer}`);
  }
  assert.equal(mergedProblems(identitiesOfPair(OTHER, OTHER)).length, 2);
});

test('the commit the merge left on main is checked: the noreply identity passes, and only then are the tag and Release commands printed', async () => {
  const { clone, r } = await mergedPassingRun();
  assert.equal(r.code, 0, JSON.stringify(r.out));
  const tip = g(clone, 'rev-parse', 'origin/main');
  assert.equal(r.out.commit, g(clone, 'rev-parse', '--short', tip));
  assert.match(String(r.out.release), new RegExp(`gh release create v0\\.2\\.0 .*--target ${tip}`));
  // The check only reads: asked again, it changes nothing in the clone and gives the same answer.
  const before = stateOf(clone);
  assert.deepEqual((await run(MERGED.dev, ['v0.2.0', clone, '--merged'])).out, r.out);
  assert.equal(stateOf(clone), before);
});

test('another author or committer on the commit the merge left fails, and no command is printed', async () => {
  const r = await run(develop(), ['v0.2.0', mergedClone(OTHER, ME), '--merged']);
  assert.equal(r.code, 1);
  assert.match(String(r.out.error), /identity/);
  assert.equal(r.out.release, undefined);
  assert.doesNotMatch(JSON.stringify(r.out), /gh release/);
});

test('the commands of the tag carry no personal email and make no local tag', async () => {
  const { r } = await mergedPassingRun();
  assert.equal(r.code, 0, JSON.stringify(r.out));
  const printed = JSON.stringify(r.out);
  assert.doesNotMatch(printed, /mary@private|@(?!github\.com)/);
  assert.doesNotMatch(String(r.out.release), /git tag|-a /, 'GitHub makes the tag, so no tagger email exists');
});

test('a main that is not the release is refused, and so is a clone that is the development repository', async () => {
  const dev = develop();
  const behind = mergedClone(ME, GITHUB, '0.1.0');
  const r = await run(dev, ['v0.2.0', behind, '--merged']);
  assert.equal(r.code, 1);
  assert.match(String(r.out.error), /0\.1\.0/);
  assert.match(String((await run(dev, ['v0.2.0', dev, '--merged'])).out.error), /development repository/);
});

test('a folder that is not a git repository is refused', async () => {
  const dev = develop();
  const r = await run(dev, ['v0.2.0', scratch()]);
  assert.equal(r.code, 1);
  assert.match(String(r.out.error), /not a git repository/);
});

test('the public ci.yml and dependabot.yml of the tag are placed where GitHub reads them, and the development ci.yml is not', async () => {
  const { clone, r } = await passingRun();
  assert.equal(r.code, 0, JSON.stringify(r.out));
  assert.equal(readFileSync(join(clone, '.github/workflows/ci.yml'), 'utf8'), 'public ci');
  assert.equal(readFileSync(join(clone, '.github/dependabot.yml'), 'utf8'), 'public dependabot');
  assert.equal(r.out.files, 12);
});

test('a tag without the public ci.yml or dependabot.yml is refused and nothing is committed', async () => {
  for (const missing of ['public/ci.yml', 'public/dependabot.yml', 'public/pages.yml']) {
    const dev = develop();
    g(dev, 'rm', '-q', missing);
    g(dev, 'commit', '-q', '-m', 'drop');
    g(dev, 'tag', 'v0.3.0');
    const clone = publicClone();
    const before = g(clone, 'rev-parse', 'HEAD');
    const r = await run(dev, ['v0.3.0', clone]);
    assert.equal(r.code, 1, missing);
    assert.match(String(r.out.error), new RegExp(missing.replace('.', '\\.')));
    assert.equal(g(clone, 'rev-parse', 'HEAD'), before);
    assert.equal(g(clone, 'branch', '--list'), '* main');
  }
});

// ---- The review of the snapshot ----

// The development repository with `files` added (or changed) in a new tag v0.3.0.
function tagged(files: Record<string, string>): string {
  const dev = develop();
  put(dev, files);
  g(dev, 'add', '-A');
  g(dev, 'commit', '-q', '-m', 'three');
  g(dev, 'tag', 'v0.3.0');
  return dev;
}

// What the clone holds, to compare before and after: HEAD, branches, status, the remote refs and the files.
function stateOf(clone: string): string {
  const names = git(['ls-files', '-z', '--others', '--cached'], { cwd: clone }).stdout.split('\0').filter((f) => f !== '').sort();
  const files = names.map((f) => `${f}=${existsSync(join(clone, f)) ? readFileSync(join(clone, f), 'utf8') : ''}`);
  return JSON.stringify([g(clone, 'rev-parse', 'HEAD'), g(clone, 'branch', '--list'), g(clone, 'status', '--porcelain'), g(clone, 'for-each-ref'), files]);
}

const REPO = PRIVATE_REPO;

const FOUND: [string, string, string][] = [
  ['an email', `contact: ${BOB}`, 'email'],
  ['an email in upper case', `contact: ${BOB.toUpperCase()}.ORG`, 'email'],
  ['a Windows path', `see ${WIN('C')}`, 'user path'],
  ['a Windows path in lower case', `see ${WIN('c', 'users')}`, 'user path'],
  ['a Windows path with forward slashes', `see D:/${'users'}/bob/project`, 'user path'],
  ['a Windows path escaped in JSON', `"path": "C:\\\\${'Users'}\\\\bob\\\\x"`, 'user path'],
  ['a Git Bash path', `see /c${USERS}/bob/project`, 'user path'],
  ['a WSL path', `see /mnt/c${USERS}/bob/project`, 'user path'],
  ['a macOS path', `cd ${USERS}/bob/project`, 'user path'],
  ['a Linux path', `cd ${HOME}/bob/project`, 'user path'],
  ['a Linux path in quotes', `"${HOME}/bob"`, 'user path'],
  ['a Linux path in a PATH list', `PATH=/usr/bin:${HOME}/bob/bin`, 'user path'],
  ['a WSL path in a PATH list', `PATH=/usr/bin:/mnt/c${USERS}/bob/x`, 'user path'],
  ['a Git Bash path in a PATH list', `PATH=/usr/bin:/c${USERS}/bob/x`, 'user path'],
  ['a macOS path after PATH', `export PATH=$PATH:${USERS}/bob/bin`, 'user path'],
  ['a path after a colon', `x:${USERS}/bob`, 'user path'],
  ['a path in a volume mount', `-v /data:${HOME}/bob`, 'user path'],
  ['a path after a host', `scp host:${HOME}/bob/x .`, 'user path'],
  ['a Linux path in a file URL', `file://${HOME}/bob/x`, 'user path'],
  ['a macOS path in a file URL', `file://${USERS}/bob/x`, 'user path'],
  ['a Git Bash path in a file URL', `file:///c${USERS}/bob/x`, 'user path'],
  ['a WSL path in a file URL', `file:///mnt/c${USERS}/bob/x`, 'user path'],
  ['a link to the private repository', `https://github.com/${PRIVATE_REPO}/issues/1`, 'link to the private repository'],
  ['a mention of the private repository in another case', `see ${DEVELOPMENT_REPO.toUpperCase()}`, 'link to the private repository'],
];

test('the review finds an email, a user path in any form and a link to the private repository, naming file and line', () => {
  for (const [name, line, kind] of FOUND) {
    assert.deepEqual(scanText('guides/g.md', `first\n${line}\nlast`, REPO), [{ file: 'guides/g.md', line: 2, kind }], name);
  }
});

test('the private repository is the one the settings name, in any case', () => {
  assert.deepEqual(scanText('f.md', 'see OWNER/Other.Name', 'owner/other.name'), [{ file: 'f.md', line: 1, kind: 'link to the private repository' }]);
  assert.deepEqual(scanText('f.md', 'see other-name and otherXname', 'owner/other.name'), []);
  assert.deepEqual(scanText('f.md', `see ${DEVELOPMENT_REPO}`, 'owner/other.name'), []);
});

test('the noreply emails, a placeholder in a path and a URL path are not findings', () => {
  const clean = [
    'Sergio Lizana <28341710+SergioLizana@users.noreply.github.com>', 'GitHub <noreply@github.com>',
    'C:\\Users\\<name>\\x', 'C:\\Users\\%USERNAME%\\x', '/home/<user>/x', '/Users/$USER/x', '/home/{name}',
    'https://x.example/home/page', 'https://x.example:8080/home/page', 'http://x/c/Users/p', 'https://x.example/mnt/c/Users/p',
    'PATH=/usr/bin:/home/<name>/bin', 'https://x.example/Users/page', 'https://x.example/c/Users/page', 'src/home/page.ts',
    '@types/node', 'a user@host-less line', 'the users folder', 'dynamo', 'Users and /home are folders',
  ];
  for (const line of clean) assert.deepEqual(scanText('f.md', line, REPO), [], line);
});

test('a snapshot with a finding is refused, naming the file and line, and the clone is left exactly as it was', async () => {
  // One of each kind: the forms of each are proven on the text above.
  for (const [name, line, kind] of [FOUND[0], FOUND[6], FOUND[FOUND.length - 2]]) {
    const dev = tagged({ 'guides/new.md': `first\n${line}\n` });
    const { clone } = cloneWithOrigin();
    const before = stateOf(clone);
    const r = await run(dev, ['v0.3.0', clone]);
    assert.equal(r.code, 1, name);
    assert.match(String(r.out.error), /guides\/new\.md:2 /, name);
    assert.ok(String(r.out.error).includes(kind), name);
    assert.equal(r.out.push, undefined, name);
    assert.equal(stateOf(clone), before, name);
  }
});

test('every finding is listed, in every file', async () => {
  const dev = tagged({ 'guides/a.md': BOB, 'skills/new/SKILL.md': `x\ny\n${HOME}/bob/z` });
  const r = await run(dev, ['v0.3.0', publicClone()]);
  assert.match(String(r.out.error), /2 findings/);
  assert.match(String(r.out.error), /guides\/a\.md:1 email/);
  assert.match(String(r.out.error), /skills\/new\/SKILL\.md:3 user path/);
});

test('the placed public files are reviewed too, and what is not published is not', async () => {
  const outside = tagged({ 'documentation/plan.md': `${BOB} ${HOME}/bob`, 'mods/m.ts': `${WIN('C')}` });
  const ok = await run(outside, ['v0.3.0', publicClone()]);
  assert.equal(ok.code, 0, JSON.stringify(ok.out));
  const placed = tagged({ 'public/ci.yml': `run: ls ${HOME}/bob` });
  const r = await run(placed, ['v0.3.0', publicClone()]);
  assert.equal(r.code, 1);
  assert.match(String(r.out.error), /\.github\/workflows\/ci\.yml:1 user path/);
});

test('a refusal in an empty clone leaves it empty', async () => {
  const dev = tagged({ 'guides/new.md': BOB });
  const clone = scratch();
  g(clone, 'init', '-q', '-b', 'trunk');
  const r = await run(dev, ['v0.3.0', clone]);
  assert.equal(r.code, 1);
  assert.equal(git(['rev-parse', '--verify', '-q', 'HEAD'], { cwd: clone }).code, 1, 'no commit');
  assert.equal(g(clone, 'for-each-ref'), '');
  assert.equal(g(clone, 'status', '--porcelain'), '');
});

test('a refusal fetches nothing: the remote refs of the clone are as they were', async () => {
  const dev = tagged({ 'guides/new.md': BOB });
  const { clone, origin } = cloneWithOrigin();
  const other = scratch();
  g(other, 'clone', '-q', origin, 'w');
  put(join(other, 'w'), { 'x.txt': 'x' });
  g(join(other, 'w'), 'add', '-A');
  g(join(other, 'w'), 'commit', '-q', '-m', 'ahead');
  g(join(other, 'w'), 'push', '-q', 'origin', 'main');
  const before = g(clone, 'for-each-ref');
  assert.equal((await run(dev, ['v0.3.0', clone])).code, 1);
  assert.equal(g(clone, 'for-each-ref'), before);
});

test('a secret found by gitleaks is refused, naming the file and line, and nothing is committed', async () => {
  const dev = develop();
  const clone = publicClone();
  const before = stateOf(clone);
  const calls: string[][] = [];
  const found = async (_command: string[], args: string[]): Promise<Result> => {
    calls.push(args);
    return { code: 2, stdout: JSON.stringify([{ File: join(args[1], 'guides', 'g.md'), StartLine: 7, RuleID: 'github-pat', Secret: 'REDACTED' }]), stderr: '' };
  };
  const r = await run(dev, ['v0.2.0', clone], found);
  assert.equal(r.code, 1);
  assert.match(String(r.out.error), /guides\/g\.md:7 secret \(github-pat\)/);
  assert.equal(r.out.push, undefined);
  assert.equal(stateOf(clone), before);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'dir');
  assert.ok(calls[0].includes('--redact'), 'the secret is not printed');
});

test('with gitleaks missing it publishes nothing and says so', async () => {
  const dev = develop();
  const clone = publicClone();
  const before = stateOf(clone);
  const r = await run(dev, ['v0.2.0', clone], async () => ({ code: 127, stdout: '', stderr: 'gitleaks: spawn gitleaks ENOENT' }));
  assert.equal(r.code, 1);
  assert.match(String(r.out.error), /gitleaks is not installed/);
  assert.match(String(r.out.error), /nothing was committed/);
  assert.equal(stateOf(clone), before);
});

test('a gitleaks that fails for another reason is a refusal, not a clean snapshot', async () => {
  const dev = develop();
  const clone = publicClone();
  const before = stateOf(clone);
  for (const out of [{ code: 1, stdout: '', stderr: 'boom' }, { code: 2, stdout: 'not json', stderr: '' }, { code: 2, stdout: '{}', stderr: '' }]) {
    const r = await run(dev, ['v0.2.0', clone], async () => out);
    assert.equal(r.code, 1, JSON.stringify(out));
    assert.equal(stateOf(clone), before);
  }
});

// The real gitleaks, when it is installed; the tests above prove the rest without it.
const installed = (await execAsync(['gitleaks'], ['version'])).code === 0;

test('the real gitleaks: a token is refused, a clean snapshot passes', { skip: !installed && 'gitleaks is not installed' }, async () => {
  const token = 'ghp_' + 'aB3dE5gH7jK9mN1pQ3sT5vX7zA9cD1fG3hJ5';
  const dev = tagged({ 'guides/new.md': `token: ${token}\n` });
  const clone = publicClone();
  const before = stateOf(clone);
  const r = await run(dev, ['v0.3.0', clone], execAsync);
  assert.equal(r.code, 1, JSON.stringify(r.out));
  assert.match(String(r.out.error), /guides\/new\.md:1 secret/);
  assert.ok(!String(r.out.error).includes(token), 'the secret is not echoed');
  assert.equal(stateOf(clone), before);
  const ok = await run(develop(), ['v0.2.0', publicClone()], execAsync);
  assert.equal(ok.code, 0, JSON.stringify(ok.out));
});
