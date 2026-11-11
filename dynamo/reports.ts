// The release report as text, and the commands the human runs after it. Pure: facts in, text out; the subcommand `report`
// reads them, writes the file and prints the commands. Nothing here is run.
import type { Remote, Result } from './releases.ts';
import { flat, outOfTicket } from './releases.ts';

// `result` is null when the ticket has no result comment; the whole entry is null when GitHub gave no data for it.
// `cost` is what the ticket's agents cost (USD), or null when no run comment of it gives one.
export type Entry = { number: number; title: string; cost: number | null; result: Result | null }
  | { number: number; title: null; cost: null; result: null };
export type Facts = {
  base: string; main: string; needsHuman: string;
  tickets: Entry[];
  // The cards of the open issues in the Needs Human column, or null when they could not be read.
  // `cost` is what the ticket's agents cost, or null when no run comment gives one: not merged, but spent all the same.
  stuck: { number: number; title: string; cost: number | null }[] | null;
  // The tickets a `dynamo run` skipped, with why; only a run knows them, so a report made by hand has none.
  skipped?: Skipped[];
  // The epics whose sub-issues are all in the release: the report closes them too.
  epics?: number[];
};

export type Skipped = { number: number; why: string };

// The skipped tickets as `run` writes them for the report (`[{ "number", "why" }]`), or null when that is not their shape.
export function skippedOf(json: string): Skipped[] | null {
  let list: unknown;
  try { list = JSON.parse(json); } catch { return null; }
  if (!Array.isArray(list)) return null;
  const out: Skipped[] = [];
  for (const s of list) {
    const { number, why } = typeof s === 'object' && s !== null ? (s as Record<string, unknown>) : {};
    if (typeof number !== 'number' || typeof why !== 'string') return null;
    out.push({ number, why });
  }
  return out;
}

function line(e: Entry): string {
  if (e.title === null) return `- #${e.number}: merged; no ticket data on GitHub`;
  const title = ` «${e.title}»`;
  if (e.result === null) return `- #${e.number}${title}: merged; no result comment on the ticket`;
  const rounds = e.result.rounds === null || e.result.rounds === '' ? '' : `, rounds ${e.result.rounds}`;
  return `- #${e.number}${title}: last result comment «${flat(e.result.head)}»${rounds}`;
}

const usd = (n: number): string => `${n.toFixed(4)} USD`;

export function render(f: Facts): string {
  const epics = f.epics ?? [];
  const seen = f.tickets.flatMap((e) => {
    const text = outOfTicket(e.result === null ? null : e.result.out);
    return text === null ? [] : [`- #${e.number}: ${text}`];
  });
  // The tickets stopped in Needs Human that spent something: their cost counts, merged or not.
  const spent = (f.stuck ?? []).filter((t) => t.cost !== null && !f.tickets.some((e) => e.number === t.number));
  const stuck = f.stuck === null ? ['- not read']
    : f.stuck.length === 0 ? ['- none']
    : f.stuck.map((t) => `- #${t.number} «${flat(t.title)}»`);
  return [
    `## release report · ${f.base}`, '',
    `Tickets merged into ${f.base} since ${f.main}: ${f.tickets.length}, from the \`(#n)\` of its merge commits.`, '',
    '### Tickets', '', ...(f.tickets.length ? f.tickets.map(line) : ['- none']), '',
    `### ${f.needsHuman}`, '', ...stuck, '',
    ...(f.skipped === undefined ? [] : [
      '### Skipped by the run', '', ...(f.skipped.length ? f.skipped.map((s) => `- #${s.number}: ${flat(s.why)}`) : ['- none']), '',
    ]),
    '### Out of the ticket (for the backlog)', '', ...(seen.length ? seen : ['- nothing']), '',
    ...(epics.length === 0 ? [] : [
      '### Epics this release closes', '',
      'For each, move the decisions that still hold to the documentation (`CLAUDE.md` or the docs of the project) before merging: '
        + 'the issue is a work order, the repository keeps what lasts.', '',
      ...epics.map((n) => `- #${n}`), '',
    ]),
    '### Cost', '', ...f.tickets.map((e) => `- #${e.number}: ${e.cost === null ? 'no cost recorded' : usd(e.cost)}`),
    ...spent.map((t) => `- #${t.number}: ${usd(t.cost ?? 0)} (not merged)`),
    `- Total: ${usd([...f.tickets, ...spent].reduce((sum, e) => sum + (e.cost ?? 0), 0))}`, '',
    ...f.tickets.map((e) => `Closes #${e.number}`),
    ...epics.map((n) => `Closes #${n}`),
  ].join('\n').trim() + '\n';
}

// The push comes first whenever the remote lacks commits, with a PR or without one. A PR that is open gets its body
// replaced with the report. A remote that differs with nothing
// to push gets no PR command: the human looks at the difference first (see remoteNote).
export function commands(base: string, main: string, repo: string, file: string, remote: Remote, pr: number | null): string[] {
  if (remote.state === 'different') return [];
  const push = remote.state === 'missing' || remote.state === 'behind';
  return [
    ...(push ? [`git push -u origin ${base}`] : []),
    pr !== null
      ? `gh pr edit ${pr} -R ${repo} --body-file ${file}`
      : `gh pr create -R ${repo} --base ${main} --head ${base} --title "Release ${base.replace(/^release\//, '')}" --body-file ${file}`,
  ];
}

// What the remote needs the human to look at, in a sentence; null when there is nothing to say.
export function remoteNote(remote: Remote, base: string): string | null {
  const n = remote.missing === null ? 'some' : String(remote.missing);
  switch (remote.state) {
    case 'unknown': return 'the remote (origin) could not be read: check that it has the base before the push';
    case 'missing': return `${base} is not on the remote (origin): the push creates it; ${n} commits are not on origin yet`;
    case 'behind': return `the remote ${base} is behind ${base} here: ${n} commits are not on it; push first`;
    case 'different': return `the remote ${base} is not at ${base} here, with no commit to push: look at the difference before pushing`;
    default: return null;
  }
}
