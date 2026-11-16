// `dynamo verify <copy> <base>`: runs every command of `project.checks` in the copy, with `<base>` replaced by the sha of
// `git merge-base HEAD <base>`, and reports the exit code of each. The decision is the exit codes, not what an agent
// says it saw: it is ok only if all of them are 0, and no checks, no time limit, or no copy, is an error. A command past
// the limit (`project.checkTimeoutMinutes`) is closed with its tree and counts as failed.
// With a `select` (only `run` gives one, when `project.selectTests` is on; #320) the test selector may narrow a check to the
// tests the change affects or skip it: what it answers is applied by selection.ts, and a selector that fails changes nothing.
import type { Deps, Output } from './cli.ts';
import { usage } from './cli.ts';
import { checkTimeoutOf, parseChecks, report, runChecks } from './checks.ts';
import { narrow } from './narrowing.ts';
import { assemble } from './selection.ts';
import type { Select } from './selection.ts';

export async function verify(args: string[], deps: Deps, select?: Select): Promise<Output> {
  if (args.length !== 2 || args.includes('')) usage('usage: verify <copy> <base>');
  const [copy, base] = args;
  if (base.startsWith('-')) usage(`${base} is not a branch or a sha`);
  const factory = deps.factory();
  const commands = parseChecks(factory.project.checks);
  const limit = checkTimeoutOf(factory.project);

  const inside = deps.git(['rev-parse', '--is-inside-work-tree'], { cwd: copy });
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') throw new Error(`${copy} is not a git working tree (or does not exist)`);
  const mergeBase = deps.git(['merge-base', 'HEAD', base], { cwd: copy });
  if (mergeBase.code !== 0) throw new Error(`no merge-base of HEAD and ${base} in ${copy}: ${mergeBase.stderr.trim()}`);
  const sha = mergeBase.stdout.trim();

  // The selector gets the files the change touches against the merge-base (what `git diff --check <base>` looks at too).
  const { plan, seconds: selectorSeconds } = await narrow(commands, sha, copy, deps, select);

  const ran = await runChecks(plan.flatMap((p) => (p.run === null ? [] : [p.run])), sha, copy, deps.exec, limit);
  return report(sha, assemble(plan, ran), selectorSeconds);
}
