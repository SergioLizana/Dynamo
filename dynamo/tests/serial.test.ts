import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serially } from '../serial.ts';

test('serially runs jobs one at a time, in the order asked, and a failed job does not stop the next', async () => {
  const events: string[] = [];
  const job = (name: string, ms: number, fail = false) => () => new Promise<string>((resolve, reject) => {
    events.push(`start ${name}`);
    setTimeout(() => { events.push(`end ${name}`); fail ? reject(new Error(name)) : resolve(name); }, ms);
  });
  const results = await Promise.allSettled([serially(job('a', 60)), serially(job('b', 5, true)), serially(job('c', 5))]);
  assert.deepEqual(events, ['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'rejected', 'fulfilled']);
  assert.equal((results[2] as PromiseFulfilledResult<string>).value, 'c');
});
