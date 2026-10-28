// The merge of a ticket as data: which branch is the ticket's, when the main folder is not fit to merge into, the subject
// of the merge, and whether the done label came back. Pure: the subcommand `merge` reads git and gh and runs it.

// The lock of the main folder: a git ref, created only if it does not exist (`git update-ref <ref> HEAD ''`), which git
// does atomically. Refs are shared by every copy of the repository, so two merges cannot run at once from any of them.
export const LOCK = 'refs/dynamo/merge-lock';

export type Settings = { repo: string; base: string; main: string; doneLabel: string };
export type Folder = { clean: boolean; current: string; branches: string[] };

export function settings(project: Record<string, unknown>): Settings {
  const read = (key: string): string => {
    const value = project[key];
    if (typeof value !== 'string' || value === '') throw new Error(`factory.json has no project.${key}`);
    return value;
  };
  return { repo: read('repo'), base: read('workingBranch'), main: read('mainBranch'), doneLabel: read('doneLabel') };
}

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

// The labels of `gh issue view --json labels`, unknown until read: whether `label` is among them.
export function hasLabel(json: string, label: string): boolean {
  let answer: unknown;
  try { answer = JSON.parse(json); } catch { return false; }
  const labels = typeof answer === 'object' && answer !== null ? (answer as Record<string, unknown>).labels : undefined;
  return Array.isArray(labels) && labels.some((l) => typeof l === 'object' && l !== null && (l as Record<string, unknown>).name === label);
}
