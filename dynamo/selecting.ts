// The test selector (#320) run for one round of Verify: `dynamo:selector` in the ticket's copy, with the budget and time limit
// of `project.budgetUsd.selector` and `project.timeoutMinutes.selector`, and the model and effort that are always the same
// (levels.ts). Its cost and turns are counted with the ticket's, its time is what Verify reports. It never blocks the ticket:
// an agent that ends in anything but a success, or that cannot be run, gives no answer, and the checks run as they are.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { selectorSettingOf } from './levels.ts';
import type { Loop, State } from './loopkit.ts';
import { mark } from './loopkit.ts';
import { note } from './notes.ts';
import { SELECTOR_SCHEMA, selectorPrompt } from './selection.ts';
import type { Select } from './selection.ts';

// The selector of this ticket's loop for the round `st` is in, or undefined when `project.selectTests` is off.
// `at` is the step it serves: the merge's run has its own log and is not counted in Verify's time (the merge's checks time has it).
export function selectorOf(loop: Loop, st: State, at: 'verify' | 'merge' = 'verify'): Select | undefined {
  const limits = loop.selector;
  if (limits === null) return undefined;
  return async ({ base, files, commands }) => {
    const began = Date.now();
    const round = st.round;
    try {
      const r = await loop.agent({
        agent: 'selector', prompt: selectorPrompt(base, files, commands), cwd: String(st.copy), log: join(loop.logs, at === 'merge' ? `selector-merge-${round}.jsonl` : `selector-${round}.jsonl`), skills: false,
        session: randomUUID(), resume: false, ...selectorSettingOf(loop.level), schema: SELECTOR_SCHEMA, budget: limits.budget, timeoutMs: limits.minutes * 60_000,
      });
      const seconds = Math.round((Date.now() - began) / 100) / 10;
      st.spent.push({ cost: r.cost, turns: r.turns });
      if (at === 'verify') st.selector.push({ round, seconds, cost: r.cost, turns: r.turns });
      else st.mergeSelector = seconds;
      note(loop.logs, { step: 'agent', round, agent: 'selector', ending: r.ending, cost: r.cost, turns: r.turns, ...(r.detail === null ? {} : { text: r.detail }) });
      mark(loop, st);
      return { answer: r.ending === 'success' ? r.structured : null, seconds };
    } catch (e) {
      note(loop.logs, { step: 'agent', round, agent: 'selector', ending: 'unknown', text: e instanceof Error ? e.message : String(e) });
      const seconds = Math.round((Date.now() - began) / 100) / 10;
      if (at === 'merge') st.mergeSelector = seconds;
      return { answer: null, seconds };
    }
  };
}
