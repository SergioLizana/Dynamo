'use strict';
// The command .claude/workflows/lib/read.js (ticket #76), run as a process in a scratch copy of the repository with a fake
// `gh` and `git` (tests/workflows/fake-gh.js). Run with: node --test tests/workflows/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { scratch, fakeEnv, ROOT } = require('./harness.js');
const lib = require('../../.claude/workflows/lib/read.js');

const READ = path.join(ROOT, '.claude', 'workflows', 'lib', 'read.js');

function setup(extra = {}, limits) {
  const s = scratch();
  if (limits) {
    const f = path.join(s.dir, '.claude', 'factory.json');
    const json = JSON.parse(fs.readFileSync(f, 'utf8'));
    json.runner = { ...json.runner, ...limits };
    fs.writeFileSync(f, JSON.stringify(json, null, 2));
  }
  const env = fakeEnv(s, extra);
  const run = (...args) => {
    const p = spawnSync(process.execPath, [READ, ...args], { cwd: s.dir, env, encoding: 'utf8' });
    return { code: p.status, out: p.stdout, err: p.stderr, line: p.stdout.replace(/\n$/, '') };
  };
  return { ...s, run };
}

// The fields of a line whose hash and length are right, or null.
function parse(line) {
  const m = /^(.*) (\d+ \d+)$/.exec(line);
  if (!m || lib.cksum(Array.from(Buffer.from(m[1]))) !== m[2]) return null;
  const [kind, ...rest] = m[1].split(' ');
  return { kind, ...Object.fromEntries(rest.map((t) => [t.slice(0, t.indexOf('=')), decodeURIComponent(t.slice(t.indexOf('=') + 1))])) };
}
const maxLine = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'factory.json'), 'utf8')).runner.maxLine;

test('every line is one short ASCII line with the hash and length of the text before them', () => {
  const t = setup();
  for (const args of [['factory', '1'], ['folder'], ['tickets'], ['ticket', '1'], ['release', '-'], ['tidy']]) {
    const r = t.run(...args);
    assert.equal(r.code, 0, `${args.join(' ')}: ${r.line}`);
    assert.ok(r.line.length <= maxLine, `${args.join(' ')} printed ${r.line.length} characters`);
    assert.match(r.line, /^[\x20-\x7e]+$/, 'plain ASCII on one line');
    assert.ok(parse(r.line), `${args.join(' ')}: the hash and length are the line's own`);
    assert.equal(r.err, '');
  }
});

test('factory: the parts together are factory.json, and each part fits the line', () => {
  const t = setup();
  const first = parse(t.run('factory', '1').line);
  const n = Number(first.of);
  assert.ok(n > 1, 'factory.json does not fit one line');
  let b64 = '';
  for (let k = 1; k <= n; k++) { const p = parse(t.run('factory', String(k)).line); assert.equal(Number(p.part), k); b64 += p.data; }
  assert.equal(lib.sumOf(b64).replace(' ', '.'), first.whole);
  assert.equal(Buffer.from(b64, 'base64').toString('utf8'), fs.readFileSync(path.join(t.dir, '.claude', 'factory.json'), 'utf8'));
  assert.equal(parse(t.run('factory', String(n + 1)).line).data, '', 'a part past the end is empty');
});

test('folder: clean, and with changes in tracked files', () => {
  const clean = parse(setup().run('folder').line);
  assert.deepEqual([clean.status, clean.changes, clean.branch], ['ok', '0', 'release/0.1.0']);
  const dirty = parse(setup({ FAKE_DIRTY: '1' }).run('folder').line);
  assert.equal(dirty.changes, '2');
});

test('tickets: the open ones are written to a file and each one comes back as a line', () => {
  const t = setup();
  const s = parse(t.run('tickets').line);
  assert.equal(s.count, '100');
  const file = fs.readFileSync(path.join(t.dir, '.claude', 'worktrees', 'tmp-tickets.json'), 'utf8');
  assert.equal(lib.sumOf(file).replace(' ', '.'), s.file);
  const k = parse(t.run('ticket', '7').line);
  assert.equal(k.kind, 'ticket');
  assert.deepEqual([k.k, k.of, k.n, k.s, k.c, k.d, k.file, k.cut], ['7', '100', '7', 'OPEN', 'Todo', '0', s.file, '0']);
  assert.equal(k.b, '1:CLOSED:1');
  assert.equal(k.t, 'Ticket 7 with a title that is long enough to weigh something, with non-ASCII text: ñ · é');
});

test('tickets: the numbers asked for are the ones read, and a missing ticket is named', () => {
  const t = setup();
  assert.equal(parse(t.run('tickets', '38', '43').line).count, '2');
  assert.equal(parse(t.run('ticket', '2').line).n, '43');
  const bad = t.run('tickets', 'x');
  assert.equal(bad.code, 1);
  assert.match(parse(bad.line).reason, /x is not a ticket number/);
});

test('tickets: under the shortest line a long title is cut and says so, everything else stays', () => {
  const t = setup({ FAKE_LONG_TITLE: '1' }, { maxLine: 240 });
  t.run('tickets');
  const k = parse(t.run('ticket', '3').line);
  assert.equal(k.cut, '1');
  assert.ok(k.t.length > 20 && 'Ticket 3 with a title that is long enough to weigh something, with non-ASCII text: ñ · é and more words'.startsWith(k.t));
  assert.equal(k.b, '1:CLOSED:1');
  assert.ok(t.run('ticket', '3').line.length <= 240);
});

test('a line that would be longer than runner.maxLine even without its title is an error line, not a long line', () => {
  const t = setup({ FAKE_BLOCKERS: '20' }, { maxLine: 240 });
  t.run('tickets');
  const r = t.run('ticket', '1');
  assert.equal(r.code, 1);
  assert.ok(r.line.length <= 240);
  assert.match(parse(r.line).reason, /over runner\.maxLine \(240\)/);
});

