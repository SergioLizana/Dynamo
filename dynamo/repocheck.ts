// The check `dynamo run` makes before it moves any card: `project.repo` must be the repository's current name. After a
// rename GitHub still answers the old name for reads, but a card can no longer be moved through it («resource not found»),
// which would stop the first ticket with an error that does not say why. Asking GitHub for the name behind `project.repo`
// shows the rename at once.
import type { Deps, Output } from './cli.ts';

// null when `project.repo` is the current name; otherwise the failed result, naming both names.
export function checkRepo(deps: Deps): Output | null {
  const repo = deps.factory().project.repo;
  const r = deps.gh(['repo', 'view', repo, '--json', 'nameWithOwner']);
  if (r.code !== 0) return { ok: false, error: `could not check project.repo ${repo} with GitHub: ${r.stderr.trim()}; nothing was started`, repo };
  let current: unknown;
  try {
    current = (JSON.parse(r.stdout) as { nameWithOwner?: unknown }).nameWithOwner;
  } catch {
    current = undefined;
  }
  if (typeof current !== 'string' || current === '') return { ok: false, error: `could not read the current name of project.repo ${repo} from GitHub; nothing was started`, repo };
  // GitHub names are not case sensitive.
  if (current.toLowerCase() === repo.toLowerCase()) return null;
  return { ok: false, error: `the repository is now ${current}; change project.repo (it says ${repo}); nothing was started`, repo, current };
}
