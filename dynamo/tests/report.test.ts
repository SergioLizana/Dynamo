import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UsageError } from '../cli.ts';
import { exec } from '../exec.ts';
import { gh } from '../gh.ts';
import { git } from '../git.ts';
import { report } from '../report.ts';
import { commands, remoteNote, render } from '../reports.ts';
import { PLACEHOLDER, costOf, isResult, lastResult, mergedTickets, outOfTicket, prOf, remoteOf, ticketOf } from '../releases.ts';
import { DYNAMO, fakeGhEnv, scratch } from './helpers.ts';
import type { Deps } from '../cli.ts';
import type { Options } from '../exec.ts';
import type { Factory } from '../factory.ts';

// --- The pure part (releases.ts, reports.ts): data in, data out.

const log = (...rows: [string, string][]) => rows.map(([p, s]) => `${p}\t${s}`).join('\n'); // newest first
const M = 'aaa bbb'; // two parents: a merge commit
const S = 'ccc'; // one parent

test('mergedTickets takes the (#n) of the merge commits, oldest ticket first, whatever the language of the subject', () => {
  assert.deepEqual(mergedTickets(log([M, 'Merge ticket/9-x into release/1.0.0 (#9)'], [S, 'a plain commit (#4)'], [M, 'Fusiona ticket/3-y en release/1.0.0 (#3)'])), [3, 9]);
  assert.deepEqual(mergedTickets(''), []);
  assert.deepEqual(mergedTickets(log([M, 'Merge branch x'], [M, 'Merge ticket/5 (#5) and more'])), []);
});

test('reverting a merge takes the ticket out; reverting the revert puts it back; a revert of a plain commit does nothing', () => {
  const merge = 'Merge ticket/7-x into release/1.0.0 (#7)';
  const revert = `Revert "${merge}"`;
  assert.deepEqual(mergedTickets(log([S, revert], [M, merge], [M, 'Merge ticket/2-y into release/1.0.0 (#2)'])), [2]);
  assert.deepEqual(mergedTickets(log([S, `Revert "${revert}"`], [S, revert], [M, merge])), [7]);
  assert.deepEqual(mergedTickets(log([S, 'Revert "A plain commit (#7)"'], [M, merge])), [7]);
  assert.deepEqual(mergedTickets(log([S, revert], [M, 'Merge ticket/8-z into release/1.0.0 (#8)'])), [8]);
});

const comment = (head: string, extra = '') => `${head}\nRounds: 2/2\nChecks: ok\n${extra}`;

test('the last result comment starts with «run · » or «/implement · » and the later one wins', () => {
  assert.equal(isResult('run · PASS'), true);
  assert.equal(isResult('/implement · PASS'), true);
  for (const no of ['run: PASS', 'run - PASS', '/implement PASS', ' run · x', 'a run · b', '']) assert.equal(isResult(no), false, no);
  const r = lastResult(['hello', comment('run · old'), 'a thought', comment('/implement · PASS and merged'), 'thanks']);
  assert.deepEqual(r, { head: 'PASS and merged', rounds: '2/2', out: null });
  assert.equal(lastResult(['hello']), null);
  assert.equal(lastResult([comment('run · only a run comment')])?.head, 'only a run comment');
  assert.equal(lastResult(['/implement · x\r\nRounds: 1/2\r\n'])?.rounds, '1/2');
});

test('outOfTicket keeps text after the colon, unfenced lines and fenced lines, and drops «nothing» and «none»', () => {
  assert.equal(outOfTicket(null), null);
  for (const empty of ['Out of the ticket (for the backlog): nothing', 'Out of the ticket: None.', 'Out of the ticket:']) assert.equal(outOfTicket(empty), null, empty);
  assert.equal(outOfTicket('Out of the ticket: a typo in X\nand more'), 'a typo in X and more');
  assert.equal(outOfTicket('Out of the ticket:\n```text\nnothing here\n```\nStopped at: build'), 'nothing here');
  assert.equal(outOfTicket('Out of the ticket (for the backlog): nothing\nStopped at: build\nLeft: x'), null);
});

test('costOf keeps a /cost line the human filled in and drops the placeholder', () => {
  assert.equal(costOf('x\n- `/cost` of the session: $4.20 · 12 turns\ny'), '$4.20 · 12 turns');
  assert.equal(costOf(`- \`/cost\` of the session: ${PLACEHOLDER}`), null);
  assert.equal(costOf('nothing'), null);
});

