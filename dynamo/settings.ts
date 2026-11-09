// The project values a merge needs, read from the `project` block of factory.json through the shared setting() of cli.ts,
// and the working branch it is given (read from git by working.ts, not kept in factory.json).
import { setting } from './cli.ts';

export type Settings = { repo: string; base: string; main: string; doneLabel: string };

export function settings(project: Record<string, unknown>, base: string): Settings {
  const get = (key: string): string => setting(project, 'project', key);
  return { repo: get('repo'), base, main: get('mainBranch'), doneLabel: get('doneLabel') };
}
