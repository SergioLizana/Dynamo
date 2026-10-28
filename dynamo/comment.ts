// `dynamo comment <n> --body-file <file>`: posts the file as a comment on ticket n and checks it by reading that issue's
// comments back: the last one must be the file. It never posts twice: a comment that did not read back is reported, not
// retried, because the retry could make a second one.
import { readFileSync } from 'node:fs';
import type { Deps, Output } from './cli.ts';
import { setting, usage } from './cli.ts';
import { endOf } from './checks.ts';
import { lastComment, postArgs, readArgs, sameBody } from './comments.ts';

export function comment(args: string[], deps: Deps): Output {
  if (args.length !== 3 || !/^[1-9]\d*$/.test(args[0]) || args[1] !== '--body-file' || args[2] === '') usage('usage: comment <n> --body-file <file>');
  const n = Number(args[0]);
  const repo = setting(deps.factory().project, 'project', 'repo');
  const body = readBody(args[2]);

  const post = deps.gh(postArgs(repo, n), { input: body });
  if (post.code !== 0) throw new Error(`the comment was not posted on #${n}: ${endOf(post)}`);

  const read = deps.gh(readArgs(repo, n));
  if (read.code !== 0) throw new Error(`the comment was posted on #${n}, but it could not be read back: ${endOf(read)}`);
  const last = lastComment(read.stdout);
  if (last === null || !sameBody(body, last.body)) {
    return { ok: false, ticket: n, posted: true, error: `the last comment of #${n} is not the file ${args[2]}` };
  }
  return { ok: true, ticket: n, url: last.url };
}

function readBody(path: string): string {
  let body: string;
  try { body = readFileSync(path, 'utf8'); } catch (e) { throw new Error(`cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`); }
  if (body.trim() === '') throw new Error(`${path} is empty: there is nothing to post`);
  return body;
}
