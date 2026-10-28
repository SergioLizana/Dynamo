// `dynamo report [base]`: the release report of the working branch (or of the base given), built from state and written to
// a file: the tickets merged into it since the main branch (the `(#n)` of its merge commits), the last result comment of
// each, the tickets in Needs Human (read from the card of each open issue, never from the board's list of cards) and the
// `/cost` line of the open release PR. It prints the commands the human runs next (the push, then `gh pr create` or
// `gh pr edit`) and never runs them.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Deps, Output } from './cli.ts';
import { setting, usage } from './cli.ts';
import { endOf } from './checks.ts';
import type { Entry } from './reports.ts';
import { commands, remoteNote, render } from './reports.ts';
import { costOf, lastResult, mergedTickets, prOf, remoteOf, ticketOf } from './releases.ts';
import { readTickets } from './tickets.ts';

// A branch name goes into commands the human copies: nothing that a shell could read as something else, and no option.
const SAFE = /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/;

export function report(args: string[], deps: Deps): Output {
  if (args.length > 1) usage('usage: report [base]');
  const factory = deps.factory();
  const project = factory.project;
  const repo = setting(project, 'project', 'repo');
  const main = setting(project, 'project', 'mainBranch');
  const base = args[0] ?? setting(project, 'project', 'workingBranch');
  const needsHuman = setting(factory.columns, 'columns', 'needsHuman');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`factory.json: project.repo «${repo}» is not owner/name`);
  if (!SAFE.test(base)) usage(`${base} is not a branch name that is safe to put in a command`);
  if (base === main) throw new Error(`the base is the main branch (${main}): there is no release to report`);

  const notes: string[] = [];
  const read = (args: string[], what: string): string => {
    const r = deps.git(args);
    if (r.code !== 0) throw new Error(`${what} failed (git ${args[0]} exited ${r.code}): ${endOf(r)}`);
    return r.stdout.trim();
  };
  const top = read(['rev-parse', '--show-toplevel'], 'finding the repository');
  const local = read(['rev-parse', '--short', '--verify', `${base}^{commit}`], `finding ${base} here`);
  const merged = mergedTickets(read(['log', '--first-parent', '--format=%p%x09%s', `${main}..${base}`], `reading the merges of ${base} since ${main}`));

  const tickets = merged.map((n): Entry => {
    const r = deps.gh(['issue', 'view', String(n), '-R', repo, '--json', 'title,comments']);
    try {
      if (r.code !== 0) throw new Error(endOf(r));
      const t = ticketOf(r.stdout);
      return { number: n, title: t.title, result: lastResult(t.comments) };
    } catch (e) {
      notes.push(`#${n} could not be read: ${e instanceof Error ? e.message : String(e)}`);
      return { number: n, title: null, result: null };
    }
  });

  // The cards of the open issues: one query for them all, with their columns, not the board's list.
  let stuck: { number: number; title: string }[] | null = null;
  try {
    const where = {
      repo, boardId: setting(project, 'project', 'boardId'), statusFieldId: setting(project, 'project', 'statusFieldId'),
      doneLabel: setting(project, 'project', 'doneLabel'),
    };
    stuck = readTickets(deps.gh, where, []).found.filter((t) => t.column === needsHuman).sort((a, b) => a.number - b.number)
      .map((t) => ({ number: t.number, title: t.title }));
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
    notes.push(`the pull requests could not be read, so the /cost line of ${base} is not kept and \`gh pr create\` may be the wrong command: `
      + `${e instanceof Error ? e.message : String(e)}`);
  }

  const lsRemote = deps.git(['ls-remote', '--heads', 'origin', base]);
  const ahead = deps.git(['rev-list', '--count', base, '--not', '--remotes=origin']);
  const remote = remoteOf(local, lsRemote.code === 0 ? lsRemote.stdout : null, ahead.code === 0 ? ahead.stdout : null);
  const remoteSaid = remoteNote(remote, base);
  if (remoteSaid !== null) notes.push(remoteSaid);

  const dir = join(top, '.claude', 'worktrees');
  const name = `release-report-${base.replace(/[^A-Za-z0-9._-]+/g, '-')}.md`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), render({ base, main, needsHuman, tickets, stuck, cost: pr === null ? null : costOf(pr.body) }));

  // Relative to the repository root, with forward slashes: the commands read the same on every system.
  const file = `.claude/worktrees/${name}`;
  return {
    ok: true, base, file, merged: merged.length, needsHuman: stuck === null ? null : stuck.length,
    pr: pr === null ? null : pr.number, prKnown, remote: remote.state,
    commands: commands(base, main, repo, file, remote, pr === null ? null : pr.number), notes,
  };
}
