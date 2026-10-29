// A comment as data: the gh arguments that post it and read it back, and whether what came back is what was written.
// Pure: the subcommand `comment` reads the file and runs them.

export type Posted = { body: string; url: string | null };

export function postArgs(repo: string, n: number): string[] {
  return ['issue', 'comment', String(n), '-R', repo, '--body-file', '-'];
}

export function readArgs(repo: string, n: number): string[] {
  return ['issue', 'view', String(n), '-R', repo, '--json', 'comments'];
}

// GitHub may hand the body back with the other line ending, and without the blank space at its end: those do not count.
export function sameBody(written: string, posted: string): boolean {
  const plain = (text: string) => text.replace(/\r\n/g, '\n').trimEnd();
  return plain(written) === plain(posted);
}

// The last comment in what `gh issue view --json comments` printed (unknown until checked), or null when there is none.
export function lastComment(json: string): Posted | null {
  let data: unknown;
  try { data = JSON.parse(json); } catch { throw new Error('gh did not print JSON for comments'); }
  const list = typeof data === 'object' && data !== null ? (data as Record<string, unknown>).comments : undefined;
  if (!Array.isArray(list) || !list.every((c) => typeof c === 'object' && c !== null && typeof (c as Record<string, unknown>).body === 'string')) {
    throw new Error('gh printed no comments list with a body in each');
  }
  if (list.length === 0) return null;
  const last = list[list.length - 1] as Record<string, unknown>;
  return { body: String(last.body), url: typeof last.url === 'string' ? last.url : null };
}
