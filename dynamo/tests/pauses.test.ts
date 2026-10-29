// The comment of a paused ticket (pauses.ts): data in, text out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pausedComment, rawEnd } from '../pauses.ts';
import type { Paused } from '../pauses.ts';

const paused: Paused = {
  stoppedAt: 'build', reason: 'the Builder ended in a way dynamo does not know: usage limit', round: 1,
  log: '.claude/worktrees/logs/91/builder-1.jsonl', raw: '{"type":"result","subtype":"error_unknown"}',
  left: { copy: '/w/ticket-91', branch: 'ticket/91-x' },
};

test('rawEnd keeps the last lines of a log, drops the blank end, and cuts a long end to its last characters', () => {
  assert.equal(rawEnd('a\nb\nc\n\n', 2), 'b\nc');
  assert.equal(rawEnd('a\r\nb\r\n'), 'a\nb');
  assert.equal(rawEnd(''), '');
  assert.equal(rawEnd('x'.repeat(50) + 'END', 6, 10), '…xxxxxxxEND');
});

test('pausedComment says paused, why, the raw end of the agent, and how to relaunch the list', () => {
  const lines = pausedComment(paused, 91).split('\n');
  assert.equal(lines[0], 'run · paused');
  assert.ok(lines.includes('Paused at: build'));
  assert.ok(lines.includes('Rounds: 1/2 (a pause spends no round; the card stays where it is, not in Needs Human)'));
  assert.ok(lines.includes('Reason: the Builder ended in a way dynamo does not know: usage limit'));
  assert.ok(lines.includes('Left: the copy /w/ticket-91 and the branch ticket/91-x'));
  assert.ok(lines.includes('Raw end of the agent (the whole log is in .claude/worktrees/logs/91/builder-1.jsonl):'));
  const fence = lines.indexOf('```');
  assert.equal(lines[fence + 1], '{"type":"result","subtype":"error_unknown"}');
  assert.equal(lines[fence + 2], '```');
  const relaunch = lines.find((l) => l.startsWith('To relaunch:')) ?? '';
  assert.match(relaunch, /git worktree remove --force \/w\/ticket-91.*git branch -D ticket\/91-x.*dynamo run 91/);
});

test('pausedComment fences the raw end with more backticks than it holds, and with no copy has nothing to remove', () => {
  const lines = pausedComment({ ...paused, raw: 'a ```code``` b', left: null }, 5).split('\n');
  assert.equal(lines.filter((l) => l === '````').length, 2);
  assert.ok(lines.includes('Left: nothing'));
  assert.ok(!lines.some((l) => l.includes('worktree remove')));
  assert.match(lines.find((l) => l.startsWith('To relaunch:')) ?? '', /dynamo run 5/);
  assert.ok(pausedComment({ ...paused, raw: '' }, 1).includes('(the log is empty)'));
});
