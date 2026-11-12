// `dynamo release new --bump <patch|minor|major> [--dry-run]`: opens the next release branch `release/<last tag + bump>`,
// started from `origin/<main>` after a fetch, so it holds whatever reached the main branch after the tag. It refuses when a
// release branch above the last tag already exists (one open release at a time, the rule `findRelease` follows) or when there
// is no tag (`/dynamo:setup` opens the first branch). `--dry-run` says the version and the branch and writes nothing, the
// fetch included: the skill fetches before it. The branch is made with `update-ref`, so the folder is not touched; the skill
// pushes it and checks it out.
import type { Deps, Output } from './cli.ts';
import { read, setting, usage } from './cli.ts';
import { openBranch } from './release-next.ts';
import { SAFE, gitText } from './releasing.ts';
import { BUMPS, findRelease, lastTag, nextVersion } from './versions.ts';
import type { Bump } from './versions.ts';

const USAGE = `usage: release new --bump <${BUMPS.join('|')}> [--dry-run]`;

function parse(args: string[]): { bump: Bump; dryRun: boolean } {
  let bump: string | undefined;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run' && !dryRun) dryRun = true;
    else if (args[i] === '--bump' && bump === undefined && i + 1 < args.length) bump = args[++i];
    else usage(USAGE);
  }
  if (bump === undefined || !(BUMPS as readonly string[]).includes(bump)) usage(USAGE);
  return { bump: bump as Bump, dryRun };
}

export function releaseNew(args: string[], deps: Deps): Output {
  const { bump, dryRun } = parse(args);
  const main = setting(deps.factory().project, 'project', 'mainBranch');
  if (!SAFE.test(main)) usage(`${main} is not a branch name that is safe to use`);
  if (!dryRun) gitText(deps.git, ['fetch', 'origin'], 'fetching origin');

  const tags = read(deps, ['tag', '--list', 'v*']);
  const last = lastTag(tags);
  if (last === null) throw new Error('there is no tag yet: /dynamo:setup opens the first release branch');
  const branches = read(deps, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/release', 'refs/remotes/origin/release']);
  const open = findRelease(branches, tags);
  if (open !== null) throw new Error(`${open} is already open above the last tag v${last}: close it before opening another release`);

  const version = nextVersion(last, bump);
  const branch = `release/${version}`;
  const sha = gitText(deps.git, ['rev-parse', '--verify', `origin/${main}^{commit}`], `reading origin/${main}`);
  const done = { version, branch, bump, tag: `v${last}`, from: `origin/${main}`, commit: sha.slice(0, 7), dryRun };
  if (dryRun) return { ok: true, ...done, message: `would make ${branch} from origin/${main} at ${done.commit}; nothing was written` };
  openBranch(deps.git, branch, sha);
  return { ok: true, ...done, message: `made ${branch} from origin/${main} at ${done.commit}` };
}
