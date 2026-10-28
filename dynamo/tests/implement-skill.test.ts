// The checkboxes of ticket #84 that a grep can check, over .claude/skills/implement/SKILL.md: /implement does its GitHub
// and git steps through the dynamo subcommands and by hand through none, and it stays about 150 lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const skill = readFileSync(join(resolve(import.meta.dirname, '..', '..'), '.claude', 'skills', 'implement', 'SKILL.md'), 'utf8');

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

test('the skill is at most about 150 lines', () => {
  assert.ok(skill.split('\n').length <= 150, `${skill.split('\n').length} lines`);
});
