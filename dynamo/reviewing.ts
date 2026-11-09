// What the review of a public snapshot decides, with no git or file system: what in a text is personal (an email, a user
// path, a mention of the private repository), what gitleaks' report says, and the message of a refusal. `dynamo publish`
// reads the files and runs gitleaks (snapshot.ts) and calls this.

export type Finding = { file: string; line: number; kind: string };

// Emails that may be in a published file: the noreply identity of every public commit, and GitHub's own address for the
// commit of a squash merge. Any other is somebody's.
const ALLOWED_EMAILS = ['28341710+sergiolizana@users.noreply.github.com', 'noreply@github.com'];
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

// A user path, in any form it takes: `C:\Users\<name>` (any drive letter and case, `/` or `\`, doubled when escaped),
// Git Bash `/c/Users/<name>`, WSL `/mnt/c/Users/<name>`, `/Users/<name>` and `/home/<name>`. A name that opens with a
// placeholder mark (`<name>`, `%USERNAME%`, `$USER`, `{user}`) is not a path of anybody. The Unix forms must not follow a
// character of a longer path, so the path of a URL (`https://x.example/home/page`) is not one; but they do follow a colon
// (a PATH list, a volume mount, a `host:` prefix) and `file://`.
const NAME = '(?![<%$\\{\\[])[^\\\\/\\s"\'`<>:*?|,;()]+';
const START = '(?:(?<![\\w.:/~-])|(?<=\\S:)|(?<=file://))';
const USER_PATH = new RegExp(
  `\\b[A-Za-z]:[\\\\/]+Users[\\\\/]+${NAME}|${START}(?:/mnt/[a-z]|/[a-z])/Users/${NAME}|${START}/(?:Users|home)/${NAME}`,
  'gi',
);

// The private repository: every mention of its name (the part of `project.repo` after the owner), in whatever case. The name
// comes in as data, from factory.json, so that this module stays pure and names no project.
function repoMention(repo: string): RegExp {
  const name = repo.slice(repo.lastIndexOf('/') + 1);
  return new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
}

// What is personal in a text, one finding per line and kind.
export function scanText(file: string, text: string, privateRepo: string): Finding[] {
  const mention = repoMention(privateRepo);
  const found: Finding[] = [];
  text.split(/\r\n|\r|\n/).forEach((content, i) => {
    const line = i + 1;
    const kinds: string[] = [];
    if ((content.match(EMAIL) ?? []).some((email) => !ALLOWED_EMAILS.includes(email.toLowerCase()))) kinds.push('email');
    if (content.search(USER_PATH) >= 0) kinds.push('user path');
    if (content.search(mention) >= 0) kinds.push('link to the private repository');
    for (const kind of kinds) found.push({ file, line, kind });
  });
  return found;
}

// The findings of gitleaks' JSON report (`-f json`): file and line of each, never the secret itself. The report is checked
// before it is trusted; anything that is not a list of findings is an error, not a clean snapshot.
export function gitleaksFindings(report: string, folder: string): Finding[] {
  let parsed: unknown;
  try { parsed = JSON.parse(report.trim() === '' ? '[]' : report); } catch { throw new Error('the report of gitleaks is not JSON'); }
  if (!Array.isArray(parsed)) throw new Error('the report of gitleaks is not a list');
  const base = folder.replace(/\\/g, '/').replace(/\/+$/, '') + '/';
  return parsed.map((item: unknown) => {
    const entry = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};
    const path = typeof entry.File === 'string' ? entry.File.replace(/\\/g, '/') : '?';
    const file = path.startsWith(base) ? path.slice(base.length) : path;
    const line = typeof entry.StartLine === 'number' ? entry.StartLine : 0;
    const rule = typeof entry.RuleID === 'string' ? ` (${entry.RuleID})` : '';
    return { file, line, kind: `secret${rule}` };
  });
}

// The message of a refusal: every finding with its file and line, and the word that nothing was committed.
export function refusal(findings: Finding[]): string {
  const lines = findings.map((f) => `${f.file}${f.line > 0 ? `:${f.line}` : ''} ${f.kind}`);
  return `the snapshot has ${findings.length === 1 ? 'a finding' : `${findings.length} findings`}; nothing was committed and the clone is as it was:\n${lines.join('\n')}`;
}
