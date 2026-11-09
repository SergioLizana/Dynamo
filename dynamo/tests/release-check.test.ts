import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UsageError } from '../cli.ts';
import { closesOf, differenceOf, differenceText, parentOf } from '../closes.ts';
import { execAsync } from '../exec.ts';
import { gh } from '../gh.ts';
import { git } from '../git.ts';
import { release } from '../release.ts';
import { releaseCheck } from '../release-check.ts';
import { DYNAMO, fakeGhEnv, scratch, withFactory } from './helpers.ts';
import type { Deps } from '../cli.ts';
import type { Factory } from '../factory.ts';

// --- The pure part (closes.ts): data in, data out.

test('closesOf reads the closing keywords GitHub reads, each ticket once, sorted', () => {
  assert.deepEqual(closesOf('## report\nCloses #9\nCloses #3\ncloses #9\nFixes: #4\nresolved #12'), [3, 4, 9, 12]);
  assert.deepEqual(closesOf('Closes #7\r\nCloses #8\r\n'), [7, 8]);
  assert.deepEqual(closesOf('- #7 «Seven»: merged\nsee #8\nthe epic closes nothing\nCloses #x\nclosesx #5\nCloses #12abc'), []);
  assert.deepEqual(closesOf(''), []);
});

test('differenceOf names what is missing from the PR and what it closes in excess; differenceText is null with none', () => {
  assert.deepEqual(differenceOf([3, 5, 7], [5, 7, 9]), { missing: [3], extra: [9] });
  assert.deepEqual(differenceOf([7, 3], [3, 7, 7]), { missing: [], extra: [] });
  assert.equal(differenceText({ missing: [], extra: [] }), null);
  assert.match(String(differenceText({ missing: [3, 4], extra: [] })), /^missing from the PR .*: #3, #4$/);
  assert.match(String(differenceText({ missing: [], extra: [9] })), /^extra in the PR .*: #9$/);
  assert.match(String(differenceText({ missing: [3], extra: [9] })), /#3; extra .*#9$/);
});

test('parentOf reads the epic number of a ticket, or null, and refuses a shape it does not know', () => {
  assert.equal(parentOf('{"parent":{"number":96,"state":"OPEN"}}'), 96);
  for (const none of ['{"parent":null}', '{}']) assert.equal(parentOf(none), null, none);
  for (const bad of ['', 'nope', '{"parent":{"x":1}}', '{"parent":"96"}']) assert.throws(() => parentOf(bad), bad);
});

// --- The subcommand, on a temporary git repository and the fake gh.

const BASE = 'release/1.0.0';
const run = (cwd: string, ...args: string[]) => {
  const r = git(['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd });
  assert.equal(r.code, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

// `main` at A; the release branch with the merges of tickets 7, 8 and 9; 8 is reverted (out); 9 is reverted and the revert
// reverted (back in). So the release holds 7 and 9.
function repo(branch = BASE): string {
  const dir = scratch();
  run(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'a.txt'), 'a');
  run(dir, 'add', '.');
  run(dir, 'commit', '-q', '-m', 'A');
  run(dir, 'checkout', '-q', '-b', branch);
  for (const n of [7, 8, 9]) {
    run(dir, 'checkout', '-q', '-b', `ticket/${n}-x`, branch);
    writeFileSync(join(dir, `t${n}.txt`), 't');
    run(dir, 'add', '.');
    run(dir, 'commit', '-q', '-m', `T${n} (#${n})`);
    run(dir, 'checkout', '-q', branch);
    run(dir, 'merge', '-q', '--no-ff', `ticket/${n}-x`, '-m', `Merge ticket/${n}-x into ${branch} (#${n})`);
  }
  run(dir, 'revert', '-m', '1', '--no-edit', 'HEAD'); // 9 out
  // 9 back in. Written as a plain revert of the revert (newer git titles it «Reapply», which mergedTickets does not read).
  run(dir, 'revert', '-n', 'HEAD');
  run(dir, 'commit', '-q', '-m', `Revert "${run(dir, 'log', '-1', '--format=%s')}"`);
  run(dir, 'revert', '-m', '1', '--no-edit', 'HEAD~3'); // 8 out
  return dir;
}

type Answer = { args: string[]; code?: number; stdout?: string; stderr?: string };
const pr = (body: string): Answer => ({ args: ['pr', 'list'], stdout: JSON.stringify([{ number: 21, body }]) });
const parent = (n: number | null): string => JSON.stringify({ parent: n === null ? null : { number: n, state: 'OPEN' } });
const epic = (subs: [number, string][], state = 'OPEN'): Answer => ({
  args: ['issue', 'view', '50'],
  stdout: JSON.stringify({ state, subIssues: { totalCount: subs.length, nodes: subs.map(([number, s]) => ({ number, state: s })) } }),
});

function fakeGh(answers: Answer[]): { env: ReturnType<typeof fakeGhEnv>; calls: () => string[][] } {
  const state = scratch();
  writeFileSync(join(state, 'answers.json'), JSON.stringify([
    { args: ['project', 'item-list'], code: 1, stderr: 'the board must not be listed' },
    ...answers,
    { args: ['issue', 'view'], stdout: parent(null) },
  ]));
  const calls = () => {
    try { return readFileSync(join(state, 'calls.jsonl'), 'utf8').trim().split('\n').filter((l) => l).map((l) => JSON.parse(l).args); } catch { return []; }
  };
  return { env: fakeGhEnv(state), calls };
}

function deps(dir: string, fake: ReturnType<typeof fakeGh>, project: Record<string, unknown> = {}): Deps {
  return {
    gh: (args, o) => gh(args, { ...o, env: fake.env }),
    git: (args, o) => git(args, { cwd: dir, ...o }),
    exec: execAsync,
    factory: () => ({ project: { repo: 'o/r', mainBranch: 'main', ...project } }) as Factory,
  };
}

test('a merged ticket with no Closes line in the PR is reported as missing; one brought back by a revert of a revert counts', () => {
  const out = releaseCheck([], deps(repo(), fakeGh([pr('Closes #7')])));
  assert.equal(out.ok, false);
  assert.deepEqual(out.missing, [9]);
  assert.deepEqual(out.extra, []);
  assert.equal(out.merged, 2);
  assert.match(String(out.message), /missing from the PR .*#9/);
});

test('a Closes line of a ticket not merged is reported as extra, and one reverted for good is not merged', () => {
  const out = releaseCheck([], deps(repo(), fakeGh([pr('Closes #7\nCloses #9\nCloses #8\nCloses #20')])));
  assert.equal(out.ok, false);
  assert.deepEqual(out.missing, []);
  assert.deepEqual(out.extra, [8, 20]);
});

test('with no difference it is ok and says so; the board is never listed', () => {
  const fake = fakeGh([pr('## report\nCloses #7\nCloses #9\n')]);
  const out = releaseCheck([], deps(repo(), fake));
  assert.equal(out.ok, true);
  assert.deepEqual([out.missing, out.extra], [[], []]);
  assert.match(String(out.message), /match what was merged/);
  assert.ok(!fake.calls().some((c) => c[0] === 'project'));
});

test('an epic whose sub-issues are all in the release or closed before must be closed too: its Closes is missing without it', () => {
  const answers = (body: string): Answer[] => [
    { args: ['issue', 'view', '7'], stdout: parent(50) }, { args: ['issue', 'view', '9'], stdout: parent(50) },
    epic([[7, 'OPEN'], [9, 'OPEN'], [3, 'CLOSED']]), pr(body),
  ];
  const without = releaseCheck([], deps(repo(), fakeGh(answers('Closes #7\nCloses #9'))));
  assert.deepEqual([without.ok, without.missing, without.epics], [false, [50], [50]]);
  assert.equal(releaseCheck([], deps(repo(), fakeGh(answers('Closes #7\nCloses #9\nCloses #50')))).ok, true);
});

test('an epic with a sub-issue neither merged nor closed is not closed: its Closes is extra; a closed epic is not closed again', () => {
  const answers = (e: Answer, body: string): Answer[] => [{ args: ['issue', 'view', '7'], stdout: parent(50) }, e, pr(body)];
  const partial = releaseCheck([], deps(repo(), fakeGh(answers(epic([[7, 'OPEN'], [8, 'OPEN']]), 'Closes #7\nCloses #9\nCloses #50'))));
  assert.deepEqual([partial.ok, partial.missing, partial.extra, partial.epics], [false, [], [50], []]);
  const done = releaseCheck([], deps(repo(), fakeGh(answers(epic([[7, 'OPEN']], 'CLOSED'), 'Closes #7\nCloses #9'))));
  assert.equal(done.ok, true);
});

test('what it cannot read it does not guess: a ticket, an epic, the PRs or a missing PR is an error, not a verdict', () => {
  const dir = repo();
  assert.throws(() => releaseCheck([], deps(dir, fakeGh([{ args: ['issue', 'view', '7'], code: 1, stderr: 'gone' }, pr('Closes #7')]))), /cannot tell.*#7: gone/);
  assert.throws(() => releaseCheck([], deps(dir, fakeGh([{ args: ['issue', 'view', '7'], stdout: parent(50) }, { args: ['issue', 'view', '50'], code: 1, stderr: 'no epic' }, pr('')]))), /cannot tell.*epic #50/);
  assert.throws(() => releaseCheck([], deps(dir, fakeGh([{ args: ['pr', 'list'], code: 1, stderr: 'no prs' }]))), /pull requests of release\/1\.0\.0 failed: no prs/);
  assert.throws(() => releaseCheck([], deps(dir, fakeGh([{ args: ['pr', 'list'], stdout: '[]' }]))), /no open pull request/);
});

test('it refuses the main branch, an unknown or unsafe branch and extra arguments, and a base given is the one checked', () => {
  const dir = repo();
  const d = deps(dir, fakeGh([pr('Closes #7\nCloses #9')]));
  assert.throws(() => releaseCheck(['main'], d), /main branch/);
  assert.throws(() => releaseCheck(['nope'], d), /reading the merges of nope/);
  for (const bad of ['--help', 'a b', 'x;rm', '$(x)', '']) assert.throws(() => releaseCheck([bad], d), UsageError, bad);
  assert.throws(() => releaseCheck(['a', 'b'], d), UsageError);
  assert.equal(releaseCheck([BASE], deps(dir, fakeGh([pr('Closes #7\nCloses #9')]))).ok, true);
});

test('release takes the action check and nothing else', () => {
  const d = deps(repo(), fakeGh([pr('Closes #7\nCloses #9')]));
  assert.equal((release(['check'], d) as { ok: boolean }).ok, true);
  for (const bad of [[], ['nope'], ['--help']]) assert.throws(() => release(bad, d), UsageError, bad.join(' '));
});

// --- The entry point: `dynamo release check` through node, with the real config of this repository and the fake gh.

test('node dynamo.ts release check exits 1 with a difference and 0 without, one JSON line each', () => {
  const call = (body: string) => {
    const dir = withFactory(repo());
    const state = scratch();
    writeFileSync(join(state, 'answers.json'), JSON.stringify([
      { args: ['issue', 'view'], stdout: parent(null) },
      { args: ['pr', 'list'], stdout: JSON.stringify([{ number: 21, body }]) },
    ]));
    const r = spawnSync(process.execPath, [DYNAMO, 'release', 'check'], { encoding: 'utf8', cwd: dir, env: { ...fakeGhEnv(state), PATH: process.env.PATH ?? process.env.Path } });
    const lines = r.stdout.split('\n').filter((l) => l !== '');
    assert.equal(lines.length, 1, r.stdout + r.stderr);
    return { status: r.status, out: JSON.parse(lines[0]) };
  };
  const different = call('Closes #7');
  assert.equal(different.status, 1);
  assert.deepEqual([different.out.ok, different.out.missing], [false, [9]]);
  const same = call('Closes #7\nCloses #9');
  assert.equal(same.status, 0);
  assert.equal(same.out.ok, true);
});
