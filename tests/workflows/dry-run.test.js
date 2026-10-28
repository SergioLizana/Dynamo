'use strict';
// Dry runs of the three workflow scripts with a `runner` played by a real shell (tests/workflows/harness.js), for ticket #75:
// long text never travels through the runner by hand. Run with: node --test tests/workflows/
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
  assert.deepEqual(r.seen.refused, [], 'the write guard refused a command');
  everyCommand.push(...r.seen.commands);
}

// ---------- release-report.js ----------

test('release-report: 55 tickets with the done label are read in pages and the report is built', async () => {
  const r = await dryRun({ file: RELEASE, args: { base: 'release/0.1.0' }, env: { FAKE_ISSUES: '55' } });
  clean(r);
  assert.ok(r.result && !r.result.stopped, JSON.stringify(r.result && r.result.stopped));
  assert.equal(r.result.merged.length, 55);
  assert.equal([...r.result.report.matchAll(/^Closes #\d+$/gm)].length, 55);
  assert.match(r.result.report, /- #55 «Ticket 55 with a title ñ · é»: last run comment «PASS and merged into release\/0\.1\.0 \(abc0055\)», rounds 1\/2/);
  assert.deepEqual(r.result.notes.filter((n) => /could not be read|not written/.test(n)), []);
  assert.ok(r.result.reportFile, 'the report file is confirmed');
  const file = fs.readFileSync(path.join(r.dir, r.result.reportFile), 'utf8');
  assert.equal(file, r.result.report);
  assert.deepEqual(r.left.filter((f) => f.startsWith('tmp-')), [], 'the pieces and the reads are removed');
  assert.ok(r.seen.runnerCalls > 5, 'the big read went in several calls');
});

test('release-report: under the smallest limits every command and output still fits', async () => {
  const r = await dryRun({ file: RELEASE, args: { base: 'release/0.1.0' }, limits: { maxCommand: 1100, maxOutput: 400 } });
  clean(r);
  assert.equal(r.result.merged.length, 55);
  assert.ok(r.result.reportFile);
});

test('release-report: a runner that changes one character of a page it copies back is asked again', async () => {
  let done = false;
  const r = await dryRun({
    file: RELEASE, args: { base: 'release/0.1.0' },
    garble: (output, command) => {
      if (done || !command.includes('cut -c') || output.length < 200) return output;
      done = true;
      return output.slice(0, 100) + (output[100] === 'A' ? 'B' : 'A') + output.slice(101);
    },
  });
  clean(r);
  assert.ok(done, 'one page was altered');
  assert.equal(r.result.merged.length, 55);
  assert.ok(r.result.reportFile);
  assert.ok(r.seen.labels.some((l) => /again/.test(l)), 'the altered page was asked again');
});

test('release-report: a runner that always alters a piece of the report: the file is not confirmed and the note says which piece', async () => {
  const r = await dryRun({ file: RELEASE, args: { base: 'release/0.1.0' }, mutate: alterPiece(2, true) });
  clean(r);
  assert.equal(r.result.reportFile, null);
  assert.match(r.result.notes.join('\n'), /piece 2 of \d+ was run as another command/);
});

// ---------- board.js ----------

test('board: the open tickets (100, a big answer) are read in pages', async () => {
  const r = await dryRun({ file: BOARD, args: {} });
  clean(r);
  assert.ok(r.result && !r.result.stopped, JSON.stringify(r.result && r.result.stopped));
  assert.equal(r.result.tickets.length, 100);
  assert.equal(r.result.mainFolder.problem, null);
  assert.equal(r.result.tickets[0].title, 'Ticket 1 with a title that is long enough to weigh something, with non-ASCII text: ñ · é');
});

test('board: 45 requested tickets go in several queries, each command within the limit', async () => {
  const wanted = Array.from({ length: 45 }, (_, i) => i + 1);
  const r = await dryRun({ file: BOARD, args: { tickets: wanted } });
  clean(r);
  assert.ok(r.result && !r.result.stopped, JSON.stringify(r.result && r.result.stopped));
  assert.deepEqual(r.result.tickets.map((t) => t.number), wanted);
  assert.ok(r.seen.commands.filter((c) => c.includes('gh api graphql')).length > 1, 'more than one query');
});

test('board: under the smallest limits, and with one altered page, it still reads everything', async () => {
  let done = false;
  const r = await dryRun({
    file: BOARD, args: {}, limits: { maxCommand: 1100, maxOutput: 400 },
    garble: (output, command) => {
      if (done || !command.includes('cut -c') || output.length < 200) return output;
      done = true;
      return output.slice(0, 50) + output.slice(51);
    },
  });
  clean(r);
  assert.ok(done);
  assert.equal(r.result.tickets.length, 100);
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
