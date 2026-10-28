'use strict';
// Dry runs of the three workflow scripts with a `runner` played by a real shell (tests/workflows/harness.js): for ticket #75,
// that long text never travels through the runner by hand, and for ticket #76, that the big reads are done by the command
// .claude/workflows/lib/read.js and the runner copies back one short line per command (the command itself is tested in
// tests/workflows/read.test.js). Run with: node --test tests/workflows/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { dryRun, ROOT } = require('./harness.js');

const RELEASE = '.claude/workflows/release-report.js';
const BOARD = '.claude/workflows/board.js';
const RUN = '.claude/workflows/run.js';

const everyCommand = []; // for the permission test at the end

function clean(r) {
  assert.equal(r.error, undefined, r.error && r.error.stack);
  assert.deepEqual(r.seen.longCommands, [], 'a command is longer than runner.maxCommand');
  assert.deepEqual(r.seen.longOutputs, [], 'an output is longer than runner.maxOutput');
  assert.deepEqual(r.seen.longLines, [], 'the command printed more than runner.maxLine');
  assert.deepEqual(r.seen.refused, [], 'the write guard refused a command');
  everyCommand.push(...r.seen.commands);
}

// What the scripts of the big reads send is only the command of the repository: one rule covers all of it.
const LIB_RULE = /^node \.claude\/workflows\/lib\/read\.js /;
function onlyTheCommand(r) {
  assert.deepEqual(r.seen.commands.filter((c) => !LIB_RULE.test(c)), [], 'a command that is not read.js reached the runner');
}
// The output of the nth command the runner ran that starts with `prefix`, altered by `change`, once or every time.
function alterLine(prefix, always, change = (o) => o.replace(/^(\S+ \S+=)(.)/, (_, a, c) => a + (c === 'A' ? 'B' : 'A'))) {
  let done = false;
  return (output, command) => {
    if (!command.startsWith(prefix) || (done && !always)) return output;
    done = true;
    return change(output);
  };
}

// ---------- release-report.js ----------

