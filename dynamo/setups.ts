// The decisions of `dynamo setup` as data: the checks it is given, the project values read from gh and git, the
// factory.json it builds from the template, and what it suggests when a check cannot start. Pure: the subcommand
// `setup` reads gh and git, runs the checks and writes the file.
import { usage } from './cli.ts';
import { words } from './checks.ts';
import { COLUMNS } from './columns.ts';
import type { Check } from './checks.ts';
import type { Factory } from './factory.ts';

// The values the setup reads from the project; every other value comes from the template.
export type Values = { repo: string; boardOwner: string; mainBranch: string };

const USAGE = 'usage: setup --check <command> [--check <command>]... [--language <name>]';

// The board every project's board is a copy of: the human's template (public, empty, English), whose owner and number are a
// constant of the code.
export const TEMPLATE_BOARD = { owner: 'SergioLizana', number: 3 } as const;

// The block `board` of factory.json: the ids of the GitHub project, read from GitHub, keyed by the names of Dynamo's columns.
export type Board = { boardNumber: number; boardId: string; boardName: string; statusFieldId: string; options: Record<string, string> };

// The commands of the `--check` arguments, in order, trimmed, and the language of `--language`, trimmed (null when not given;
// the last one wins). None of them is required here (a project that already has a factory.json keeps its checks and its
// language; the subcommand asks for the checks when it has none), and nothing but these two is accepted.
export function setupArgsOf(args: string[]): { checks: string[]; language: string | null } {
  const checks: string[] = [];
  let language: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const flag = ['--check', '--language'].find((f) => arg === f || arg.startsWith(`${f}=`));
    if (flag === undefined) usage(`${arg} is not an argument of setup; ${USAGE}`);
    const value = (arg.startsWith(`${flag}=`) ? arg.slice(flag.length + 1) : args[++i] ?? '').trim();
    if (value === '') usage(`${flag} needs a value; ${USAGE}`);
    if (flag === '--check') checks.push(value);
    else language = value;
  }
  return { checks, language };
}

// The commands of the `--check` arguments, in order.
export function checksOf(args: string[]): string[] {
  return setupArgsOf(args).checks;
}

// `gh repo view --json nameWithOwner,owner`: the repository's name and the login that owns the board. null if either is missing.
export function repoOf(json: string): { repo: string; boardOwner: string } | null {
  let answer: unknown;
  try { answer = JSON.parse(json); } catch { return null; }
  if (typeof answer !== 'object' || answer === null) return null;
  const { nameWithOwner, owner } = answer as Record<string, unknown>;
  const login = typeof owner === 'object' && owner !== null ? (owner as Record<string, unknown>).login : undefined;
  if (typeof nameWithOwner !== 'string' || nameWithOwner === '' || typeof login !== 'string' || login === '') return null;
  return { repo: nameWithOwner, boardOwner: login };
}

// The main branch: the one `origin/HEAD` points to (`origin/main` → `main`), else the branch checked out. null if neither says.
export function mainBranchOf(originHead: string, current: string): string | null {
  const head = originHead.trim();
  if (head.startsWith('origin/') && head.length > 'origin/'.length) return head.slice('origin/'.length);
  return current.trim() === '' ? null : current.trim();
}

// The template with the values read and the checks given. The template itself is not changed.
// `language` is `project.documentsLanguage`; null keeps the template's (English).
export function withValues(template: Factory, values: Values, checks: string[], language: string | null = null): Factory {
  return { ...template, project: { ...template.project, ...values, checks, ...(language === null ? {} : { documentsLanguage: language }) } };
}

// What to suggest when a check gives 127 (its program could not start). An npm script is named by its own script; any other
// command gets the form with a placeholder. `npm` cannot run without a shell on Windows, `node --run` can.
export function hintFor(command: string, code: number): string | null {
  if (code !== 127) return null;
  const [program, first, second] = words(command);
  let script: string | undefined;
  if (program === 'npm' && (first === 'run' || first === 'run-script')) script = second;
  else if (program === 'npm' && (first === 'test' || first === 'start')) script = first;
  const form = script === undefined || script.startsWith('-') ? 'node --run <script>' : `node --run ${script}`;
  return `the program could not start (127). If this is a script of package.json, write the check as \`${form}\`: npm cannot run without a shell on Windows`;
}