test('put and release: the results of a run reach the report, and a piece that arrives wrong fails by itself', () => {
  const t = setup({ FAKE_ISSUES: '3' });
  const results = [
    { number: 5, status: 'blocked', reason: 'it needs a decision: ñ · é' },
    { number: 6, status: 'skipped', note: 'its blocker was blocked' },
    { number: 7, status: 'done', mergeCommit: 'abc1234' },
  ];
  const b64 = Buffer.from(JSON.stringify(results)).toString('base64');
  const half = Math.ceil(b64.length / 8) * 4;
  const chunks = [b64.slice(0, half), b64.slice(half)];
  const sum = (c) => lib.sumOf(c).split(' ');
  const wrong = t.run('put', 'results', '1', chunks[0].replace(/^./, (c) => (c === 'A' ? 'B' : 'A')), ...sum(chunks[0]));
  assert.equal(wrong.code, 1);
  assert.match(parse(wrong.line).reason, /piece 1 did not arrive as it was sent/);
  chunks.forEach((c, i) => assert.equal(t.run('put', 'results', String(i + 1), c, ...sum(c)).code, 0));
  const r = parse(t.run('release', 'release/0.1.0', 'results', lib.sumOf(b64).replace(' ', '.')).line);
  assert.equal(r.kind, 'release', JSON.stringify(r));
  assert.equal(r.merged, '3');
  const report = fs.readFileSync(path.join(t.dir, r.file), 'utf8');
  assert.match(report, /### Blocked in this run\n\n- #5: it needs a decision: ñ · é/);
  assert.match(report, /### Skipped in this run\n\n- #6: its blocker was blocked/);
  assert.match(r.notes, /unmerged:7:abc1234/, 'a merge the run reports and the log does not show');
  assert.deepEqual(fs.readdirSync(path.join(t.dir, '.claude', 'worktrees')).filter((f) => f.startsWith('tmp-results')), [], 'the pieces are removed');
  // pieces that do not add up are refused, and nothing is built
  t.run('put', 'results', '1', chunks[0], ...sum(chunks[0]));
  const short = t.run('release', 'release/0.1.0', 'results', lib.sumOf(b64).replace(' ', '.'));
  assert.equal(short.code, 1);
  assert.match(parse(short.line).reason, /do not add up/);
});

test('release: the report, the line and the file agree', () => {
  const t = setup({ FAKE_ISSUES: '55', FAKE_PR: '1', FAKE_REMOTE: 'abc1234def' });
  const r = t.run('release', 'release/0.1.0');
  const f = parse(r.line);
  assert.equal(r.code, 0);
  assert.equal(f.merged, '55');
  assert.equal(f.pr, '12');
  assert.equal(f.needs, '1');
  assert.equal(f.remote, 'up-to-date');
  assert.equal(f.notes, '');
  const buf = fs.readFileSync(path.join(t.dir, f.file));
  assert.equal(lib.sumOf(buf).replace(' ', '.'), f.sum, 'the hash and length in the line are the file\'s');
  const report = buf.toString('utf8');
  assert.equal([...report.matchAll(/^Closes #\d+$/gm)].length, 55);
  assert.match(report, /- #55 «Ticket 55 with a title ñ · é»: last run comment «PASS and merged into release\/0\.1\.0 \(abc0055\)», rounds 1\/2/);
  assert.match(report, /- #7: a thing seen in ñ · é/, 'the out of the ticket line');
  assert.match(report, /### Needs Human\n\n- #99 «A card in Needs Human»\n/);
  assert.match(report, /- `\/cost` of the session: \$4\.20/, 'the cost the human filled in stays');
});

test('release: what could not be read is a code in the line, never a failure of the whole', () => {
  const t = setup({ FAKE_ISSUES: '3', FAKE_GH_FAIL: 'comments', FAKE_MORE: '1' });
  const f = parse(t.run('release', '-').line);
  assert.equal(f.kind, 'release');
  assert.match(f.notes, /no-tickets:1/);
  assert.match(f.notes, /remote-missing:0/);
  const more = parse(setup({ FAKE_ISSUES: '3', FAKE_MORE: '1', FAKE_REMOTE: 'ffff000' }).run('release', '-').line);
  assert.match(more.notes, /more-tickets/);
  assert.match(more.notes, /remote-different:ffff000:abc1234/);
});

test('release: the main branch as a base, a base that does not exist and a missing factory.json stop with a reason', () => {
  const t = setup();
  assert.match(parse(t.run('release', 'main').line).reason, /the base is the main branch/);
  fs.rmSync(path.join(t.dir, '.claude', 'factory.json'));
  const r = t.run('folder');
  assert.equal(r.code, 1);
  assert.match(parse(r.line).reason, /factory\.json is missing/);
});

test('tidy removes what the command and the scripts left, and only that', () => {
  const t = setup();
  t.run('tickets');
  fs.writeFileSync(path.join(t.dir, '.claude', 'worktrees', 'release-report-x.md'), 'keep');
  assert.equal(parse(t.run('tidy').line).removed, '1');
  assert.deepEqual(fs.readdirSync(path.join(t.dir, '.claude', 'worktrees')), ['release-report-x.md']);
});

test('the fingerprint is the one `cksum` prints', () => {
  const p = spawnSync('cksum', { input: 'hello world\n', encoding: 'utf8' });
  if (p.status !== 0) return; // no cksum on this machine: the dry runs compare against a real shell's elsewhere
  assert.equal(lib.sumOf('hello world\n'), p.stdout.trim().split(/\s+/).slice(0, 2).join(' '));
});
