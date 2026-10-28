// Run with: node --test .claude/hooks/
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const hook = path.join(__dirname, 'outside-writes.js');
const cwd = path.resolve(__dirname, '..', '..');
const scratch = path.join(os.tmpdir(), 'claude', 'test', 'scratchpad').replace(/\\/g, '/');

function run(command, dir = cwd) {
  return spawnSync('node', [hook], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: dir }), encoding: 'utf8' });
}

const refused = [
  'touch ../outside-test',
  'touch ../../../../../outside-test',
  'mkdir /outside-dir',
  'echo x > ../outside.txt',
  'echo x >> ../outside.txt',
  'rm -f /outside-file',
  'cd .. && touch outside',
  'cp README.md ../outside-copy',
  'mv README.md /outside-moved',
  "sh -c 'touch ../outside'",
  'echo $(touch ../outside)',
  "sed -i 's/a/b/' ../outside.txt",
  'cat > ../x <<EOF\nbody\nEOF',
  'echo ok\ntouch ../outside',
  'touch $UNSET_VARIABLE_X/file',
  'touch ~/outside-from-home',
  `node -e "require('fs').writeFileSync('${os.homedir().replace(/\\/g, '/')}/outside','')"`,
  'git clone https://example.invalid/r.git ../outside-clone',
  'find .. -delete',
  'tar -czf ../outside.tgz .',
  'curl -o ../outside.txt https://example.invalid',
  'mktemp',
];

const allowed = [
  'touch inside-test',
  'mkdir -p sub/dir',
  'echo x > inside.txt',
  'echo x > /dev/null',
  'ls ..',
  'cat ../README.md',
  'git status',
  'git log --oneline',
  'echo a 2>&1',
  'gh issue view 70 -R SergioLizana/Dynamo',
  'cat > .claude/x.txt <<\'EOF\'\nthe body mentions > ../elsewhere and rm /x\nEOF',
  `touch ${scratch}/a.txt`,
  `cp README.md ${scratch}/copy.md`,
  'rm -f ./inside-test',
  "sh -c 'touch inside'",
  'cd . && touch inside',
  'git commit -m "msg with > redirect text"',
  'echo "a > b"',
  "node -e \"console.log(1)\"",
  "sh -c 'printf %s abc | base64 --decode | { mkdir -p .claude/worktrees; cat > .claude/worktrees/release-report-x.md; }'",
  "sh -c 'git worktree remove --force .claude/worktrees/x || true'",
  'git worktree add -b ticket/1-x .claude/worktrees/x release/0.1.0',
  `sh -c 'cd ${cwd.replace(/\\/g, '/')} && claude plugin validate . --strict'`,
];

for (const c of refused) {
  test(`refuses: ${c}`, () => {
    const r = run(c);
    assert.strictEqual(r.status, 2, r.stderr);
    assert.match(r.stderr, /Refused/);
  });
}

for (const c of allowed) {
  test(`allows: ${c}`, () => {
    const r = run(c);
    assert.strictEqual(r.status, 0, r.stderr);
  });
}

test('a tool other than Bash is left alone', () => {
  const r = spawnSync('node', [hook], { input: JSON.stringify({ tool_name: 'Read', tool_input: {}, cwd }), encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
});

test('an unreadable input is refused', () => {
  const r = spawnSync('node', [hook], { input: 'not json', encoding: 'utf8' });
  assert.strictEqual(r.status, 2);
});
