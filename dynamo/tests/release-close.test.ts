import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UsageError } from '../cli.ts';
import { execAsync } from '../exec.ts';
import { gh } from '../gh.ts';
import { git } from '../git.ts';
import { release } from '../release.ts';
import { releaseClose } from '../release-close.ts';
import { mergedPrOf } from '../releases.ts';
import { milestoneOf } from '../milestones.ts';
import { greater, lastTag, nextVersion, versionOf } from '../versions.ts';
import { fakeGhEnv, scratch } from './helpers.ts';
import type { Deps } from '../cli.ts';
import type { Factory } from '../factory.ts';

// --- The pure part (versions.ts, releases.ts): data in, data out.

test('versionOf reads the version a release branch names and refuses any other branch', () => {
  assert.equal(versionOf('release/0.3.0'), '0.3.0');
  for (const bad of ['main', 'release/0.3', 'release/v0.3.0', 'ticket/1-x', 'release/0.3.0-rc1', '']) assert.throws(() => versionOf(bad), /does not name a version/, bad);
});

test('greater compares number by number, and a version is not greater than itself', () => {
  assert.equal(greater('0.3.0', '0.2.0'), true);
  assert.equal(greater('0.10.0', '0.9.0'), true);
  assert.equal(greater('1.0.0', '0.99.99'), true);
  assert.equal(greater('0.2.1', '0.2.0'), true);
  assert.equal(greater('0.2.0', '0.2.0'), false);
  assert.equal(greater('0.2.0', '0.3.0'), false);
});

test('lastTag is the greatest version tag, null with none, and a tag that is not a version does not count', () => {
  assert.equal(lastTag('v0.1.0\nv0.10.0\nv0.9.0\n'), '0.10.0');
  assert.equal(lastTag('v0.2.0\r\nlatest\nv9\nv1.0.0-rc1\n1.5.0\n'), '0.2.0');
  assert.equal(lastTag(''), null);
});

test('mergedPrOf reads the number, the body and the merge commit of the newest merged PR, and refuses a shape it does not know', () => {
  const oid = 'a'.repeat(40);
  assert.deepEqual(mergedPrOf(JSON.stringify([{ number: 93, body: 'b', mergeCommit: { oid } }, { number: 2, body: 'old', mergeCommit: { oid: 'b'.repeat(40) } }])), { number: 93, body: 'b', merge: oid });
  assert.equal(mergedPrOf('[]'), null);
  for (const bad of ['', '{}', '[{"number":1,"body":"b"}]', '[{"number":1,"body":"b","mergeCommit":null}]', '[{"number":1,"body":"b","mergeCommit":{"oid":"abc;rm"}}]']) assert.throws(() => mergedPrOf(bad), bad);
});

// --- The subcommand, on a temporary git repository and the fake gh.

