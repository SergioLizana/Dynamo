// The version of a release, as data: what a `release/x.y.z` branch names, which of two versions is greater, the last tag
// of a list and the version that follows one for a patch, minor or major bump. Pure: `release close` reads git and calls these with what it printed.

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
const parts = (v: string): number[] => v.split('.').map(Number);

// The version a working branch `release/x.y.z` names, or the error that says it names none.
export function versionOf(branch: string): string {
  const m = branch.match(/^release\/(\d+\.\d+\.\d+)$/);
  if (!m) throw new Error(`the working branch «${branch}» does not name a version (release/x.y.z)`);
  return m[1];
}

// Whether version `a` comes after version `b`, compared number by number (0.10.0 is after 0.9.0).
export function greater(a: string, b: string): boolean {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

export const BUMPS = ['patch', 'minor', 'major'] as const;
export type Bump = (typeof BUMPS)[number];

// The version that follows `version` for a bump: patch adds one to z, minor adds one to y and zeroes z, major adds one to x
// and zeroes the rest (0.3.0 with minor is 0.4.0).
export function nextVersion(version: string, bump: Bump): string {
  if (!VERSION.test(version)) throw new Error(`«${version}» is not a version (x.y.z)`);
  const [x, y, z] = parts(version);
  if (bump === 'major') return `${x + 1}.0.0`;
  if (bump === 'minor') return `${x}.${y + 1}.0`;
  if (bump === 'patch') return `${x}.${y}.${z + 1}`;
  throw new Error(`«${String(bump)}» is not patch, minor or major`);
}

// The greatest `v<x.y.z>` of what `git tag --list` printed, without the `v`, or null when there is none. A tag that is not a
// version is not a release and is left out.
export function lastTag(list: string): string | null {
  const versions = list.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('v')).map((l) => l.slice(1)).filter((v) => VERSION.test(v));
  return versions.reduce<string | null>((best, v) => (best === null || greater(v, best) ? v : best), null);
}

// The working branch among what git printed: `branches` is the short names of the `release/*` branches, local and of origin
// (`release/x.y.z` or `origin/release/x.y.z`, one per line) and `tags` is `git tag --list`. It is the greatest
// `release/x.y.z` above the last tag `v<x.y.z>`, or any if there is no tag; null when there is none.
export function findRelease(branches: string, tags: string): string | null {
  const last = lastTag(tags);
  const found = branches.split('\n').map((l) => l.trim().replace(/^origin\//, '')).map((b) => b.match(/^release\/(\d+\.\d+\.\d+)$/)?.[1])
    .filter((v): v is string => v !== undefined && (last === null || greater(v, last)));
  const best = found.reduce<string | null>((top, v) => (top === null || greater(v, top) ? v : top), null);
  return best === null ? null : `release/${best}`;
}

// The branch to make when there is none: the next minor after the last tag (`release/0.1.0` with no tag).
export function firstRelease(tags: string): string {
  return `release/${nextVersion(lastTag(tags) ?? '0.0.0', 'minor')}`;
}

// The working branch, from what git printed (see `findRelease`). With none, the error names the branch to create.
export function releaseBranchOf(branches: string, tags: string): string {
  const found = findRelease(branches, tags);
  if (found !== null) return found;
  const last = lastTag(tags);
  throw new Error(`there is no release/x.y.z branch above ${last === null ? 'no tag' : `the last tag v${last}`}, local or on origin: create ${firstRelease(tags)}`);
}
