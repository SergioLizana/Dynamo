// `dynamo report [base]`: the release report of the working branch (or of the base given), built from state and written to
// a file: the tickets merged into it since the main branch (the `(#n)` of its merge commits), the last result comment of
// each, the tickets in Needs Human (read from the card of each open issue, never from the board's list of cards) and the
// cost of each ticket's agents, summed from its run comments. It prints the commands the human runs next (the push, then `gh pr create` or
// `gh pr edit`) and never runs them. `--skipped <file>` adds the tickets a `dynamo run` skipped, which no state keeps.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Deps, Output } from './cli.ts';
import { setting, usage } from './cli.ts';
import { COLUMNS } from './columns.ts';
import { endOf } from './checks.ts';
import type { Entry, Skipped } from './reports.ts';
import { commands, remoteNote, render, skippedOf } from './reports.ts';
import { lastResult, mergedTickets, prOf, remoteOf, runCost, ticketOf } from './releases.ts';
import { SAFE, closedEpics, gitText } from './releasing.ts';
import { readTickets } from './tickets.ts';
import { releaseBranch } from './working.ts';

export function report(args: string[], deps: Deps): Output {
  const at = args.indexOf('--skipped');
  const rest = at === -1 ? args : args.filter((_, i) => i !== at && i !== at + 1);
  if (rest.length > 1 || (at !== -1 && !args[at + 1])) usage('usage: report [base] [--skipped <file>]');
  const skipped = at === -1 ? undefined : readSkipped(args[at + 1]);
  const factory = deps.factory();
  const project = factory.project;
  const repo = setting(project, 'project', 'repo');
  const main = setting(project, 'project', 'mainBranch');
  const base = rest[0] ?? releaseBranch(deps);
  const needsHuman = COLUMNS.needsHuman;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`factory.json: project.repo «${repo}» is not owner/name`);
  if (!SAFE.test(base)) usage(`${base} is not a branch name that is safe to put in a command`);
  if (base === main) throw new Error(`the base is the main branch (${main}): there is no release to report`);

  const notes: string[] = [];
  const read = (args: string[], what: string): string => gitText(deps.git, args, what);
  const top = read(['rev-parse', '--show-toplevel'], 'finding the repository');
  const local = read(['rev-parse', '--short', '--verify', `${base}^{commit}`], `finding ${base} here`);
  const merged = mergedTickets(read(['log', '--first-parent', '--format=%p%x09%s', `${main}..${base}`], `reading the merges of ${base} since ${main}`));

  const parents = new Set<number>();
  const tickets = merged.map((n): Entry => {
    const r = deps.gh(['issue', 'view', String(n), '-R', repo, '--json', 'title,comments,parent']);
    try {
      if (r.code !== 0) throw new Error(endOf(r));
      const t = ticketOf(r.stdout);
      if (t.parent !== null) parents.add(t.parent);
      return { number: n, title: t.title, cost: runCost(t.comments), result: lastResult(t.comments) };
    } catch (e) {
      notes.push(`#${n} could not be read: ${e instanceof Error ? e.message : String(e)}`);
      return { number: n, title: null, cost: null, result: null };
    }
  });

  // An epic is closed by the release when all its sub-issues are in it; one that cannot be read is left open, with a note.
  const epics = closedEpics(deps.gh, repo, parents, merged, notes);

  // What the agents of a ticket that was not merged cost: its run comments say it all the same. A ticket that cannot be read
  // adds a note and counts as no cost.
  const costOf = (n: number): number | null => {
    try {
      const r = deps.gh(['issue', 'view', String(n), '-R', repo, '--json', 'title,comments,parent']);
      if (r.code !== 0) throw new Error(endOf(r));
      return runCost(ticketOf(r.stdout).comments);
    } catch (e) {
      notes.push(`the cost of #${n}, in ${needsHuman}, could not be read: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };

  // The cards of the open issues: one query for them all, with their columns, not the board's list.
  let stuck: { number: number; title: string; cost: number | null }[] | null = null;
  try {
    const where = {
      repo, boardId: setting(factory.board, 'board', 'boardId'), statusFieldId: setting(factory.board, 'board', 'statusFieldId'),
      doneLabel: setting(project, 'project', 'doneLabel'),
    };
    stuck = readTickets(deps.gh, where, []).found.filter((t) => t.column === needsHuman).sort((a, b) => a.number - b.number)
      .map((t) => ({ number: t.number, title: t.title, cost: costOf(t.number) }));
  } catch (e) {
    notes.push(`the cards in ${needsHuman} could not be read: ${e instanceof Error ? e.message : String(e)}`);
  }

  let pr: { number: number; body: string } | null = null;
  const prs = deps.gh(['pr', 'list', '-R', repo, '--head', base, '--base', main, '--state', 'open', '--json', 'number,url,body']);
  let prKnown = false;
  try {
    if (prs.code !== 0) throw new Error(endOf(prs));
    pr = prOf(prs.stdout);
    prKnown = true;
  } catch (e) {
    notes.push(`the pull requests could not be read, so \`gh pr create\` may be the wrong command: `
      + `${e instanceof Error ? e.message : String(e)}`);
  }

  const lsRemote = deps.git(['ls-remote', '--heads', 'origin', `refs/heads/${base}`]);
  const ahead = deps.git(['rev-list', '--count', base, '--not', '--remotes=origin']);
  const remote = remoteOf(local, lsRemote.code === 0 ? lsRemote.stdout : null, ahead.code === 0 ? ahead.stdout : null, base);
  const remoteSaid = remoteNote(remote, base);
  if (remoteSaid !== null) notes.push(remoteSaid);

  const dir = join(top, '.claude', 'worktrees');
  const name = `release-report-${base.replace(/[^A-Za-z0-9._-]+/g, '-')}.md`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), render({ base, main, needsHuman, tickets, stuck, skipped, epics }));

  // Relative to the repository root, with forward slashes: the commands read the same on every system.
  const file = `.claude/worktrees/${name}`;
  return {
    ok: true, base, file, merged: merged.length, needsHuman: stuck === null ? null : stuck.length,
    pr: pr === null ? null : pr.number, prKnown, remote: remote.state,
    commands: commands(base, main, repo, file, remote, pr === null ? null : pr.number), notes,
  };
}

function readSkipped(path: string): Skipped[] {
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch (e) { throw new Error(`cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`); }
  const skipped = skippedOf(text);
  if (skipped === null) throw new Error(`${path} is not a list of skipped tickets ([{ "number", "why" }])`);
  return skipped;
}
