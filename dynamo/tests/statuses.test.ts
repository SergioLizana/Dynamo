import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LogFolder } from '../statuses.ts';
import { lastStep, statusOf, table } from '../statuses.ts';

const line = (value: unknown) => JSON.stringify(value);
const tool = (name: string, input: Record<string, unknown>) => line({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });
const said = (text: string) => line({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const result = (cost: number, turns: number) => line({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: cost, num_turns: turns });
const stream = (...l: string[]) => `${l.join('\n')}\n`;
const notes = (...n: Record<string, unknown>[]) => `${n.map((x) => line({ at: '2026-10-29T10:00:00Z', round: 1, ...x })).join('\n')}\n`;

test('the last step of a stream is its last tool call, or its last message', () => {
  assert.equal(lastStep(stream(said('Reading the ticket.'), tool('Read', { file_path: 'dynamo/run.ts' }))), 'Read dynamo/run.ts');
  assert.equal(lastStep(stream(tool('Bash', { command: 'node --test\n  dynamo/tests/' }), said('All\n  green.'))), 'All green.');
  assert.equal(lastStep(stream(line({ type: 'system' }), line({ type: 'user', message: { content: [] } }))), null);
  assert.equal(lastStep(stream(said('x'.repeat(200)))), `${'x'.repeat(79)}…`);
});

test('a row has the ticket, column, round, last step, turns and cost, from its notes and its agent logs', () => {
  const folders: LogFolder[] = [{
    ticket: 7,
    files: {
      'steps.jsonl': notes({ step: 'start' }, { step: 'column', column: 'Build' }, { step: 'agent', agent: 'builder' }, { step: 'column', column: 'Review' }),
      'builder-1.jsonl': stream(tool('Edit', { file_path: 'a.ts' }), result(1.5, 12)),
      'reviewer-1.jsonl': stream(tool('Grep', { pattern: 'needle' })),
    },
  }];
  const s = statusOf(folders);
  assert.deepEqual(s.rows, [{ ticket: 7, column: 'Review', round: 1, running: true, step: 'Grep needle', turns: 12, cost: 1.5 }]);
  assert.deepEqual([s.blocked, s.skipped], [[], []]);
});

test('an agent log with no result line is running, with its last step; with a result it is not', () => {
  const running = (files: Record<string, string>) => statusOf([{ ticket: 1, files }]).rows[0];
  assert.equal(running({ 'builder-1.jsonl': stream(said('Working on it.')) }).running, true);
  assert.equal(running({ 'builder-1.jsonl': stream(said('Working on it.')) }).step, 'Working on it.');
  assert.equal(running({ 'builder-1.jsonl': stream(said('Done.'), result(2, 4)) }).running, false);
});

test('a log that is still being written, its last line cut, is read without failing', () => {
  const cut = `${stream(said('First.'), tool('Edit', { file_path: 'a.ts' }))}{"type":"assistant","message":{"content":[{"type":"te`;
  const [row] = statusOf([{ ticket: 3, files: { 'builder-1.jsonl': cut, 'steps.jsonl': `${notes({ step: 'start' })}{"step":"col` } }]).rows;
  assert.equal(row.running, true);
  assert.equal(row.step, 'Edit a.ts');
  // A result line that is cut is no result yet.
  assert.equal(statusOf([{ ticket: 3, files: { 'builder-1.jsonl': `${stream(said('x'))}{"type":"result","total_cos` } }]).rows[0].running, true);
});

test('the latest agent of the latest round is the one shown, and turns and cost add up over every agent that ended', () => {
  const [row] = statusOf([{
    ticket: 4,
    files: {
      'steps.jsonl': notes({ step: 'column', column: 'Build', round: 2 }),
      'builder-1.jsonl': stream(said('one'), result(1, 10)),
      'reviewer-1.jsonl': stream(said('two'), result(0.5, 3)),
      'builder-2.jsonl': stream(said('three'), result(0.25, 5)),
    },
  }]).rows;
  assert.deepEqual(row, { ticket: 4, column: 'Build', round: 2, running: false, step: 'three', turns: 18, cost: 1.75 });
});

test('blocked tickets have a row and their reason; skipped ones only their reason; rows go by ticket number', () => {
  const s = statusOf([
    { ticket: 9, files: { 'steps.jsonl': notes({ step: 'skipped', text: 'blocker #8 stopped in this run' }) } },
    { ticket: 8, files: {
      'steps.jsonl': notes({ step: 'column', column: 'Needs Human', round: 2 }, { step: 'stopped', round: 2, text: 'the check failed twice' }),
      'builder-2.jsonl': stream(said('Never mind.')),
    } },
    { ticket: 2, files: { 'steps.jsonl': notes({ step: 'column', column: 'Done' }, { step: 'merged' }), 'builder-1.jsonl': stream(said('ok'), result(1, 2)) } },
  ]);
  assert.deepEqual(s.rows.map((r) => [r.ticket, r.column, r.round, r.running]), [[2, 'Done', 1, false], [8, 'Needs Human', 2, false]]);
  assert.deepEqual(s.blocked, [{ ticket: 8, reason: 'the check failed twice' }]);
  assert.deepEqual(s.skipped, [{ ticket: 9, why: 'blocker #8 stopped in this run' }]);
});

test('the table has a row per ticket, then the blocked and the skipped with their reason', () => {
  const s = statusOf([
    { ticket: 7, files: { 'steps.jsonl': notes({ step: 'column', column: 'Build' }), 'builder-1.jsonl': stream(tool('Edit', { file_path: 'a.ts' })) } },
    { ticket: 8, files: { 'steps.jsonl': notes({ step: 'stopped', text: 'budget spent' }) } },
    { ticket: 9, files: { 'steps.jsonl': notes({ step: 'skipped', text: 'blocker #8 stopped in this run' }) } },
  ]);
  assert.deepEqual(table(s), [
    'ticket  column  round  last step            turns  cost',
    '#7      Build   1      (running) Edit a.ts  0      $0.00',
    '#8      -       1      -                    0      $0.00',
    '',
    'Blocked:',
    '  #8: budget spent',
    '',
    'Skipped:',
    '  #9: blocker #8 stopped in this run',
  ]);
});
