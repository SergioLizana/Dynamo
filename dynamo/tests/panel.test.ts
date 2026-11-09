import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

// The pane is a mod of the development repository: the public one has no `mods/`, and there these tests have nothing to prove.
const view = new URL('../../mods/dynamo-panel/hooks/view.ts', import.meta.url);
const skip = existsSync(view) ? false : 'the public repository has no mods/';
const { STATUS_COMMAND, REFRESH_MS, rowText, viewOf } = skip ? ({} as never) : await import(view.href);

const ok = (body: unknown) => ({ exitCode: 0, stdout: `${JSON.stringify({ ok: true, ...(body as object) })}\n`, stderr: '' });
const row = { ticket: 91, column: 'Review', round: 2, running: true, step: 'Grep needle', turns: 12, cost: 1.5 };

test('the pane asks for `dynamo status --json` and for nothing else, every few seconds', { skip }, () => {
  assert.deepEqual(STATUS_COMMAND, ['node', 'dynamo/dynamo.ts', 'status', '--json']);
  assert.ok(REFRESH_MS >= 2000 && REFRESH_MS <= 10000);
  const source = readFileSync(new URL('../../mods/dynamo-panel/hooks/register.tsx', import.meta.url), 'utf8');
  assert.deepEqual(source.match(/\$\.process\.\w+/g), ['$.process.run']);
  assert.equal(source.match(/\$\.process\.run\(([^)]*)\)/)?.[1], 'STATUS_COMMAND');
  assert.doesNotMatch(source, /\$\.(fs|http|agent|prompt|tool)\./);
});

test('a good answer is a view with a row per ticket, the blocked and the skipped', { skip }, () => {
  const blocked = [{ ticket: 5, reason: 'Needs a decision' }];
  const skipped = [{ ticket: 6, why: 'blocked by #5' }];
  assert.deepEqual(viewOf(ok({ rows: [row], blocked, skipped })), { rows: [row], blocked, skipped, error: null });
});

test('a failing `dynamo status` is a line of error, not a throw', { skip }, () => {
  const error = (r: { exitCode: number; stdout: string; stderr: string }) => viewOf(r).error;
  assert.match(String(error({ exitCode: 1, stdout: '{"ok":false,"error":"no log folder"}\n', stderr: '' })), /no log folder/);
  assert.match(String(error({ exitCode: 1, stdout: '', stderr: 'node: not found' })), /node: not found/);
  assert.match(String(error({ exitCode: 0, stdout: 'not json', stderr: '' })), /not json|JSON/i);
  assert.match(String(error({ exitCode: 0, stdout: '{"ok":true,"rows":3}', stderr: '' })), /rows/);
  assert.match(String(viewOf(new Error('spawn failed')).error), /spawn failed/);
  assert.deepEqual(viewOf(new Error('x')).rows, []);
});

test('a row reads as one line: ticket, column, round, last step, turns and cost', { skip }, () => {
  assert.equal(rowText(row), '#91  Review  r2  (running) Grep needle  12 turns  $1.50');
  assert.equal(rowText({ ...row, column: null, running: false, step: null, round: 1, turns: 0, cost: 0 }), '#91  -  r1  -  0 turns  $0.00');
});
