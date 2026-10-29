// What a release report reads, as data: the tickets merged into the working branch (from its merge commits), the last
// result comment of a ticket, the `/cost` line of the release PR and where the branch stands on the remote. Pure: the
// subcommand `report` reads git and gh and calls these with what they printed.

// The merged tickets are the `(#n)` that ends the subject of every merge commit, whatever the language of the subject. A
// revert of a merge (`Revert "<subject>"`, and a revert of the revert) takes the ticket out (or puts it back), oldest
// first. `log` is `git log --first-parent --format=%p%x09%s`: the parents, a tab and the subject, newest first.
export function mergedTickets(log: string): number[] {
  const commits = log.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim() !== '').map((l) => {
    const tab = l.indexOf('\t');
    return { merge: l.slice(0, tab).trim().includes(' '), subject: l.slice(tab + 1).trim() };
  }).reverse();
  const mergeSubjects = new Set(commits.filter((c) => c.merge).map((c) => c.subject));
  const numberOf = (s: string): number | null => {
    const m = s.match(/\(#(\d+)\)\s*$/);
    return m ? Number(m[1]) : null;
  };
  const merged = new Set<number>();
  for (const c of commits) {
    if (c.merge) {
      const n = numberOf(c.subject);
      if (n !== null) merged.add(n);
      continue;
    }
    let subject = c.subject;
    let depth = 0;
    while (/^Revert "[\s\S]*"$/.test(subject)) { subject = subject.slice(8, -1); depth++; }
    if (depth === 0 || !mergeSubjects.has(subject)) continue;
    const n = numberOf(subject);
    if (n === null) continue;
    if (depth % 2) merged.delete(n); else merged.add(n);
  }
  return [...merged].sort((a, b) => a - b);
}

export type Ticket = { title: string; comments: string[] };

// A ticket as `gh issue view --json title,comments` printed it (unknown until checked): its title and comment bodies.
export function ticketOf(json: string): Ticket {
  let data: unknown;
  try { data = JSON.parse(json); } catch { throw new Error('gh did not print JSON for the ticket'); }
  const o = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {};
  const list = o.comments;
  if (typeof o.title !== 'string' || !Array.isArray(list)) throw new Error('gh printed no title and comments list');
  const comments = list.map((c) => (typeof c === 'object' && c !== null ? (c as Record<string, unknown>).body : undefined));
  if (!comments.every((b): b is string => typeof b === 'string')) throw new Error('gh printed a comment with no body');
  return { title: o.title, comments };
}

export type Result = { head: string; rounds: string | null; out: string | null };

// A result comment starts with «run · » (the run workflow) or «/implement · » (the skill); the dot is U+00B7.
const RESULT = /^(?:run|\/implement) · /;
export const isResult = (body: string): boolean => RESULT.test(body);

// The last result comment of a ticket, with the three pieces the report uses, or null when it has none.
export function lastResult(bodies: string[]): Result | null {
  const body = bodies.filter(isResult).pop();
  if (body === undefined) return null;
  const lines = body.split('\n').map((l) => l.replace(/\r$/, ''));
  const k = lines.findIndex((l) => l.startsWith('Out of the ticket'));
  const rounds = lines.find((l) => l.startsWith('Rounds: '));
  return { head: lines[0].replace(RESULT, ''), rounds: rounds === undefined ? null : rounds.slice(8).trim(), out: k < 0 ? null : lines.slice(k).join('\n') };
}

export const oneLine = (s: string, max = 300): string => {
  const x = s.replace(/\s+/g, ' ').trim();
  return x.length > max ? `${x.slice(0, max - 1)}…` : x;
};

// What the Builder noted outside the ticket, from the «Out of the ticket» block of a result comment. The block comes in
// three forms and all of them are kept: text after the colon on the first line, unfenced lines after it (up to the next
// `Stopped at` / `Left` / `To relaunch` / `Reason` line), and fenced blocks (their lines count whatever they say, but the
// fences themselves do not). The result is dropped only when all of that is just «nothing» or «none».
export function outOfTicket(block: string | null): string | null {
  if (block === null) return null;
  const lines = block.split('\n').map((l) => l.replace(/\r$/, ''));
  const colon = lines[0].indexOf(':');
  const body = colon === -1 ? [] : [lines[0].slice(colon + 1)];
  let inside = false;
  for (const l of lines.slice(1)) {
    if (/^`{3,}/.test(l.trim())) { inside = !inside; continue; }
    if (!inside && /^(Stopped at|Left|To relaunch|Reason)\b/.test(l.trim())) break;
    body.push(l);
  }
  const text = oneLine(body.join(' '), 600);
  return text === '' || /^(nothing|none)\.?$/i.test(text) ? null : text;
}

export const PLACEHOLDER = '<the human fills it in>';

// The `/cost` line the human filled in on the PR stays: it is not state anyone can read from git.
export function costOf(body: string): string | null {
  const m = body.match(/^- `\/cost` of the session:[ \t]*(.+)$/m);
  return m && !m[1].includes(PLACEHOLDER) ? m[1].trim() : null;
}

export type Pr = { number: number; body: string };

// The open PR of the release in what `gh pr list --json number,url,body` printed (unknown until checked), or null.
export function prOf(json: string): Pr | null {
  let data: unknown;
  try { data = JSON.parse(json); } catch { throw new Error('gh did not print JSON for the pull requests'); }
  if (!Array.isArray(data)) throw new Error('gh printed no list of pull requests');
  if (data.length === 0) return null;
  const first = typeof data[0] === 'object' && data[0] !== null ? data[0] as Record<string, unknown> : {};
  if (!Number.isInteger(first.number)) throw new Error('gh printed a pull request with no number');
  return { number: first.number as number, body: typeof first.body === 'string' ? first.body : '' };
}

export type Remote = { state: 'up-to-date' | 'missing' | 'behind' | 'different' | 'unknown'; missing: number | null };

// Where the branch stands on origin. `local` is the short sha of the branch; `lsRemote` is what `git ls-remote --heads
// origin <base>` printed and `ahead` what `git rev-list --count <base> --not --remotes=origin` printed, each null when
// the command failed.
export function remoteOf(local: string, lsRemote: string | null, ahead: string | null): Remote {
  const missing = ahead !== null && /^\d+$/.test(ahead.trim()) ? Number(ahead.trim()) : null;
  if (lsRemote === null) return { state: 'unknown', missing };
  const sha = lsRemote.trim().split(/\s+/)[0];
  if (sha === '') return { state: 'missing', missing };
  if (local !== '' && sha.startsWith(local)) return { state: 'up-to-date', missing: 0 };
  return { state: missing ? 'behind' : 'different', missing };
}
