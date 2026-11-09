// The milestone of a release, made by `release close`: named for the version (like its tag), holding every ticket merged in
// it. GitHub has no `gh` command for creating a milestone, so it goes through `gh api`. A milestone that fails half way is
// deleted (deleting it takes the tickets out of it), so a failure leaves nothing behind.
import type { Deps } from './cli.ts';
import { endOf } from './checks.ts';

export type Milestone = { number: number; title: string };

// The number of the milestone in what `gh api` printed for its creation (unknown until checked).
export function milestoneOf(json: string): number {
  let data: unknown;
  try { data = JSON.parse(json); } catch { throw new Error('gh did not print JSON for the milestone'); }
  const n = typeof data === 'object' && data !== null ? (data as Record<string, unknown>).number : undefined;
  if (!Number.isInteger(n)) throw new Error('gh printed a milestone with no number');
  return n as number;
}

export function deleteMilestone(gh: Deps['gh'], repo: string, number: number): string {
  const r = gh(['api', `repos/${repo}/milestones/${number}`, '--method', 'DELETE']);
  return r.code === 0 ? `the milestone was taken back` : `the milestone #${number} could not be taken back: ${endOf(r)}`;
}

// Closes the milestone once everything else of the release is made. Returns the error text, or null if it is closed.
export function closeMilestone(gh: Deps['gh'], repo: string, number: number): string | null {
  const r = gh(['api', `repos/${repo}/milestones/${number}`, '--method', 'PATCH', '-f', 'state=closed']);
  return r.code === 0 ? null : endOf(r);
}

// Makes the milestone `title` and puts the tickets in it. Throws, with the milestone taken back, if any step fails.
export function makeMilestone(gh: Deps['gh'], repo: string, title: string, tickets: number[]): Milestone {
  const created = gh(['api', `repos/${repo}/milestones`, '--method', 'POST', '-f', `title=${title}`]);
  if (created.code !== 0) throw new Error(`the milestone ${title} could not be made: ${endOf(created)}`);
  const number = milestoneOf(created.stdout);
  for (const t of tickets) {
    const r = gh(['issue', 'edit', String(t), '-R', repo, '--milestone', title]);
    if (r.code !== 0) throw new Error(`ticket #${t} could not be put in the milestone ${title}: ${endOf(r)}; ${deleteMilestone(gh, repo, number)}`);
  }
  return { number, title };
}
