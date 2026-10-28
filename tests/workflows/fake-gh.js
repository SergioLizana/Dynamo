#!/usr/bin/env node
// A stand-in for `gh` and `git` in the dry runs of the workflow scripts (tests/workflows/dry-run.test.js). It answers the
// commands the scripts send with fixtures, and records what is posted. State is in the folder FAKE_STATE:
//   posts.jsonl      one line per `gh issue comment` (the ticket and the body it received on stdin)
//   last-<n>         the body of the last comment of ticket n
//   card-<n>         the column the card of ticket n was moved to
// FAKE_ISSUES is how many tickets carry the done label, FAKE_OPEN how many open tickets the board query returns.
// FAKE_MORE=1 says there are more done tickets than the page, FAKE_PR=1 gives the release an open PR, FAKE_REMOTE is the
// sha `git ls-remote` prints, FAKE_DIRTY makes `git status` list changes, FAKE_GH_FAIL=comments makes that query fail.
// It prints what `gh` and `git` print (raw JSON, no --jq): the filtering is done by the command under test.
'use strict';
const fs = require('fs');
const path = require('path');

const state = process.env.FAKE_STATE;
const [tool, ...argv] = process.argv.slice(2);
const out = (s) => process.stdout.write(s.endsWith('\n') || s === '' ? s : s + '\n');
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const read = (f) => { try { return fs.readFileSync(path.join(state, f), 'utf8'); } catch { return null; } };

function git() {
  const [sub, ...rest] = argv;
  const base = 'release/0.1.0';
  if (sub === 'status') return out(process.env.FAKE_DIRTY ? ' M .claude/factory.json\n M README.md' : '');
  if (sub === 'worktree' || sub === 'branch' && rest[0] === '--list') return out('');
  if (sub === 'branch' && rest[0] === '--show-current') return out(base);
  if (sub === 'rev-parse') return out('abc1234');
  if (sub === 'rev-list') return out('0');
  if (sub === 'ls-remote') return out(process.env.FAKE_REMOTE ? `${process.env.FAKE_REMOTE}\trefs/heads/${base}` : '');
  if (sub === 'log') {
    const n = Number(process.env.FAKE_ISSUES || 55);
    const lines = [];
    for (let i = n; i >= 1; i--) lines.push(`aaaaaaa bbbbbbb\tMerge ticket/${i}-slug into ${base} (#${i})`);
    return out(lines.join('\n'));
  }
  process.stderr.write(`fake git: not handled: ${argv.join(' ')}\n`);
  process.exit(1);
}

function ticket(n) {
  const blockers = Number(process.env.FAKE_BLOCKERS || 1);
  return {
    number: n, title: `Ticket ${n} with a title that is long enough to weigh something, with non-ASCII text: ñ · é${process.env.FAKE_LONG_TITLE ? ' and more words'.repeat(12) : ''}`, state: 'OPEN',
    labels: { totalCount: 2, nodes: [{ name: 'enhancement' }, { name: 'needs-review' }] },
    projectItems: { totalCount: 1, nodes: [{ fieldValueByName: { name: 'Todo' } }] },
    blockedBy: { totalCount: blockers, nodes: Array.from({ length: blockers }, (_, i) => ({ number: i + 1, state: 'CLOSED', labels: { totalCount: 1, nodes: [{ name: 'in-release' }] } })) },
  };
}

function gh() {
  const [area, sub] = argv;
  if (area === 'api' && sub === 'graphql') {
    const query = flag('-f') || '';
    const q = query.replace(/^query=/, '');
    if (q.includes('labels:["in-release"]')) {
      if (process.env.FAKE_GH_FAIL === 'comments') { process.stderr.write('fake gh: comments failed\n'); process.exit(1); }
      const n = Number(process.env.FAKE_ISSUES || 55);
      const nodes = [];
      for (let i = 1; i <= n; i++) {
        const body = `run · PASS and merged into release/0.1.0 (abc${String(i).padStart(4, '0')})\nRounds: 1/2\nOut of the ticket (for the backlog): ${i === 7 ? 'a thing seen in ñ · é' : 'nothing'}\n`;
        nodes.push({ number: i, title: `Ticket ${i} with a title ñ · é`, comments: { nodes: [{ body: 'an older comment' }, { body }, { body: 'a later comment that is not a run comment' }] } });
      }
      // like gh: the newest first
      return out(JSON.stringify({ data: { repository: { issues: { pageInfo: { hasNextPage: process.env.FAKE_MORE === '1' }, totalCount: n, nodes: nodes.reverse() } } } }));
    }
    const repository = {};
    const aliases = [...q.matchAll(/t(\d+): issue\(number:\d+\)/g)];
    if (aliases.length) for (const m of aliases) repository[`t${m[1]}`] = ticket(Number(m[1]));
    else repository.issues = { pageInfo: { hasNextPage: false }, nodes: Array.from({ length: Number(process.env.FAKE_OPEN || 100) }, (_, i) => ticket(i + 1)) };
    return out(JSON.stringify({ data: { repository } }));
  }
  if (area === 'project' && sub === 'item-list') {
    return out(JSON.stringify({ totalCount: 2, items: [
      { content: { number: 99 }, title: 'A card in Needs Human', status: 'Needs Human' },
      { content: { number: 98 }, title: 'A card in Todo', status: 'Todo' },
    ] }));
  }
  if (area === 'project' && sub === 'item-edit') {
    const url = flag('--url') || '';
    fs.writeFileSync(path.join(state, `card-${url.split('/').pop()}`), flag('--value'));
    return out('');
  }
  if (area === 'pr' && sub === 'list') {
    if (process.env.FAKE_PR !== '1') return out('[]');
    return out(JSON.stringify([{ number: 12, url: 'https://github.com/x/y/pull/12', body: 'Old body\n- `/cost` of the session: $4.20\n' }]));
  }
  if (area === 'issue' && sub === 'edit') return out('');
  if (area === 'issue' && sub === 'comment') {
    const n = argv[2];
    const body = fs.readFileSync(0, 'utf8');
    fs.appendFileSync(path.join(state, 'posts.jsonl'), JSON.stringify({ n, body }) + '\n');
    fs.writeFileSync(path.join(state, `last-${n}`), body);
    return out(`https://github.com/x/y/issues/${n}#issuecomment-1`);
  }
  if (area === 'issue' && sub === 'view') {
    const n = argv[2];
    if (argv.includes('projectItems')) {
      const col = read(`card-${n}`);
      return out(JSON.stringify({ projectItems: col ? [{ status: { name: col } }] : [] }));
    }
    if (argv.includes('comments')) {
      const last = read(`last-${n}`);
      return last === null ? out('') : out(last); // like `--jq .comments[-1].body`: the body and a line break
    }
  }
  process.stderr.write(`fake gh: not handled: ${argv.join(' ')}\n`);
  process.exit(1);
}

(tool === 'git' ? git : gh)();
