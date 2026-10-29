// `.claude/factory.json`, the project data (what each value means: `.claude/factory.md`).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Factory = {
  project: { repo: string; mainBranch: string; workingBranch: string; checks: string[]; [key: string]: unknown };
  [key: string]: unknown;
};

// The root of the repository this file is in: in a copy of the repository, the copy.
export const ROOT = join(import.meta.dirname, '..');

export function readFactory(root: string = ROOT): Factory {
  const factory = JSON.parse(readFileSync(join(root, '.claude', 'factory.json'), 'utf8'));
  if (typeof factory?.project !== 'object' || factory.project === null) throw new Error('factory.json has no project block');
  return factory;
}
