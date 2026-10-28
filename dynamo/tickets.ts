// The tickets as GitHub has them: their card on the board, their labels and their blockers (the native relation), read
// with one GraphQL query per page through gh. Only the issues asked for, or the open ones: never the board's list of
// cards (documentation/board-guide.md). Every list is read in full or the read fails, since a cut list would hide a
// blocker or a label.
import type { Deps } from './cli.ts';

export type Where = { repo: string; boardId: string; statusFieldId: string; doneLabel: string };
export type Blocker = { number: number; state: string; doneLabel: boolean };
export type Ticket = { number: number; title: string; state: string; column: string | null; doneLabel: boolean; blockers: Blocker[] };
// `missing`: the numbers asked for that GitHub does not know as issues.
export type Tickets = { found: Ticket[]; missing: number[] };

const FIELDS = 'number title state labels(first:50){totalCount nodes{name}} '
  + 'projectItems(first:10){totalCount nodes{project{id} fieldValues(first:20){totalCount nodes{'
  + '... on ProjectV2ItemFieldSingleSelectValue{name field{... on ProjectV2SingleSelectField{id}}}}}}} '
  + 'blockedBy(first:25){totalCount nodes{number state labels(first:25){totalCount nodes{name}}}}';
const PAGE = 50;

export function readTickets(gh: Deps['gh'], where: Where, numbers: number[]): Tickets {
  if (numbers.length) {
    const body = numbers.map((n) => `t${n}:issue(number:${n}){...F}`).join(' ');
    const repository = query(gh, where, `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){${body}}}`, undefined);
    const found = numbers.filter((n) => repository[`t${n}`] !== null).map((n) => toTicket(repository[`t${n}`], where));
    return { found, missing: numbers.filter((n) => repository[`t${n}`] === null) };
  }
  const found: Ticket[] = [];
  let after: string | undefined;
  do {
    const repository = query(gh, where, 'query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){'
      + `issues(states:OPEN,first:${PAGE},after:$after){pageInfo{hasNextPage endCursor} nodes{...F}}}}`, after);
    const issues = get(repository, 'issues');
    const nodes = get(issues, 'nodes'), page = get(issues, 'pageInfo');
    if (!Array.isArray(nodes) || typeof get(page, 'hasNextPage') !== 'boolean') throw new Error('GitHub returned a list of open issues that cannot be read');
    found.push(...nodes.map((n) => toTicket(n, where)));
    const cursor = get(page, 'endCursor');
    if (get(page, 'hasNextPage') && typeof cursor !== 'string') throw new Error('GitHub says there are more open issues but gives no cursor for the next page');
    after = get(page, 'hasNextPage') ? String(cursor) : undefined;
  } while (after !== undefined);
  return { found, missing: [] };
}

// Runs the query and returns `data.repository`. A missing issue asked for by its alias (`t<n>`) is the one error
// accepted: GitHub then answers with the data and exits 1. Anything else fails with GitHub's reason.
function query(gh: Deps['gh'], where: Where, text: string, after: string | undefined): Record<string, unknown> {
  const [owner, name] = where.repo.split('/');
  const r = gh(['api', 'graphql', '-f', `query=${text} fragment F on Issue{${FIELDS}}`, '-f', `owner=${owner}`, '-f', `name=${name}`,
    ...(after === undefined ? [] : ['-f', `after=${after}`])]);
  let answer: unknown;
  try { answer = JSON.parse(r.stdout); } catch { answer = undefined; }
  const errors = get(answer, 'errors');
  const list = Array.isArray(errors) ? errors : [];
  const missing = (e: unknown) => {
    const path = get(e, 'path');
    return get(e, 'type') === 'NOT_FOUND' && Array.isArray(path) && path.length === 2 && /^t\d+$/.test(String(path[1]));
  };
  const repository = get(get(answer, 'data'), 'repository');
  const failed = !isObject(repository) || list.some((e) => !missing(e)) || (r.code !== 0 && list.length === 0);
  if (failed) {
    const reasons = list.map((e) => get(e, 'message')).filter((m) => typeof m === 'string');
    const reason = [r.stderr.trim(), ...reasons].filter((s) => s !== '').join('; ') || 'no reason given';
    throw new Error(`gh api graphql failed (exit ${r.code}): ${reason}`);
  }
  return repository as Record<string, unknown>;
}

function toTicket(node: unknown, where: Where): Ticket {
  const number = get(node, 'number'), title = get(node, 'title'), state = get(node, 'state');
  if (typeof number !== 'number' || typeof title !== 'string' || typeof state !== 'string') {
    throw new Error(`GitHub returned an issue that cannot be read: ${JSON.stringify(node)}`);
  }
  const at = `#${number}`;
  const column = all(get(node, 'projectItems'), `the cards of ${at}`)
    .filter((item) => get(get(item, 'project'), 'id') === where.boardId)
    .flatMap((item) => all(get(item, 'fieldValues'), `the fields of the card of ${at}`))
    .filter((v) => get(get(v, 'field'), 'id') === where.statusFieldId)
    .map((v) => get(v, 'name')).find((s) => typeof s === 'string');
  const blockers = all(get(node, 'blockedBy'), `the blockers of ${at}`).map((b): Blocker => {
    const n = get(b, 'number'), s = get(b, 'state');
    if (typeof n !== 'number' || typeof s !== 'string') throw new Error(`GitHub returned a blocker of ${at} that cannot be read`);
    return { number: n, state: s, doneLabel: labels(get(b, 'labels'), `the labels of #${n}`).includes(where.doneLabel) };
  });
  return {
    number, title, state, column: typeof column === 'string' ? column : null,
    doneLabel: labels(get(node, 'labels'), `the labels of ${at}`).includes(where.doneLabel), blockers,
  };
}

const labels = (connection: unknown, what: string) => all(connection, what).map((l) => get(l, 'name'));

// The nodes of a GraphQL list, if GitHub returned all of them.
function all(connection: unknown, what: string): unknown[] {
  const nodes = get(connection, 'nodes'), total = get(connection, 'totalCount');
  if (!Array.isArray(nodes) || typeof total !== 'number') throw new Error(`GitHub returned ${what} in a shape that cannot be read`);
  if (nodes.length !== total) throw new Error(`GitHub cut ${what} (${nodes.length} of ${total}): the read stops rather than miss one`);
  return nodes;
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const get = (x: unknown, key: string): unknown => (isObject(x) ? x[key] : undefined);
