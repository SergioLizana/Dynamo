// The release report as text, and the commands the human runs after it. Pure: facts in, text out; the subcommand `report`
// reads them, writes the file and prints the commands. Nothing here is run.
import type { Remote, Result } from './releases.ts';
import { PLACEHOLDER, oneLine, outOfTicket } from './releases.ts';

// `result` is null when the ticket has no result comment; the whole entry is null when GitHub gave no data for it.
export type Entry = { number: number; title: string; result: Result | null } | { number: number; title: null; result: null };
export type Facts = {
  base: string; main: string; needsHuman: string;
  tickets: Entry[];
  // The cards of the open issues in the Needs Human column, or null when they could not be read.
  stuck: { number: number; title: string }[] | null;
  // The `/cost` line kept from the open PR, if there is one and it has one.
  cost: string | null;
};

function line(e: Entry): string {
  if (e.title === null) return `- #${e.number}: merged; no ticket data on GitHub`;
  const title = ` «${e.title}»`;
  if (e.result === null) return `- #${e.number}${title}: merged; no result comment on the ticket`;
  const rounds = e.result.rounds === null || e.result.rounds === '' ? '' : `, rounds ${e.result.rounds}`;
  return `- #${e.number}${title}: last result comment «${oneLine(e.result.head, 200)}»${rounds}`;
}

export function render(f: Facts): string {
  const seen = f.tickets.flatMap((e) => {
    const text = outOfTicket(e.result === null ? null : e.result.out);
    return text === null ? [] : [`- #${e.number}: ${text}`];
  });
  const stuck = f.stuck === null ? ['- not read']
    : f.stuck.length === 0 ? ['- none']
    : f.stuck.map((t) => `- #${t.number} «${oneLine(t.title, 160)}»`);
  return [
    `## release report · ${f.base}`, '',
    `Tickets merged into ${f.base} since ${f.main}: ${f.tickets.length}, from the \`(#n)\` of its merge commits.`, '',
    '### Tickets', '', ...(f.tickets.length ? f.tickets.map(line) : ['- none']), '',
    `### ${f.needsHuman}`, '', ...stuck, '',
    '### Out of the ticket (for the backlog)', '', ...(seen.length ? seen : ['- nothing']), '',
    '### Cost', '', `- \`/cost\` of the session: ${f.cost ?? PLACEHOLDER}`, '',
    ...f.tickets.map((e) => `Closes #${e.number}`),
  ].join('\n').trim() + '\n';
}

// The push comes first whenever the remote lacks commits, with a PR or without one. A PR that is open gets its body
// replaced with the report; `/cost` stays in it because the report keeps that line.
export function commands(base: string, main: string, repo: string, file: string, remote: Remote, pr: number | null): string[] {
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
