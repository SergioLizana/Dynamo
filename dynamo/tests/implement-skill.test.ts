// The checkboxes of tickets #84 and #85 that a grep can check, over .claude/skills/implement/SKILL.md: /implement does
// its GitHub and git steps through the dynamo subcommands and by hand through none, takes only the ticket number, posts
// its comment without the fence of the template, and stays about 150 lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const skill = readFileSync(join(root, '.claude', 'skills', 'implement', 'SKILL.md'), 'utf8');

test('the skill uses board, card, verify, merge and comment', () => {
  for (const name of ['board', 'card', 'verify', 'merge', 'comment']) {
    assert.match(skill, new RegExp(`node dynamo/dynamo\\.ts ${name}\\b`), `no call to dynamo ${name}`);
  }
});

test('the skill does none of those steps by hand', () => {
  for (const by_hand of ['item-edit', 'issue comment', 'git merge', 'git revert', '--add-label', 'blocked_by']) {
    assert.ok(!skill.includes(by_hand), `the skill still names «${by_hand}»`);
  }
});

test('the skill takes only the ticket number: no base argument', () => {
  assert.match(skill, /^argument-hint: <ticket number>\r?$/m);
  assert.ok(!skill.includes('$1'), 'the skill still names $1');
});

test('the skill says the step 6 comment goes without the fence of its template', () => {
  assert.match(skill, /without the ```text fence/);
});

test('launching one ticket documents no other base', () => {
  const launch = readFileSync(join(root, 'documentation', 'launch-one-ticket.md'), 'utf8');
  assert.ok(!launch.includes('release/0.0.0'), 'launch-one-ticket.md still names release/0.0.0');
});

test('the skill is at most about 150 lines', () => {
  assert.ok(skill.split('\n').length <= 150, `${skill.split('\n').length} lines`);
});
