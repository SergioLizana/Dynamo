// What `dynamo publish` decides, with no git or file system: which files of a tag are published, the identity of the public
// commits, the version and branch a tag gives, and the commands the human is told to run.

// The identity of every public commit. The name is the human's; the email is always the GitHub noreply one.
export const IDENTITY = { name: 'Sergio Lizana', email: '28341710+SergioLizana@users.noreply.github.com' };

// What is published: the same allowlist that makes the plugin. A folder takes everything under it, a file only itself.
// Left out: whatever only the development repository uses (its documentation, its CLAUDE.md, its mods and its factory.json).
export const ALLOWLIST = [
  '.claude-plugin/', 'skills/', 'agents/', 'hooks/', 'dynamo/', 'guides/', 'templates/', 'assets/',
  'README.md', 'README.es.md', 'LICENSE', '.gitignore', '.gitattributes',
];

// The two files that are not copied as they are: the public repository has a CI and a Dependabot of its own, kept in
// `public/` of the tag (the development `.github/workflows/ci.yml` is another file) and placed where GitHub reads them.
// Source in the tag → place in the public commit.
export const PUBLIC_FILES: Record<string, string> = {
  'public/ci.yml': '.github/workflows/ci.yml',
  'public/dependabot.yml': '.github/dependabot.yml',
};

// The sources of PUBLIC_FILES that the listing of a tag (`git ls-tree -r -z --name-only`) lacks.
export function missingPublicFiles(listing: string): string[] {
  const have = new Set(listing.split('\0'));
  return Object.keys(PUBLIC_FILES).filter((source) => !have.has(source));
}

export function isPublished(path: string): boolean {
  return ALLOWLIST.some((entry) => (entry.endsWith('/') ? path.startsWith(entry) : path === entry));
}

// The files of a `git ls-tree -r -z --name-only` listing that are published, sorted.
export function publishedFiles(listing: string): string[] {
  return listing.split('\0').filter((p) => p !== '' && isPublished(p)).sort();
}

// The version a release tag names (`v0.5.0` → `0.5.0`), or null for a name that is not a release tag.
export function versionOf(tag: string): string | null {
  return /^v(\d+\.\d+\.\d+)$/.test(tag) ? tag.slice(1) : null;
}

export const publishBranch = (version: string): string => `publish/${version}`;

// `plugin.json` with its version set, everything else as it was; null when it has no version to set.
export function withVersion(text: string, version: string): string | null {
  const field = /("version"\s*:\s*")[^"]*(")/;
  return field.test(text) ? text.replace(field, (_all, open: string, close: string) => `${open}${version}${close}`) : null;
}

// The git environment that makes author and committer the noreply identity, whatever the machine's config or variables say.
export function identityEnv(): Record<string, string> {
  return {
    GIT_AUTHOR_NAME: IDENTITY.name, GIT_AUTHOR_EMAIL: IDENTITY.email,
    GIT_COMMITTER_NAME: IDENTITY.name, GIT_COMMITTER_EMAIL: IDENTITY.email,
  };
}

// What the human runs next. The first release goes straight to `main` (the public repository is empty, so there is nothing
// to open a pull request against); the later ones go on `publish/x.y.z` and then a pull request. The pull request is made
// from inside the clone, where `gh` finds its repository.
export function commandsFor(clone: string, branch: string, main: string, first: boolean, version: string): { push: string; pr: string | null } {
  const target = first ? main : branch;
  return {
    push: `git -C "${clone}" push -u origin ${target}`,
    pr: first ? null : `cd "${clone}" && gh pr create --base ${main} --head ${branch} --title "Dynamo ${version}" --body "Release ${version}"`,
  };
}

// The email GitHub puts on the commit it makes when it merges a pull request: the committer of a squash merge.
export const GITHUB_EMAIL = 'noreply@github.com';

// The format that `git log` is asked for to read who made a commit: author name and email, committer name and email.
export const IDENTITY_FORMAT = '%an%x00%ae%x00%cn%x00%ce';

export type Identities = { authorName: string; authorEmail: string; committerName: string; committerEmail: string };

export function identitiesOf(line: string): Identities {
  const [authorName = '', authorEmail = '', committerName = '', committerEmail = ''] = line.replace(/\r?\n$/, '').split('\0');
  return { authorName, authorEmail, committerName, committerEmail };
}

const sameEmail = (a: string, b: string): boolean => a.trim().toLowerCase() === b.toLowerCase();

// What is wrong with the identity of the commit this tool prepared: author and committer must both be exactly the noreply
// identity. Empty when nothing is.
export function preparedProblems(who: Identities): string[] {
  const problems: string[] = [];
  const mine = (name: string, email: string) => name === IDENTITY.name && sameEmail(email, IDENTITY.email);
  if (!mine(who.authorName, who.authorEmail)) problems.push(`author is ${who.authorName} <${who.authorEmail}>`);
  if (!mine(who.committerName, who.committerEmail)) problems.push(`committer is ${who.committerName} <${who.committerEmail}>`);
  return problems;
}

// The name GitHub signs the commit of a squash merge with.
export const GITHUB_NAME = 'GitHub';

// What is wrong with the identity of the commit the merge left on the public `main`. GitHub makes it: the author is the
// pull request's author, who must be the noreply identity (name and email); the committer of a squash merge is GitHub
// itself, so its own identity (`GitHub <noreply@github.com>`) passes too. Any other name or email, a personal one above
// all, fails. Empty when nothing is wrong.
export function mergedProblems(who: Identities): string[] {
  const problems: string[] = [];
  const mine = (name: string, email: string) => name === IDENTITY.name && sameEmail(email, IDENTITY.email);
  const github = (name: string, email: string) => name === GITHUB_NAME && sameEmail(email, GITHUB_EMAIL);
  if (!mine(who.authorName, who.authorEmail)) problems.push(`author is ${who.authorName} <${who.authorEmail}>`);
  if (!mine(who.committerName, who.committerEmail) && !github(who.committerName, who.committerEmail)) {
    problems.push(`committer is ${who.committerName} <${who.committerEmail}>`);
  }
  return problems;
}

// The version a `plugin.json` carries, or null when it has none.
export function versionIn(text: string): string | null {
  const found = /"version"\s*:\s*"([^"]*)"/.exec(text);
  return found === null ? null : found[1] ?? null;
}

// What the human runs once the identity of the merged commit is checked. `gh release create` makes the tag on that commit
// and the Release together: the tag is GitHub's, so it carries no tagger email. It is made from inside the clone, where
// `gh` finds its repository.
export function releaseCommand(clone: string, tag: string, version: string, sha: string): string {
  return `cd "${clone}" && gh release create ${tag} --target ${sha} --title "Dynamo ${version}" --notes "Release ${version}"`;
}