test('ticketOf and prOf read gh JSON and refuse a shape they do not know', () => {
  assert.deepEqual(ticketOf('{"title":"T","comments":[{"body":"a"},{"body":"b"}]}'), { title: 'T', comments: ['a', 'b'] });
  for (const bad of ['', 'null', '{"title":"T"}', '{"title":1,"comments":[]}', '{"title":"T","comments":[{"x":1}]}']) assert.throws(() => ticketOf(bad), bad);
  assert.deepEqual(prOf('[{"number":12,"url":"u","body":"b"}]'), { number: 12, body: 'b' });
  assert.equal(prOf('[]'), null);
  for (const bad of ['', '{}', '[{"url":"u"}]']) assert.throws(() => prOf(bad), bad);
});

test('remoteOf: up to date, missing, behind, different and unknown', () => {
  assert.deepEqual(remoteOf('abc1234', 'abc1234def\trefs/heads/x\n', '0'), { state: 'up-to-date', missing: 0 });
  assert.deepEqual(remoteOf('abc1234', '', '5'), { state: 'missing', missing: 5 });
  assert.deepEqual(remoteOf('abc1234', 'fff0000\trefs/heads/x', '2'), { state: 'behind', missing: 2 });
  assert.deepEqual(remoteOf('abc1234', 'fff0000\trefs/heads/x', '0'), { state: 'different', missing: 0 });
  assert.deepEqual(remoteOf('abc1234', null, null), { state: 'unknown', missing: null });
  assert.equal(remoteNote({ state: 'up-to-date', missing: 0 }, 'b'), null);
  assert.match(String(remoteNote({ state: 'behind', missing: 2 }, 'b')), /2 commits/);
});

const facts = {
  base: 'release/1.0.0', main: 'main', needsHuman: 'Needs Human', cost: null as string | null,
  tickets: [
    { number: 3, title: 'Three', result: { head: 'PASS and merged', rounds: '1/2', out: 'Out of the ticket (for the backlog): fix the typo in X' } },
    { number: 5, title: 'Five', result: null },
    { number: 6, title: null, result: null },
  ],
  stuck: [{ number: 9, title: 'Nine' }],
};

