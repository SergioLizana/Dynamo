// The merge of a ticket as data: which branch is the ticket's, when the main folder is not fit to merge into, the subject
// of the merge, and whether the done label came back. Pure: the subcommand `merge` reads git and gh and runs it.

// The project values the merge needs are read in settings.ts, through the shared setting(); this file imports nothing, so
// they are re-exported here for whoever merges.
export type { Settings } from './settings.ts';
export { settings } from './settings.ts';
import type { Settings } from './settings.ts';

// The lock of the main folder: a git ref, created only if it does not exist (`git update-ref <ref> HEAD ''`), which git
// does atomically. Refs are shared by every copy of the repository, so two merges cannot run at once from any of them.
export const LOCK = 'refs/dynamo/merge-lock';

export type Folder = { clean: boolean; current: string; branches: string[] };

// The branches of ticket n among the local branch names: `ticket/<n>-<slug>`, so `ticket/8-x` is not ticket 83's.
export function ticketBranches(names: string[], n: number): string[] {
  return names.filter((b) => b.startsWith(`ticket/${n}-`) && b.length > `ticket/${n}-`.length);
}

// The first reason not to merge, or null. Nothing has been changed when one applies.
export function refusal(s: Settings, f: Folder, n: number): string | null {
  if (s.base === s.main) return `the working branch is the main branch (${s.main}): nothing is merged into it`;
  if (!f.clean) return 'the working tree is not clean';
  if (f.current !== s.base) return `the main folder is on ${f.current || 'no branch'}, not on the working branch ${s.base}`;
  if (f.branches.length === 0) return `there is no ticket/${n}-* branch`;
  if (f.branches.length > 1) return `there is more than one ticket/${n}-* branch: ${f.branches.join(', ')}`;
  return null;
}

export function subject(branch: string, base: string, n: number): string {
  return `Merge ${branch} into ${base} (#${n})`;
}

// Why a ticket stops at the merge, from what `dynamo merge` answered (the exit code and its JSON line, unknown until read):
// the check that failed, a conflict apart from it, or the whole line for anything else (the lock, a branch that cannot
// fast-forward). The working branch has not moved in any of them.
export function stopReason(code: number, out: Record<string, unknown>): string {
  const text = (v: unknown): string => (typeof v === 'string' ? v : '');
  const where = `${text(out.branch)} into ${text(out.base)}`;
  const failed = out.failed;
  if (typeof failed === 'object' && failed !== null) {
    const f = failed as Record<string, unknown>;
    const end = text(f.output);
    return `the check \`${text(f.command)}\` failed (exit ${String(f.code)}) after the merge of ${where}${end === '' ? '' : `: ${end}`}. `
      + `${text(out.base)} was not moved and nothing was reverted: a flaky test or a clash between tickets, for the human to judge`;
  }
  if (out.conflict === true) {
    const files = Array.isArray(out.files) ? out.files.filter((f) => typeof f === 'string') : [];
    return `${text(out.branch)} conflicts with ${text(out.base)}${files.length === 0 ? '' : ` in ${files.join(', ')}`}: nothing was merged`;
  }
  return `dynamo merge exited ${code}: ${JSON.stringify(out)}`;
}

// The labels of `gh issue view --json labels`, unknown until read: whether `label` is among them.
export function hasLabel(json: string, label: string): boolean {
  let answer: unknown;
  try { answer = JSON.parse(json); } catch { return false; }
  const labels = typeof answer === 'object' && answer !== null ? (answer as Record<string, unknown>).labels : undefined;
  return Array.isArray(labels) && labels.some((l) => typeof l === 'object' && l !== null && (l as Record<string, unknown>).name === label);
}