const BASE = 'release/1.0.0';
const FACTORY = '{\n  "project": {\n    "checks": ["a"]\n  }\n}\n';
const BODY = '## report\nCloses #7\nCloses #9\n- a line of the report\n';
const run = (cwd: string, ...args: string[]) => {
  const r = git(['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd });
  assert.equal(r.code, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

// `main` at A (tagged `tag`, if given); the release branch with the merges of tickets 7 and 9; the release merged into main.
function repo(tag: string | null = 'v0.9.0', factory: string = FACTORY): { dir: string; merge: string } {
  const dir = scratch();
  run(dir, 'init', '-q', '-b', 'main');
  run(dir, 'config', 'user.name', 't');
  run(dir, 'config', 'user.email', 't@t');
  mkdirSync(join(dir, '.claude'));
  writeFileSync(join(dir, '.claude', 'factory.json'), factory);
  writeFileSync(join(dir, 'a.txt'), 'a');
  run(dir, 'add', '.');
  run(dir, 'commit', '-q', '-m', 'A');
  if (tag !== null) run(dir, 'tag', tag);
  run(dir, 'checkout', '-q', '-b', BASE);
  for (const n of [7, 9]) {
    run(dir, 'checkout', '-q', '-b', `ticket/${n}-x`, BASE);
    writeFileSync(join(dir, `t${n}.txt`), 't');
    run(dir, 'add', '.');
    run(dir, 'commit', '-q', '-m', `T${n} (#${n})`);
    run(dir, 'checkout', '-q', BASE);
    run(dir, 'merge', '-q', '--no-ff', `ticket/${n}-x`, '-m', `Merge ticket/${n}-x into ${BASE} (#${n})`);
  }
  run(dir, 'checkout', '-q', 'main');
  run(dir, 'merge', '-q', '--no-ff', BASE, '-m', 'Release 1.0.0');
  return { dir, merge: run(dir, 'rev-parse', 'HEAD') };
}

type Answer = { args: string[]; code?: number; stdout?: string; stderr?: string };
const merged = (merge: string, body = BODY): Answer => ({ args: ['pr', 'list'], stdout: JSON.stringify([{ number: 21, body, mergeCommit: { oid: merge } }]) });

function fakeGh(answers: Answer[]) {
  const state = scratch();
  writeFileSync(join(state, 'answers.json'), JSON.stringify([
    { args: ['project', 'item-list'], code: 1, stderr: 'the board must not be listed' },
    ...answers,
    { args: ['release', 'create'], stdout: 'https://github.com/o/r/releases/tag/v1.0.0\n' },
    { args: ['api', 'repos/o/r/milestones'], stdout: '{"number":5,"title":"v1.0.0"}' },
    { args: ['api', 'repos/o/r/milestones/5'] },
    { args: ['issue', 'edit'] },
    { args: ['issue', 'view'], stdout: '{"parent":null}' },
  ]));
  const calls = (): { args: string[]; stdin: string }[] => {
    try { return readFileSync(join(state, 'calls.jsonl'), 'utf8').trim().split('\n').filter((l) => l).map((l) => JSON.parse(l)); } catch { return []; }
  };
  const isWrite = (c: { args: string[] }) => c.args[0] === 'release' || c.args[0] === 'api' || (c.args[0] === 'issue' && c.args[1] === 'edit');
  return { env: fakeGhEnv(state), calls, writes: () => calls().filter(isWrite) };
}

function deps(dir: string, fake: ReturnType<typeof fakeGh>): Deps {
  return {
    gh: (args, o) => gh(args, { ...o, env: fake.env }),
    git: (args, o) => git(args, { cwd: dir, ...o }),
    exec: execAsync,
    factory: () => ({ project: { repo: 'o/r', mainBranch: 'main' } }) as Factory,
  };
}

const tags = (dir: string) => run(dir, 'tag', '--list').split('\n').filter((t) => t);

test('close puts the tag on the merge commit and makes a Release whose text is the merged PR body', () => {
  const { dir, merge } = repo();
  const fake = fakeGh([merged(merge)]);
  const out = releaseClose(['--bump', 'minor'], deps(dir, fake));
  assert.equal(out.ok, true);
  assert.deepEqual([out.tag, out.dryRun, out.pr], ['v1.0.0', false, 21]);
  assert.equal(run(dir, 'rev-parse', 'v1.0.0^{commit}'), merge);
  const create = fake.writes().find((c) => c.args[0] === 'release');
  assert.deepEqual(create?.args, ['release', 'create', 'v1.0.0', '-R', 'o/r', '--title', 'v1.0.0', '--target', merge, '--notes-file', '-']);
  assert.equal(create?.stdin, BODY);
  const list = fake.calls().find((c) => c.args[0] === 'pr');
  assert.ok(list?.args.includes('merged'), 'it reads the merged PR, not the open one');
  assert.ok(!fake.calls().some((c) => c.args[0] === 'project'));
});

test('close makes the milestone of the version and puts in it every ticket merged in the release', () => {
  const { dir, merge } = repo();
  const fake = fakeGh([merged(merge)]);
  const out = releaseClose(['--bump', 'minor'], deps(dir, fake));
  assert.deepEqual([out.ok, out.milestone, out.tickets], [true, 'v1.0.0', 2]);
  assert.match(String(out.message), /milestone v1\.0\.0 with 2 tickets/);
  const writes = fake.writes().map((c) => c.args);
  assert.deepEqual(writes, [
    ['api', 'repos/o/r/milestones', '--method', 'POST', '-f', 'title=v1.0.0'],
    ['issue', 'edit', '7', '-R', 'o/r', '--milestone', 'v1.0.0'],
    ['issue', 'edit', '9', '-R', 'o/r', '--milestone', 'v1.0.0'],
    ['release', 'create', 'v1.0.0', '-R', 'o/r', '--title', 'v1.0.0', '--target', merge, '--notes-file', '-'],
    ['api', 'repos/o/r/milestones/5', '--method', 'PATCH', '-f', 'state=closed'],
  ]);
  assert.match(String(out.message), /and closed the milestone v1\.0\.0$/);
});

test('milestoneOf reads the number of the milestone and refuses a shape it does not know', () => {
  assert.equal(milestoneOf('{"number":5,"title":"v1"}'), 5);
  for (const bad of ['', '[]', '{}', '{"number":"5"}']) assert.throws(() => milestoneOf(bad), bad);
});

test('if a ticket cannot be put in the milestone, the milestone is taken back and neither the tag nor the Release is made', () => {
  const { dir, merge } = repo();
  const fake = fakeGh([merged(merge), { args: ['issue', 'edit', '9'], code: 1, stderr: 'nope' }]);
  assert.throws(() => releaseClose(['--bump', 'minor'], deps(dir, fake)), /ticket #9 could not be put in the milestone v1\.0\.0: nope; the milestone was taken back/);
  const writes = fake.writes().map((c) => c.args);
  assert.deepEqual(writes.at(-1), ['api', 'repos/o/r/milestones/5', '--method', 'DELETE']);
  assert.ok(!writes.some((a) => a[0] === 'release'));
  assert.deepEqual(tags(dir), ['v0.9.0']);
});

test('if the milestone cannot be made, nothing else is written', () => {
  const { dir, merge } = repo();
  const fake = fakeGh([merged(merge), { args: ['api', 'repos/o/r/milestones'], code: 1, stderr: 'exists' }]);
  assert.throws(() => releaseClose(['--bump', 'minor'], deps(dir, fake)), /milestone v1\.0\.0 could not be made: exists/);
  assert.equal(fake.writes().length, 1);
  assert.deepEqual(tags(dir), ['v0.9.0']);
});

test('close with a difference between the Closes lines and what was merged writes nothing', () => {
  const { dir, merge } = repo();
  for (const body of ['Closes #7', 'Closes #7\nCloses #9\nCloses #20']) {
    const fake = fakeGh([merged(merge, body)]);
    const out = releaseClose(['--bump', 'minor'], deps(dir, fake));
    assert.equal(out.ok, false);
    assert.match(String(out.message), /missing from the PR|extra in the PR/);
    assert.deepEqual(fake.writes(), []);
    assert.deepEqual(tags(dir), ['v0.9.0']);
  }
});

test('close stops when no release branch is above the last tag, names the branch to create and writes nothing', () => {
  for (const [tag, create] of [['v1.0.0', 'release/1.1.0'], ['v1.2.0', 'release/1.3.0']]) {
    const { dir, merge } = repo(tag);
    const fake = fakeGh([merged(merge)]);
    assert.throws(() => releaseClose(['--bump', 'minor'], deps(dir, fake)), new RegExp(`above the last tag ${tag}.*create ${create.replace('.', '\.')}`));
    assert.deepEqual(fake.writes(), []);
    assert.deepEqual(tags(dir), [tag]);
  }
});

test('close with no tag yet tags the first version', () => {
  const { dir, merge } = repo(null);
  const out = releaseClose(['--bump', 'minor'], deps(dir, fakeGh([merged(merge)])));
  assert.equal(out.ok, true);
  assert.deepEqual(tags(dir), ['v1.0.0']);
});

test('close stops when the release PR is not merged, and when its merge commit is not in the clone', () => {
  const { dir } = repo();
  const none = fakeGh([{ args: ['pr', 'list'], stdout: '[]' }]);
  assert.throws(() => releaseClose(['--bump', 'minor'], deps(dir, none)), /not merged/);
  assert.throws(() => releaseClose(['--bump', 'minor'], deps(dir, fakeGh([{ args: ['pr', 'list'], code: 1, stderr: 'no prs' }]))), /pull requests of release\/1\.0\.0 failed: no prs/);
  const away = fakeGh([merged('c'.repeat(40))]);
  assert.throws(() => releaseClose(['--bump', 'minor'], deps(dir, away)), /merge commit c{40} of PR #21 is not in the local repository: run `git fetch origin` and try again; nothing was written/);
  for (const f of [none, away]) assert.deepEqual(f.writes(), []);
  assert.deepEqual(tags(dir), ['v0.9.0']);
});

test('close --dry-run on a merged PR whose epic that merge closed finds no difference and counts the epic, open or closed', () => {
  const { dir, merge } = repo();
  const epic = (state: string): Answer => ({ args: ['issue', 'view', '50'], stdout: JSON.stringify({ state, subIssues: { totalCount: 2, nodes: [{ number: 7, state: 'CLOSED' }, { number: 9, state: 'CLOSED' }] } }) });
  const answers = (state: string, body: string): Answer[] => [
    { args: ['issue', 'view', '7'], stdout: '{"parent":{"number":50}}' }, { args: ['issue', 'view', '9'], stdout: '{"parent":{"number":50}}' },
    epic(state), merged(merge, body),
  ];
  for (const state of ['CLOSED', 'OPEN']) {
    const out = releaseClose(['--bump', 'minor', '--dry-run'], deps(dir, fakeGh(answers(state, `${BODY}Closes #50\n`))));
    assert.deepEqual([out.ok, out.epics], [true, [50]], state);
  }
  const without = releaseClose(['--bump', 'minor', '--dry-run'], deps(dir, fakeGh(answers('CLOSED', BODY))));
  assert.deepEqual([without.ok, without.missing, without.extra], [false, [50], []]);
});

test('close --dry-run says what it would do and writes nothing, not even the tag', () => {
  const { dir, merge } = repo();
  const fake = fakeGh([merged(merge)]);
  const out = releaseClose(['--bump', 'minor', '--dry-run'], deps(dir, fake));
  assert.equal(out.ok, true);
  assert.equal(out.dryRun, true);
  assert.match(String(out.message), new RegExp(`milestone v1\\.0\\.0 with 2 tickets.*tag v1\\.0\\.0 on ${merge.slice(0, 7)}.*GitHub Release v1\\.0\\.0`));
  assert.equal(out.milestone, 'v1.0.0');
  assert.match(String(out.message), new RegExp(`branch release/1\.1\.0 on ${merge.slice(0, 7)}`));
  assert.match(String(out.message), /and close the milestone v1\.0\.0; nothing was written$/);
  assert.deepEqual([out.next, out.nextBranch, out.bump], ['1.1.0', 'release/1.1.0', 'minor']);
  assert.deepEqual(fake.writes(), []);
  assert.deepEqual(tags(dir), ['v0.9.0']);
  assert.equal(branches(dir).includes('release/1.1.0'), false);
});

test('if the Release cannot be made, the tag and the milestone made a moment before are taken back, no next branch is left and the error says so', () => {
  const { dir, merge } = repo();
  const fake = fakeGh([merged(merge), { args: ['release', 'create'], code: 1, stderr: 'boom' }]);
  assert.throws(() => releaseClose(['--bump', 'minor'], deps(dir, fake)), /Release v1\.0\.0 failed: boom.*tag was taken back.*milestone was taken back/);
  assert.deepEqual(tags(dir), ['v0.9.0']);
  assert.deepEqual(fake.writes().at(-1)?.args, ['api', 'repos/o/r/milestones/5', '--method', 'DELETE']);
  assert.equal(branches(dir).includes('release/1.1.0'), false);
});

test('close takes --bump and --dry-run and nothing else; release names it as an action', () => {
  const { dir, merge } = repo();
  const d = deps(dir, fakeGh([merged(merge)]));
  const bad = [[], ['--dry-run'], ['--bump'], ['--bump', 'huge'], ['--bump', 'minor', 'x'], ['--bump', 'minor', '--bump', 'major'], ['--bump', 'minor', '--dry-run', '--dry-run'], ['minor'], ['--dry', '--bump', 'minor']];
  for (const args of bad) assert.throws(() => releaseClose(args, d), UsageError, args.join(' '));
  assert.equal((release(['close', '--dry-run', '--bump', 'patch'], d) as { ok: boolean }).ok, true);
  assert.throws(() => release(['nope'], d), /check\|close/);
});

// --- The next release: its version and its branch.

test('nextVersion for patch, minor and major from the tag just made, and a tag that is not a version stops', () => {
  assert.equal(nextVersion('0.3.0', 'patch'), '0.3.1');
  assert.equal(nextVersion('0.3.0', 'minor'), '0.4.0');
  assert.equal(nextVersion('0.3.0', 'major'), '1.0.0');
  assert.equal(nextVersion('0.9.9', 'minor'), '0.10.0');
  assert.equal(nextVersion('1.4.7', 'major'), '2.0.0');
  assert.equal(nextVersion('1.4.7', 'minor'), '1.5.0');
  assert.throws(() => nextVersion('1.4', 'patch'), /not a version/);
  assert.throws(() => nextVersion('1.4.7', 'huge' as 'patch'), /not patch, minor or major/);
});

const branches = (dir: string) => run(dir, 'branch', '--format=%(refname:short)').split('\n').filter((b) => b);

for (const [bump, next] of [['patch', '1.0.1'], ['minor', '1.1.0'], ['major', '2.0.0']] as const) {
  test(`close with ${bump} makes release/${next} on the merge commit and does not change factory.json`, () => {
    const { dir, merge } = repo();
    const fake = fakeGh([merged(merge)]);
    const out = releaseClose(['--bump', bump], deps(dir, fake));
    assert.equal(out.ok, true);
    assert.deepEqual([out.next, out.nextBranch], [next, `release/${next}`]);
    assert.match(String(out.message), new RegExp(`branch release/${next.replace(/\./g, '\.')} on ${merge.slice(0, 7)}`));
    const branch = `release/${next}`;
    assert.equal(run(dir, 'rev-parse', branch), merge);
    assert.equal(run(dir, 'diff', '--name-only', merge, branch), '');
    assert.equal(run(dir, 'show', `${branch}:.claude/factory.json`), FACTORY.trim());
    assert.equal(run(dir, 'rev-parse', `v1.0.0^{commit}`), merge);
  });
}

test('close leaves the folder as it was: same branch, same files, same index, no stray file', () => {
  const { dir, merge } = repo();
  releaseClose(['--bump', 'minor'], deps(dir, fakeGh([merged(merge)])));
  assert.equal(run(dir, 'branch', '--show-current'), 'main');
  assert.equal(run(dir, 'status', '--porcelain'), '');
  assert.equal(readFileSync(join(dir, '.claude', 'factory.json'), 'utf8'), FACTORY);
  assert.equal(run(dir, 'rev-parse', 'HEAD'), merge);
});
