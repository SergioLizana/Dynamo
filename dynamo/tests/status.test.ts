import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mainOf } from '../status.ts';
import { DYNAMO, fakeGhEnv, scratch } from './helpers.ts';

// The log folder of a run with three tickets: one running, one stopped, one skipped, and a file of the run itself.
function logs(): string {
  const dir = join(scratch(), 'logs');
  const put = (ticket: number, name: string, text: string) => {
    mkdirSync(join(dir, String(ticket)), { recursive: true });
    writeFileSync(join(dir, String(ticket), name), text);
  };
  const note = (x: Record<string, unknown>) => `${JSON.stringify({ at: 't', round: 1, ...x })}\n`;
  put(7, 'steps.jsonl', note({ step: 'column', column: 'Build' }));
  put(7, 'builder-1.jsonl', `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'a.ts' } }] } })}\n{"type":"ass`);
  put(8, 'steps.jsonl', note({ step: 'stopped', text: 'the check failed twice' }));
  put(9, 'steps.jsonl', note({ step: 'skipped', text: 'blocker #8 stopped in this run' }));
  writeFileSync(join(dir, 'run-skipped.json'), '[]');
  return dir;
}

// The fake gh answers nothing and records every call; there is no git on the PATH either. Any call would show.
function status(...args: string[]) {
  const ghState = scratch();
  const r = spawnSync(process.execPath, [DYNAMO, 'status', ...args], { encoding: 'utf8', env: fakeGhEnv(ghState) });
  const calls = () => (existsSync(join(ghState, 'calls.jsonl')) ? readFileSync(join(ghState, 'calls.jsonl'), 'utf8') : '');
  return { ...r, out: JSON.parse(r.stdout.split('\n')[0]), calls };
}

test('dynamo status reads only the log folder: no gh call, no git, one JSON line', () => {
  const r = status('--json', '--logs', logs());
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.calls(), '');
  assert.equal(r.stdout.split('\n').filter((l) => l !== '').length, 1);
  assert.deepEqual(r.out.rows.map((x: { ticket: number; column: string | null; running: boolean; step: string | null }) => [x.ticket, x.column, x.running, x.step]),
    [[7, 'Build', true, 'Edit a.ts'], [8, null, false, null]]);
  assert.deepEqual(r.out.blocked, [{ ticket: 8, reason: 'the check failed twice' }]);
  assert.deepEqual(r.out.skipped, [{ ticket: 9, why: 'blocker #8 stopped in this run' }]);
  assert.equal(r.out.table, undefined);
});

test('without --json the line carries the table too', () => {
  const r = status('--logs', logs());
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.out.table[0].split(/\s+/)[0], 'ticket');
  assert.ok(r.out.table.includes('  #9: blocker #8 stopped in this run'));
});

test('a log folder that does not exist is a run that never started: no rows, exit 0', () => {
  const r = status('--json', '--logs', join(scratch(), 'nothing'));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual([r.out.rows, r.out.blocked, r.out.skipped], [[], [], []]);
});

test('a wrong argument exits 2 with the usage', () => {
  for (const args of [['--nope'], ['7'], ['--logs']]) {
    const r = status(...args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.out.error, /usage: status/);
  }
});

test('the logs of a copy are the main folder\'s', () => {
  assert.equal(mainOf(join('x', 'main', '.claude', 'worktrees', 'ticket-90')), join('x', 'main'));
  assert.equal(mainOf(join('x', 'main')), join('x', 'main'));
});
