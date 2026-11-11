import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelOf, levelsOf, LEVELS, STARTING } from '../levels.ts';

test('a project with no levels gives the starting values of low, medium and high', () => {
  for (const project of [{}, { levels: {} }, { levels: undefined }]) {
    const got = levelsOf(project);
    assert.deepEqual(got.low, { builder: { model: 'sonnet', effort: 'low' }, reviewer: { model: 'sonnet', effort: 'medium' } });
    assert.deepEqual(got.medium, { builder: { model: 'sonnet', effort: 'medium' }, reviewer: { model: 'sonnet', effort: 'high' } });
    assert.deepEqual(got.high, { builder: { model: 'sonnet', effort: 'high' }, reviewer: { model: 'opus', effort: null } });
  }
  assert.deepEqual(LEVELS, ['low', 'medium', 'high']);
});

test('a project that changes one level gets its values there and the starting ones for the rest', () => {
  const got = levelsOf({ levels: { medium: { builder: { model: 'opus', effort: 'max' }, reviewer: { model: 'opus', effort: 'xhigh' } } } });
  assert.deepEqual(got.medium, { builder: { model: 'opus', effort: 'max' }, reviewer: { model: 'opus', effort: 'xhigh' } });
  assert.deepEqual(got.low, STARTING.low);
  assert.deepEqual(got.high, STARTING.high);
});

test('a level that sets only some values keeps the starting ones for the others', () => {
  const got = levelsOf({ levels: { low: { reviewer: { effort: 'high' } }, high: { builder: { model: 'opus' } } } });
  assert.deepEqual(got.low, { builder: STARTING.low.builder, reviewer: { model: 'sonnet', effort: 'high' } });
  assert.deepEqual(got.high.builder, { model: 'opus', effort: 'high' });
  assert.deepEqual(got.high.reviewer, STARTING.high.reviewer);
});

test('levelsOf refuses what is not a level, a model or an effort, and names the key', () => {
  assert.throws(() => levelsOf({ levels: [] }), /project.levels/);
  assert.throws(() => levelsOf({ levels: { extreme: {} } }), /project.levels.extreme/);
  assert.throws(() => levelsOf({ levels: { low: 3 } }), /project.levels.low/);
  assert.throws(() => levelsOf({ levels: { low: { tester: {} } } }), /project.levels.low.tester/);
  assert.throws(() => levelsOf({ levels: { low: { builder: { model: '' } } } }), /project.levels.low.builder.model/);
  assert.throws(() => levelsOf({ levels: { low: { builder: { effort: 'huge' } } } }), /project.levels.low.builder.effort/);
});

test('levelOf reads the Level: line of the body: low, medium or high', () => {
  for (const level of LEVELS) assert.equal(levelOf(`## Problem\nx\n\nLevel: ${level}\n\nSpec: #1`), level);
  assert.equal(levelOf('Level: low'), 'low');
  assert.equal(levelOf('Level:medium  \r\nSpec: #1'), 'medium');
});

test('levelOf gives high for a body with no Level: line, or one that is not a level', () => {
  for (const body of [null, '', 'Spec: #1', 'Level: extreme', 'Level: ', 'the Level: low is in the middle of a line', 'Level: low high']) {
    assert.equal(levelOf(body), 'high', String(body));
  }
});