test('render has the sections Needs Human, Out of the ticket and Cost, and one Closes per merged ticket', () => {
  const text = render(facts);
  assert.ok(text.startsWith('## release report · release/1.0.0\n'));
  assert.match(text, /- #3 «Three»: last result comment «PASS and merged», rounds 1\/2/);
  assert.match(text, /- #5 «Five»: merged; no result comment on the ticket/);
  assert.match(text, /- #6: merged; no ticket data on GitHub/);
  assert.match(text, /### Needs Human\n\n- #9 «Nine»\n/);
  assert.match(text, /### Out of the ticket \(for the backlog\)\n\n- #3: fix the typo in X\n/);
  assert.match(text, new RegExp(`### Cost\\n\\n- \`/cost\` of the session: ${PLACEHOLDER}\\n`));
  assert.deepEqual(text.match(/^Closes #\d+$/gm), ['Closes #3', 'Closes #5', 'Closes #6']);
  assert.match(render({ ...facts, stuck: [], tickets: [], cost: '$1' }), /### Needs Human\n\n- none\n[\s\S]*- nothing\n[\s\S]*of the session: \$1\n$/);
  assert.match(render({ ...facts, stuck: null }), /### Needs Human\n\n- not read\n/);
});

test('commands: the push first when the remote lacks commits, then pr create, or pr edit when a PR is open', () => {
  const file = '.claude/worktrees/r.md';
  const behind = { state: 'behind', missing: 2 } as const, same = { state: 'up-to-date', missing: 0 } as const;
  assert.deepEqual(commands('release/1.0.0', 'main', 'o/r', file, behind, null), [
    'git push -u origin release/1.0.0',
    `gh pr create -R o/r --base main --head release/1.0.0 --title "Release 1.0.0" --body-file ${file}`,
  ]);
  assert.deepEqual(commands('release/1.0.0', 'main', 'o/r', file, same, 12), [`gh pr edit 12 -R o/r --body-file ${file}`]);
  assert.equal(commands('release/1.0.0', 'main', 'o/r', file, { state: 'missing', missing: 1 }, 12)[0], 'git push -u origin release/1.0.0');
});

// --- The subcommand, on a temporary git repository and the fake gh.

const BASE = 'release/1.0.0';
const run = (cwd: string, ...args: string[]) => {
  const r = git(['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd });
  assert.equal(r.code, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

// `main` at A; the release branch from it with the merge of ticket 7 and ticket 8, and the revert of 8; ticket 9 not merged.
function repo(): string {
  const dir = scratch();
  run(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'a.txt'), 'a');
  run(dir, 'add', '.');
  run(dir, 'commit', '-q', '-m', 'A');
  run(dir, 'checkout', '-q', '-b', BASE);
  for (const n of [7, 8]) {
    run(dir, 'checkout', '-q', '-b', `ticket/${n}-x`, BASE);
    writeFileSync(join(dir, `t${n}.txt`), 't');
    run(dir, 'add', '.');
    run(dir, 'commit', '-q', '-m', `T${n} (#${n})`);
    run(dir, 'checkout', '-q', BASE);
    run(dir, 'merge', '-q', '--no-ff', `ticket/${n}-x`, '-m', `Merge ticket/${n}-x into ${BASE} (#${n})`);
  }
  run(dir, 'revert', '-m', '1', '--no-edit', 'HEAD');
  return dir;
}

const conn = (nodes: unknown[]) => ({ totalCount: nodes.length, nodes });
const card = (number: number, title: string, column: string) => ({
  number, title, state: 'OPEN', labels: conn([]), blockedBy: conn([]),
  projectItems: conn([{ project: { id: 'BOARD' }, fieldValues: conn([{ name: column, field: { id: 'STATUS' } }]) }]),
});
const open = JSON.stringify({ data: { repository: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [
  card(9, 'Nine', 'Needs Human'), card(10, 'Ten', 'Todo'), card(4, 'Four', 'Needs Human'),
] } } } });

type Answer = { args: string[]; code?: number; stdout?: string; stderr?: string };
function fakeGh(extra: Answer[] = [], pr: Answer = { args: ['pr', 'list'], stdout: '[]' }): { env: Options['env']; calls: () => string[][] } {
  const state = scratch();
  const issue = JSON.stringify({ title: 'Seven', comments: [{ body: 'hi' }, { body: comment('/implement · PASS and merged into release', 'Out of the ticket (for the backlog): a loose end') }] });
  writeFileSync(join(state, 'answers.json'), JSON.stringify([
    ...extra,
    { args: ['project', 'item-list'], code: 1, stderr: 'the board must not be listed' },
    { args: ['issue', 'view', '7'], stdout: issue },
    { args: ['api', 'graphql'], stdout: open },
    pr,
  ]));
  const calls = () => {
    try { return readFileSync(join(state, 'calls.jsonl'), 'utf8').trim().split('\n').filter((l) => l).map((l) => JSON.parse(l).args); } catch { return []; }
  };
  return { env: fakeGhEnv(state), calls };
}

function deps(dir: string, fake = fakeGh(), project: Record<string, unknown> = {}): Deps {
  return {
    gh: (args, o) => gh(args, { ...o, env: fake.env }),
    git: (args, o) => git(args, { cwd: dir, ...o }),
    exec,
    factory: () => ({
      project: { repo: 'o/r', mainBranch: 'main', workingBranch: BASE, doneLabel: 'in-release', boardId: 'BOARD', statusFieldId: 'STATUS', checks: [], ...project },
      columns: { needsHuman: 'Needs Human' },
    }) as Factory,
  };
}

const FILE = `.claude/worktrees/release-report-release-1.0.0.md`;

test('it writes the report of the merged tickets, reads Needs Human from the open issues and never lists the board', () => {
  const dir = repo();
  const fake = fakeGh();
  const out = report([], deps(dir, fake));
  assert.equal(out.ok, true);
  assert.equal(out.file, FILE);
  assert.equal(out.merged, 1);
  assert.equal(out.needsHuman, 2);
  const text = readFileSync(join(dir, FILE), 'utf8');
  assert.ok(text.startsWith(`## release report · ${BASE}\n`));
  assert.match(text, /- #7 «Seven»: last result comment «PASS and merged into release», rounds 2\/2/);
  assert.match(text, /### Needs Human\n\n- #4 «Four»\n- #9 «Nine»\n/);
  assert.match(text, /### Out of the ticket \(for the backlog\)\n\n- #7: a loose end\n/);
  assert.deepEqual(text.match(/^Closes #\d+$/gm), ['Closes #7']);
  assert.ok(!fake.calls().some((c) => c[0] === 'project'), JSON.stringify(fake.calls()));
});

test('it keeps the /cost line of an open release PR and says gh pr edit', () => {
  const dir = repo();
  const body = '## old report\n- `/cost` of the session: $3.10 · 40 turns\n';
  const out = report([], deps(dir, fakeGh([], { args: ['pr', 'list'], stdout: JSON.stringify([{ number: 21, url: 'u', body }]) })));
  assert.match(readFileSync(join(dir, FILE), 'utf8'), /### Cost\n\n- `\/cost` of the session: \$3.10 · 40 turns\n/);
  assert.equal(out.pr, 21);
  assert.deepEqual((out.commands as string[]).slice(-1), [`gh pr edit 21 -R o/r --body-file ${FILE}`]);
});

test('it prints the push and gh pr create when the remote lacks the branch, and runs neither', () => {
  const dir = repo();
  const fake = fakeGh();
  const remote = scratch();
  run(remote, 'init', '-q', '--bare');
  run(dir, 'remote', 'add', 'origin', remote);
  const out = report([], deps(dir, fake));
  assert.deepEqual(out.commands, [
    `git push -u origin ${BASE}`,
    `gh pr create -R o/r --base main --head ${BASE} --title "Release 1.0.0" --body-file ${FILE}`,
  ]);
  assert.equal(out.remote, 'missing');
  assert.equal(git(['ls-remote', '--heads', 'origin', BASE], { cwd: dir }).stdout.trim(), '', 'nothing was pushed');
  assert.ok(!fake.calls().some((c) => c[0] === 'pr' && c[1] !== 'list'), 'no PR was created');
  run(dir, 'push', '-q', 'origin', BASE);
  const after = report([], deps(dir, fake));
  assert.equal(after.remote, 'up-to-date');
  assert.deepEqual(after.commands, [`gh pr create -R o/r --base main --head ${BASE} --title "Release 1.0.0" --body-file ${FILE}`]);
});

test('what it cannot read costs its part of the report and adds a note, not the whole report', () => {
  const dir = repo();
  const fake = fakeGh([{ args: ['issue', 'view', '7'], code: 1, stderr: 'gone' }, { args: ['api', 'graphql'], code: 1, stderr: 'no graphql' }], { args: ['pr', 'list'], code: 1, stderr: 'no prs' });
  const out = report([], deps(dir, fake));
  assert.equal(out.ok, true);
  assert.equal(out.needsHuman, null);
  assert.equal(out.prKnown, false);
  const text = readFileSync(join(dir, FILE), 'utf8');
  assert.match(text, /- #7: merged; no ticket data on GitHub/);
  assert.match(text, /### Needs Human\n\n- not read\n/);
  assert.equal((out.notes as string[]).filter((n) => /could not be read/.test(n)).length, 4); // #7, the cards, the PRs, the remote
});

test('it refuses what it cannot report on: the main branch, an unknown branch, an unsafe name, extra arguments', () => {
  const dir = repo();
  assert.throws(() => report(['main'], deps(dir)), /main branch/);
  assert.throws(() => report(['nope'], deps(dir)), /finding nope here/);
  for (const bad of ['--help', 'a b', 'x;rm', '$(x)', '']) assert.throws(() => report([bad], deps(dir)), UsageError, bad);
  assert.throws(() => report(['a', 'b'], deps(dir)), UsageError);
  assert.throws(() => report([], deps(dir, fakeGh(), { repo: 'norepo' })), /owner\/name/);
  assert.equal(existsSync(join(dir, '.claude')), false, 'nothing was written');
});

// --- The entry point: `dynamo report` through node, with the real config of this repository and the fake gh. Report needs
// git, so the PATH is the real one; DYNAMO_GH still puts the fake in the place of gh.

test('node dynamo.ts report exits 0 with one JSON line and a file that starts with the report title', () => {
  const dir = repo();
  const config = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '.claude', 'factory.json'), 'utf8'));
  const branch = config.project.workingBranch;
  run(dir, 'branch', '-q', '-m', BASE, branch);
  run(dir, 'checkout', '-q', branch);
  const state = scratch();
  writeFileSync(join(state, 'answers.json'), JSON.stringify([
    { args: ['issue', 'view'], stdout: '{"title":"T","comments":[]}' },
    { args: ['api', 'graphql'], stdout: JSON.stringify({ data: { repository: { issues: { pageInfo: { hasNextPage: false }, nodes: [] } } } }) },
    { args: ['pr', 'list'], stdout: '[]' },
  ]));
  const r = spawnSync(process.execPath, [DYNAMO, 'report'], { encoding: 'utf8', cwd: dir, env: { ...fakeGhEnv(state), PATH: process.env.PATH ?? process.env.Path } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const lines = r.stdout.split('\n').filter((l) => l !== '');
  assert.equal(lines.length, 1);
  const out = JSON.parse(lines[0]);
  assert.equal(out.ok, true);
  assert.ok(readFileSync(join(dir, out.file), 'utf8').startsWith(`## release report · ${branch}\n`));
});
