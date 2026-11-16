// The selector's answer applied to the checks (selection.ts): pure, so a table of cases, one test each.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SKIPPED, applySelection, assemble, selectorPrompt } from '../selection.ts';

const COMMANDS = ['node --test dynamo/tests/*.test.ts', 'git diff --check <base>'];
const AS_IS = COMMANDS.map((command) => ({ command, run: command }));
const unchanged = { action: 'unchanged' };

const cases: { name: string; answer: unknown; plan: { command: string; run: string | null }[] }[] = [
  { name: 'unchanged: both run as the project wrote them', answer: { checks: [unchanged, unchanged] }, plan: AS_IS },
  {
    name: 'narrowed: the check runs the command the selector gave, `<base>` and all',
    answer: { checks: [{ action: 'narrowed', command: 'node --test dynamo/tests/a.test.ts' }, { action: 'narrowed', command: 'git diff --check <base> -- a.ts' }] },
    plan: [{ command: COMMANDS[0], run: 'node --test dynamo/tests/a.test.ts' }, { command: COMMANDS[1], run: 'git diff --check <base> -- a.ts' }],
  },
  { name: 'skipped: the check does not run', answer: { checks: [{ action: 'skipped' }, unchanged] }, plan: [{ command: COMMANDS[0], run: null }, AS_IS[1]] },
  {
    name: 'another program: a narrowed command that does not start with the original\'s program leaves the original (the others still apply)',
    answer: { checks: [{ action: 'narrowed', command: 'npm test -- a' }, { action: 'skipped' }] },
    plan: [AS_IS[0], { command: COMMANDS[1], run: null }],
  },
  { name: 'a narrowed command that is empty or missing leaves the original', answer: { checks: [{ action: 'narrowed', command: '  ' }, { action: 'narrowed' }] }, plan: AS_IS },
  { name: 'an entry that is not one of the three actions leaves the original', answer: { checks: [{ action: 'run-faster' }, 'skipped'] }, plan: AS_IS },
  { name: 'an invalid answer: null', answer: null, plan: AS_IS },
  { name: 'an invalid answer: text', answer: 'skip everything', plan: AS_IS },
  { name: 'an invalid answer: no list of checks', answer: { checks: 'all' }, plan: AS_IS },
  { name: 'an invalid answer: fewer entries than checks leaves them all, even those it skipped', answer: { checks: [{ action: 'skipped' }] }, plan: AS_IS },
  { name: 'an invalid answer: more entries than checks', answer: { checks: [{ action: 'skipped' }, { action: 'skipped' }, { action: 'skipped' }] }, plan: AS_IS },
];

for (const c of cases) {
  test(`applySelection — ${c.name}`, () => {
    assert.deepEqual(applySelection(COMMANDS, c.answer), c.plan);
  });
}

test('assemble puts what ran and what was skipped back in the order of the checks; a skipped one passes in no time', () => {
  const ran = [{ command: 'node --test a.test.ts', code: 1, output: 'boom', seconds: 2.5 }];
  const plan = [{ command: 'git diff --check <base>', run: null }, { command: 'node --test', run: 'node --test a.test.ts' }];
  assert.deepEqual(assemble(plan, ran), [{ command: 'git diff --check <base>', code: 0, output: SKIPPED, seconds: 0, skipped: true }, ran[0]]);
  assert.equal(SKIPPED, 'skipped by the selector');
});

test('selectorPrompt lists the changed files and every check, numbered in order', () => {
  const text = selectorPrompt('abc123', ['a.ts', 'b/c.ts'], COMMANDS);
  assert.match(text, /against abc123 \(2\)/);
  assert.match(text, /^- a\.ts\n- b\/c\.ts$/m);
  assert.match(text, /^1\. node --test dynamo\/tests\/\*\.test\.ts\n2\. git diff --check <base>$/m);
});