// The first check that did not pass, or null.
export function failedCheck(checks: Check[]): Check | null {
  return checks.find((c) => c.code !== 0) ?? null;
}

// The title of the new board: the name of the repository, without its owner.
export function boardTitle(repo: string): string {
  return repo.slice(repo.indexOf('/') + 1);
}

// `gh project copy … --format json`: the number of the new board, or null.
export function copiedNumber(json: string): number | null {
  const answer = parse(json);
  const number = answer === null ? undefined : answer.number;
  return typeof number === 'number' && Number.isInteger(number) && number > 0 ? number : null;
}

// The `board` block, read from `gh project view <n> --format json` (id and title) and `gh project field-list <n> --format json`
// (the Status field and the ids of its options). It throws, saying what is wrong, if a column of Dynamo is not on the board.
export function boardOf(number: number, view: string, fieldList: string): Board {
  const shown = parse(view);
  const id = shown?.id;
  const title = shown?.title;
  if (typeof id !== 'string' || id === '' || typeof title !== 'string' || title === '') throw new Error(`gh gave no id or title for board ${number}`);
  const fields = parse(fieldList)?.fields;
  const status = Array.isArray(fields) ? fields.map(object).find((f) => f?.name === 'Status') : undefined;
  if (status === undefined || typeof status.id !== 'string' || !Array.isArray(status.options)) throw new Error(`board ${number} has no Status field with columns`);
  const found = new Map<string, string>();
  for (const o of status.options.map(object)) if (typeof o?.name === 'string' && typeof o.id === 'string') found.set(o.name, o.id);
  const names = Object.values(COLUMNS);
  const missing = names.filter((n) => !found.has(n));
  if (missing.length > 0) throw new Error(`board ${number} has no column ${missing.join(', ')}: they are Dynamo's, the board must be a copy of the template`);
  return { boardNumber: number, boardId: id, boardName: title, statusFieldId: status.id, options: Object.fromEntries(names.map((n) => [n, found.get(n) as string])) };
}

// The labels in `wanted` that `gh label list --json name` does not show, in order and once each.
export function missingLabels(json: string, wanted: string[]): string[] {
  let list: unknown;
  try { list = JSON.parse(json); } catch { list = null; }
  if (!Array.isArray(list)) throw new Error('gh gave no list of labels');
  const have = new Set(list.map((l) => (typeof l === 'object' && l !== null ? (l as Record<string, unknown>).name : undefined)));
  return [...new Set(wanted)].filter((n) => !have.has(n));
}

// The factory with its board block set; the one given is not changed.
export function withBoard(factory: Factory, board: Board): Factory {
  return { ...factory, board };
}

// A JSON object, or null.
function parse(json: string): Record<string, unknown> | null {
  try { return object(JSON.parse(json)); } catch { return null; }
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

// The package manager of a project, from the lock file it has: `npm` with package-lock.json, else the name of another
// manager, else null. Dependabot is seeded only for npm.
export function managerOf(has: (name: string) => boolean): string | null {
  if (has('package-lock.json')) return 'npm';
  const others: [string, string][] = [['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lock', 'bun'], ['bun.lockb', 'bun']];
  return others.find(([lock]) => has(lock))?.[1] ?? null;
}

// The Dependabot file for an npm project: the root, weekly, and every update in one group so a week brings one pull request.
export function dependabotFile(): string {
  return [
    'version: 2',
    'updates:',
    '  - package-ecosystem: npm',
    '    directory: /',
    '    schedule:',
    '      interval: weekly',
    '    groups:',
    '      npm:',
    '        patterns:',
    '          - "*"',
    '',
  ].join('\n');
}

// `gh repo view --json isPrivate`: true only when gh says the repository is not private (an answer without it is not public).
export function isPublic(json: string): boolean {
  try {
    const answer: unknown = JSON.parse(json);
    return typeof answer === 'object' && answer !== null && (answer as Record<string, unknown>).isPrivate === false;
  } catch { return false; }
}