test('release-report: 55 tickets with the done label: the command builds the report and the runner copies back one short line', async () => {
  const r = await dryRun({ file: RELEASE, args: { base: 'release/0.1.0' }, env: { FAKE_ISSUES: '55' } });
  clean(r);
  onlyTheCommand(r);
  assert.ok(r.result && !r.result.stopped, JSON.stringify(r.result && r.result.stopped));
  assert.equal(r.result.mergedCount, 55);
  assert.deepEqual(r.result.notes.filter((n) => /could not be read|not built/.test(n)), []);
  assert.equal(r.result.reportFile, '.claude/worktrees/release-report-release-0.1.0.md');
  const file = fs.readFileSync(path.join(r.dir, r.result.reportFile), 'utf8');
  assert.equal([...file.matchAll(/^Closes #\d+$/gm)].length, 55);
  assert.match(file, /- #55 «Ticket 55 with a title ñ · é»: last run comment «PASS and merged into release\/0\.1\.0 \(abc0055\)», rounds 1\/2/);
  assert.match(r.result.reportSum, /^\d+\.\d+$/);
  assert.deepEqual(r.left.filter((f) => f.startsWith('tmp-')), [], 'the pieces and the reads are removed');
  assert.equal(r.seen.runnerCalls, 1, 'one call builds the report');
  assert.deepEqual(r.result.commandsForTheHuman, [
    'git push -u origin release/0.1.0',
    'gh pr create -R SergioLizana/Dynamo --base main --head release/0.1.0 --title "Release 0.1.0" --body-file .claude/worktrees/release-report-release-0.1.0.md',
  ]);
});

test('release-report: alone with no args it reads the working branch from factory.json (the command does)', async () => {
  const r = await dryRun({ file: RELEASE, args: null, env: { FAKE_ISSUES: '3', FAKE_PR: '1', FAKE_REMOTE: 'abc1234' } });
  clean(r);
  assert.equal(r.result.base, 'release/0.1.0');
  assert.equal(r.result.mergedCount, 3);
  assert.deepEqual(r.result.pullRequest, { number: 12, url: 'https://github.com/SergioLizana/Dynamo/pull/12' });
  assert.deepEqual(r.result.commandsForTheHuman, ['gh pr edit 12 -R SergioLizana/Dynamo --body-file .claude/worktrees/release-report-release-0.1.0.md']);
  assert.equal(r.result.baseOnRemote, true);
  assert.equal(r.result.needsHumanCount, 1);
  assert.match(r.result.notes.join('\n'), /`gh pr edit` replaces the body of PR #12/);
});

test('release-report: what the command could not read comes back as notes with their text', async () => {
  const r = await dryRun({ file: RELEASE, args: 'release/0.1.0', env: { FAKE_ISSUES: '3', FAKE_GH_FAIL: 'comments', FAKE_REMOTE: 'ffff000' } });
  clean(r);
  const notes = r.result.notes.join('\n');
  assert.match(notes, /the tickets and their comments could not be read \(exit code 1\)/);
  assert.match(notes, /the remote release\/0\.1\.0 is at ffff000 and release\/0\.1\.0 here at abc1234, with no commit to push/);
});

test('release-report: the results of a run travel in pieces and reach the report, with the cleanup of the run in the same call', async () => {
  const results = [
    { number: 5, status: 'blocked', reason: 'it needs a decision: ñ · é\n```js\nconst x = 1\n```' },
    { number: 6, status: 'skipped', note: 'its blocker was blocked' },
    { number: 2, status: 'done', mergeCommit: 'abc1234' },
  ];
  const cleanup = ['git worktree prune', 'git worktree list'];
  const r = await dryRun({ file: RELEASE, args: { base: 'release/0.1.0', runner: { maxCommand: 1100, maxOutput: 400, maxLine: 400 }, results, cleanup }, env: { FAKE_ISSUES: '3' }, limits: { maxCommand: 1100, maxOutput: 400 } });
  clean(r);
  assert.equal(r.seen.runnerCalls, 1);
  assert.deepEqual(r.result.cleanupResults.map((c) => c.command), cleanup);
  assert.ok(r.seen.commands.filter((c) => /read\.js put results/.test(c)).length >= 1);
  const file = fs.readFileSync(path.join(r.dir, r.result.reportFile), 'utf8');
  assert.match(file, /### Blocked in this run\n\n- #5: it needs a decision: ñ · é ```js const x = 1 ```/);
  assert.match(file, /### Skipped in this run\n\n- #6: its blocker was blocked/);
  assert.deepEqual(r.result.notes.filter((n) => /the run merged/.test(n)), []);
});

test('release-report: a runner that changes one character of the short line: it is asked again, and the second line is the one used', async () => {
  const r = await dryRun({ file: RELEASE, args: { base: 'release/0.1.0' }, env: { FAKE_ISSUES: '3' }, garble: alterLine('node .claude/workflows/lib/read.js release', false) });
  clean(r);
  assert.equal(r.result.mergedCount, 3);
  assert.ok(r.result.reportFile);
  assert.equal(r.seen.runnerCalls, 2, 'one more call, for the line that did not match');
});

test('release-report: a runner that always changes one character of the short line: nothing is built from it', async () => {
  const r = await dryRun({ file: RELEASE, args: { base: 'release/0.1.0' }, garble: alterLine('node .claude/workflows/lib/read.js release', true) });
  clean(r);
  assert.equal(r.result.reportFile, null);
  assert.deepEqual(r.result.commandsForTheHuman, []);
  assert.equal(r.result.mergedCount, undefined);
  assert.match(r.result.notes.join('\n'), /does not have its own hash and length/);
});

test('release-report: a runner that changes one character of the command it runs: it is not trusted', async () => {
  const r = await dryRun({ file: RELEASE, args: { base: 'release/0.1.0' }, mutate: (command) => (command.includes(' release ') ? command.replace('release/0.1.0', 'release/0.1.1') : command) });
  clean(r);
  assert.equal(r.result.reportFile, null);
  assert.match(r.result.notes.join('\n'), /the release command was run as another command/);
});

test('release-report: a piece of the results that the runner altered fails by itself, and the report is not built', async () => {
  const results = [{ number: 5, status: 'blocked', reason: 'x'.repeat(250) }];
  const r = await dryRun({
    file: RELEASE, args: { base: 'release/0.1.0', runner: { maxCommand: 1100, maxOutput: 400, maxLine: 400 }, results },
    mutate: (command) => (/read\.js put results 1 /.test(command) ? command.replace(/(put results 1 )(.)/, (_, a, c) => a + (c === 'A' ? 'B' : 'A')) : command),
  });
  clean(r);
  assert.equal(r.result.reportFile, null);
  assert.match(r.result.notes.join('\n'), /piece 1 of \d+ was run as another command/);
});

test('release-report: the base that is the main branch stops with the reason', async () => {
  const r = await dryRun({ file: RELEASE, args: { base: 'main' } });
  clean(r);
  assert.match(r.result.stopped, /the base is the main branch/);
});

// ---------- board.js ----------

test('board: the open tickets (100) come back one short line each, and the factory in short parts', async () => {
  const r = await dryRun({ file: BOARD, args: {} });
  clean(r);
  onlyTheCommand(r);
  assert.ok(r.result && !r.result.stopped, JSON.stringify(r.result && r.result.stopped));
  assert.equal(r.result.tickets.length, 100);
  assert.equal(r.result.mainFolder.problem, null);
  assert.equal(r.result.tickets[0].title, 'Ticket 1 with a title that is long enough to weigh something, with non-ASCII text: ñ · é');
  assert.deepEqual(r.result.tickets[0].blockers, [{ number: 1, state: 'CLOSED', labels: ['in-release'] }]);
  assert.deepEqual(r.result.factory, r.factory, 'factory.json came back whole');
  assert.match(r.result.table, /^Ready on release\/0\.1\.0: \d+ of 100 tickets/);
});

test('board: 45 requested tickets are read by number, one line each', async () => {
  const wanted = Array.from({ length: 45 }, (_, i) => i + 1);
  const r = await dryRun({ file: BOARD, args: { tickets: wanted } });
  clean(r);
  assert.ok(r.result && !r.result.stopped, JSON.stringify(r.result && r.result.stopped));
  assert.deepEqual(r.result.tickets.map((t) => t.number), wanted);
  assert.equal(r.seen.commands.filter((c) => c.includes('read.js tickets')).length, 1, 'one query for all of them');
});

test('board: the main folder with changes in tracked files is a problem, and the table still shows', async () => {
  const r = await dryRun({ file: BOARD, args: { tickets: [3] }, env: { FAKE_DIRTY: '1' } });
  clean(r);
  assert.match(r.result.mainFolder.problem, /the main folder has 2 changes in tracked files/);
  assert.match(r.result.table, /Main folder, not ready for a run/);
});

test('board: under the shortest limits, with long titles cut to fit, it still reads everything', async () => {
  const r = await dryRun({ file: BOARD, args: {}, limits: { maxCommand: 1100, maxOutput: 400, maxLine: 240 }, env: { FAKE_LONG_TITLE: '1' } });
  clean(r);
  assert.equal(r.result.tickets.length, 100);
  assert.ok(r.result.tickets[0].title.endsWith('…'), 'a title that did not fit is cut and says so');
});

test('board: a runner that changes one character of one line, once: that line is asked again', async () => {
  const r = await dryRun({ file: BOARD, args: {}, garble: alterLine('node .claude/workflows/lib/read.js ticket 5', false, (o) => o.replace('Ticket', 'Tickex')) });
  clean(r);
  assert.equal(r.result.tickets.length, 100);
  assert.equal(r.result.tickets[4].title.startsWith('Ticket 5'), true);
  assert.ok(r.seen.labels.some((l) => /again/.test(l)), 'the altered line was asked again');
});

test('board: a runner that changes one character of a part of factory.json: that part is asked again', async () => {
  const r = await dryRun({ file: BOARD, args: { tickets: [1] }, garble: alterLine('node .claude/workflows/lib/read.js factory 2', false, (o) => o.replace(/data=(.)/, (_, c) => `data=${c === 'A' ? 'B' : 'A'}`)) });
  clean(r);
  assert.ok(r.result && !r.result.stopped, JSON.stringify(r.result && r.result.stopped));
  assert.deepEqual(r.result.factory, r.factory);
});

test('board: a runner that always changes one character of the line of a ticket: nothing is built from it', async () => {
  const r = await dryRun({ file: BOARD, args: { tickets: [1, 2] }, garble: alterLine('node .claude/workflows/lib/read.js ticket 2', true, (o) => o.replace('Ticket', 'Tickex')) });
  clean(r);
  assert.match(r.result.stopped, /the tickets could not be read: number 2 of 2 did not come back right in 3 tries/);
  assert.equal(r.result.tickets, undefined);
});

test('board: a ticket with two blockers keeps both', async () => {
  const r = await dryRun({ file: BOARD, args: { tickets: [1] }, env: { FAKE_BLOCKERS: '2' } });
  clean(r);
  assert.ok(r.result.tickets.length === 1 && r.result.tickets[0].blockers.length === 2);
});

// ---------- run.js: a long comment ----------

// A ticket that stops at the Builder with a long reason: its block comment is long, multi-line, with code fences and
// characters outside ASCII (the three things that did not survive the runner's hand copy).
const LONG = [
  'The ticket cannot be done without a decision.',
  '```js', 'const throwaway = "ñ · é — 日本語 😀"', '```',
  ...Array.from({ length: 60 }, (_, i) => `line ${i}: ${'x'.repeat(30)} throwaway ${i} · ñ`),
].join('\n');

async function runLongComment(extra = {}) {
  const reportArgs = [];
  const r = await dryRun({
    file: RUN, args: { tickets: [75] },
    workflow: async (spec, a, { factory }) => {
      if (spec.scriptPath.endsWith('board.js')) {
        return { factory, base: 'release/0.1.0', wanted: [75], mainFolder: { problem: null },
          tickets: [{ number: 75, title: 'Long text never travels through the runner by hand', state: 'OPEN', labels: [], status: 'Todo', blockers: [] }] };
      }
      reportArgs.push(a);
      return { notes: [], cleanupResults: [], report: 'r', pullRequest: null, baseOnRemote: null, remote: null, reportFile: null, commandsForTheHuman: [] };
    },
    agent: async (prompt, opts) => ({ worktreePath: '', worktreeBranch: '', branch: '', commit: null, needsHuman: true, needsHumanReason: LONG, published: [], noTrace: [], outOfTicket: [] }),
    ...extra,
  });
  return { ...r, reportArgs };
}

const posted = (r) => r.posts.filter((p) => p.n === '75');
// The call of the runner that carries the comment is the third: the card to Build, what is left, the comment.
const POST_CALL = 3;

test('run: a long comment is posted once, whole, and confirmed by its hash and length', async () => {
  const r = await runLongComment();
  clean(r);
  assert.equal(posted(r).length, 1);
  const body = posted(r)[0].body;
  assert.ok(body.length > 3000, `the comment is long (${body.length})`);
  assert.ok(body.includes('const throwaway = "ñ · é — 日本語 😀"') && body.includes('line 59:'), 'text, code fence and non-ASCII are whole');
  assert.deepEqual(r.result.tickets[0].notes || [], []);
  assert.equal(r.result.tickets[0].status, 'blocked');
  assert.deepEqual(r.reportArgs[0].runner, r.factory.runner, 'the limits travel to the report');
});

test('run: a runner that alters one character of one piece, once: the comment is posted once, right', async () => {
  const r = await runLongComment({ mutate: alterPiece(2, false) });
  clean(r);
  assert.equal(posted(r).length, 1);
  assert.ok(posted(r)[0].body.includes('line 59:'));
  assert.deepEqual(r.result.tickets[0].notes || [], []);
});

test('run: a runner that always alters a piece: the comment is not posted and the note says which piece', async () => {
  const r = await runLongComment({ mutate: alterPiece(2, true) });
  clean(r);
  assert.equal(posted(r).length, 0);
  assert.match((r.result.tickets[0].notes || []).join('\n'), /was not posted: piece 2 of \d+ was run as another command/);
});

test('run: a runner that alters the hash of the whole: not posted', async () => {
  const r = await runLongComment({
    mutate: (command) => (command.includes('base64 --decode') ? command.replace(/= "(\d)/, '= "9$1') : command),
  });
  clean(r);
  assert.equal(posted(r).length, 0);
  assert.match((r.result.tickets[0].notes || []).join('\n'), /was not posted: the command that posts was run as another command/);
});

test('run: a runner that copies the hash of the last comment wrong: posted once, and the note says the hash differs', async () => {
  const r = await runLongComment({ garble: (output, command) => (command.includes('--json comments') ? '12345 678' : output) });
  clean(r);
  assert.equal(posted(r).length, 1);
  assert.match((r.result.tickets[0].notes || []).join('\n'), /could not be confirmed to be the script's report: its hash and length \(12345 678\) are not the report's/);
});

test('run: a runner that reads back another ticket: posted once, and the note says the hash could not be read', async () => {
  const r = await runLongComment({ mutate: (command) => (command.includes('--json comments') ? command.replace('issue view 75', 'issue view 76') : command) });
  clean(r);
  assert.equal(posted(r).length, 1);
  assert.match((r.result.tickets[0].notes || []).join('\n'), /could not be confirmed to be the script's report: its hash and length could not be read/);
});

test('run: the answer of the call that posted is lost: the last comment is read and nothing is posted twice', async () => {
  const r = await runLongComment({ lose: (call) => call === POST_CALL });
  clean(r);
  assert.equal(posted(r).length, 1);
  assert.deepEqual(r.result.tickets[0].notes || [], []);
});

test('run: every answer after the post is lost: posted once, and the note says it may not have been', async () => {
  const r = await runLongComment({ lose: (call) => call >= POST_CALL });
  clean(r);
  assert.equal(posted(r).length, 1);
  assert.match((r.result.tickets[0].notes || []).join('\n'), /may not have been posted/);
});

test('run: under the smallest limits the long comment still goes out whole', async () => {
  const r = await runLongComment({ limits: { maxCommand: 1100, maxOutput: 400 } });
  clean(r);
  assert.equal(posted(r).length, 1);
  assert.ok(posted(r)[0].body.includes('line 59:'));
});

// ---------- permissions ----------

// todo: the allow rules for the new shapes (the stored reads, the pages, the pieces, the fingerprints) are not in
// .claude/settings.json yet: a session cannot edit its own permissions, so the human adds them (the failure prints the
// shapes). Until then a real run asks permission for them. Remove `todo` once they are in.
test('every command the three scripts sent matches a rule in .claude/settings.json', { todo: 'the allow rules for the new command shapes are for the human to add' }, () => {
  const allow = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'settings.json'), 'utf8')).permissions.allow
    .filter((r) => r.startsWith('Bash(')).map((r) => r.slice(5, -1));
  const regex = (rule) => new RegExp(`^${rule.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 's');
  const rules = allow.map(regex);
  const unmatched = [...new Set(everyCommand)].filter((c) => !rules.some((re) => re.test(c)));
  // One line per shape (the numbers and the base64 text are not part of it), so the list is the rules to write.
  const shapes = [...new Set(unmatched.map((c) => c.replace(/printf %s [A-Za-z0-9+/=]+/g, 'printf %s B64').replace(/\d+/g, '#').slice(0, 220)))];
  assert.deepEqual(shapes, []);
});

// ---------- helpers ----------

// A runner that changes one character of the chunk of the nth piece of a text (the 1st chunk it meets with that number in
// its file name), every time (`always`) or only the first.
function alterPiece(k, always) {
  let done = false;
  const name = new RegExp(`\\.${String(k).padStart(3, '0')}\\b`);
  return (command) => {
    if (!command.includes('printf %s ') || !name.test(command) || (done && !always)) return command;
    done = true;
    return command.replace(/(printf %s )(.)/, (_, a, c) => a + (c === 'A' ? 'B' : 'A'));
  };
}
