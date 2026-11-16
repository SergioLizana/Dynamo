// The test selector (#320) applied to the checks of Verify and of the merge, the same way in both: the files the change touches
// against `sha` (git diff --name-only), the selector's answer through applySelection (its guard and fallback), and the plan.
// With no selector, or when git cannot list the files, or when the selector fails, every check stays as the project wrote it.
import type { Deps } from './cli.ts';
import type { Plan, Select } from './selection.ts';
import { applySelection } from './selection.ts';

// `sha` is what `<base>` is replaced with; `cwd` the tree the checks run in. `seconds` is the selector's time, undefined when it did not run.
export async function narrow(commands: string[], sha: string, cwd: string, deps: Deps, select?: Select): Promise<{ plan: Plan[]; seconds?: number }> {
  const whole = commands.map((command): Plan => ({ command, run: command }));
  if (select === undefined) return { plan: whole };
  const changed = deps.git(['diff', '--name-only', sha], { cwd });
  if (changed.code !== 0) return { plan: whole };
  const files = changed.stdout.split('\n').map((f) => f.trim()).filter((f) => f !== '');
  const pick = await select({ base: sha, files, commands }).catch(() => ({ answer: null, seconds: 0 }));
  return { plan: applySelection(commands, pick.answer), seconds: pick.seconds };
}
