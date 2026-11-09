// The `Closes` lines of a release PR against what was merged, as data. Pure: the subcommand `release check` reads git and
// gh and calls these with what they printed.

// The tickets a PR body closes the way GitHub reads it: a closing keyword, then `#n` (`Closes #7`, `fixes: #7`). Sorted,
// each once.
export function closesOf(body: string): number[] {
  const found = [...body.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?[ \t]+#(\d+)\b/gi)].map((m) => Number(m[1]));
  return [...new Set(found)].sort((a, b) => a - b);
}

export type Difference = { missing: number[]; extra: number[] };

// `expected` is what the release closes (the merged tickets and the epics it completes), `closes` what the PR says. A
// merged ticket or complete epic the PR does not close is missing; a number the PR closes that the release does not is extra.
export function differenceOf(expected: number[], closes: number[]): Difference {
  const sort = (l: number[]) => [...new Set(l)].sort((a, b) => a - b);
  return {
    missing: sort(expected.filter((n) => !closes.includes(n))),
    extra: sort(closes.filter((n) => !expected.includes(n))),
  };
}

// The difference as one sentence for the human, or null when there is none.
export function differenceText({ missing, extra }: Difference): string | null {
  const list = (l: number[]) => l.map((n) => `#${n}`).join(', ');
  const parts = [
    ...(missing.length ? [`missing from the PR (merged or complete, no Closes line): ${list(missing)}`] : []),
    ...(extra.length ? [`extra in the PR (Closes of something not merged in the release): ${list(extra)}`] : []),
  ];
  return parts.length ? parts.join('; ') : null;
}

// The parent (the epic) of a ticket as `gh issue view --json parent` printed it: its number, or null when it has none.
export function parentOf(json: string): number | null {
  let data: unknown;
  try { data = JSON.parse(json); } catch { throw new Error('gh did not print JSON for the ticket'); }
  const o = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {};
  const p = o.parent;
  if (p === undefined || p === null) return null;
  const n = typeof p === 'object' ? (p as Record<string, unknown>).number : undefined;
  if (!Number.isInteger(n)) throw new Error('gh printed a parent with no number');
  return n as number;
}
