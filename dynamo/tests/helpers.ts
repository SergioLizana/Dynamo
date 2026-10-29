// What the tests of dynamo share: a scratch folder, and an environment with no gh or claude on the PATH.
import { after } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const FAKE_GH = join(import.meta.dirname, 'fake-gh.ts');
export const FAKE_CLAUDE = join(import.meta.dirname, 'fake-claude.ts');
export const DYNAMO = join(import.meta.dirname, '..', 'dynamo.ts');

// A new folder in the temp folder (a `claude*` one, where the hook lets writes go), removed when the tests end.
export function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'claude-dynamo-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// The process environment with PATH set to an empty folder (so no real gh or claude can be found) and `extra` on top. On
// Windows the variable may be spelled `Path`: every spelling is dropped first.
export function noGhEnv(extra: Record<string, string> = {}): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.toUpperCase() !== 'PATH' && k !== 'DYNAMO_GH' && k !== 'DYNAMO_CLAUDE') env[k] = v;
  }
  const empty = join(scratch(), 'empty-path');
  mkdirSync(empty);
  return { ...env, PATH: empty, ...extra };
}

// The environment that replaces gh with the fake, its state in `state`.
export function fakeGhEnv(state: string): Record<string, string | undefined> {
  return noGhEnv({ DYNAMO_GH: JSON.stringify([process.execPath, FAKE_GH]), FAKE_GH: state });
}

// The environment that replaces claude with the fake, its state in `state`.
export function fakeClaudeEnv(state: string): Record<string, string | undefined> {
  return noGhEnv({ DYNAMO_CLAUDE: JSON.stringify([process.execPath, FAKE_CLAUDE]), FAKE_CLAUDE: state });
}
