// The pure part of what `dynamo setup` writes into the project's `.claude/settings.json` and `.gitignore`: fill the gaps of the
// template of the permission rules, add one rule per check, merge the result into what the file already has, and add the
// worktrees folder to the ignore list. Data in, data out: the subcommand reads and writes the files. `claude plugin install`
// writes to the same settings.json, so the merge adds what is missing and touches nothing else.
import type { Board } from './setups.ts';

// The values that fill the gaps `<name>` of templates/settings.json.
export type Gaps = { repo: string; boardOwner: string; mainBranch: string; boardNumber: number; boardId: string; statusFieldId: string };

type Json = Record<string, unknown>;

// The folder every copy lives in; the project's git must ignore it.
export const WORKTREES = '.claude/worktrees/';

export function gapsOf(values: { repo: string; boardOwner: string; mainBranch: string }, board: Board): Gaps {
  return { ...values, boardNumber: board.boardNumber, boardId: board.boardId, statusFieldId: board.statusFieldId };
}

// The template with every `<name>` of `gaps` replaced, in every string at any depth. The template is not changed. A gap that is
// not one of `gaps` (a `<base>` of a check, say) stays as it is.
export function fillSettings(template: unknown, gaps: Gaps): unknown {
  if (typeof template === 'string') return template.replace(/<(\w+)>/g, (whole, name: string) => (Object.hasOwn(gaps, name) ? String(gaps[name as keyof Gaps]) : whole));
  if (Array.isArray(template)) return template.map((item) => fillSettings(item, gaps));
  if (typeof template === 'object' && template !== null) return Object.fromEntries(Object.entries(template).map(([k, v]) => [k, fillSettings(v, gaps)]));
  return template;
}

// The rule that lets the factory run a check as it is written in factory.json. A `<base>` in the check is the branch a run
// names, which a rule cannot know, so it becomes `*`.
export const ruleOf = (check: string): string => `Bash(${check.replaceAll('<base>', '*')})`;

// The settings the setup needs, from the filled template: its `allow` list gets one rule per check, and the block is checked to
// be a settings object. Throws, saying what is wrong, for a template that is not one.
export function neededSettings(filled: unknown, checks: string[]): Json {
  const settings = object(filled);
  if (settings === null) throw new Error('templates/settings.json is not a JSON object');
  const permissions = object(settings.permissions) ?? {};
  const allow = Array.isArray(permissions.allow) ? permissions.allow : [];
  return { ...settings, permissions: { ...permissions, allow: [...allow, ...checks.map(ruleOf)] } };
}

// `existing` (the file's content, or null for no file) with what `needed` asks added. Only what is missing is added: lists of
// rules keep the file's own, in its order, and get the missing ones at the end, once each; objects are merged key by key; any
// other value the file already has stays as it is, even if it is not what the factory wants (see `keptSettings`). Neither
// argument is changed.
export function mergeSettings(existing: unknown, needed: Json): Json {
  return mergeWithNotes(existing, needed).settings;
}

// What the file has that differs from what `needed` asks and that `mergeSettings` therefore keeps, one sentence each, for the
// setup to say. Empty for no file, or a file that has everything as asked.
export function keptSettings(existing: unknown, needed: Json): string[] {
  return mergeWithNotes(existing, needed).kept;
}

function mergeWithNotes(existing: unknown, needed: Json): { settings: Json; kept: string[] } {
  const kept: string[] = [];
  if (existing === null || existing === undefined) return { settings: merge({}, needed, '', kept), kept };
  const have = object(existing);
  if (have === null) throw new Error('.claude/settings.json is not a JSON object; nothing was written');
  return { settings: merge(have, needed, '', kept), kept };
}

function merge(have: Json, needed: Json, path: string, kept: string[]): Json {
  const out: Json = { ...have };
  for (const [key, want] of Object.entries(needed)) {
    const where = path === '' ? key : `${path}.${key}`;
    if (!Object.hasOwn(out, key) || out[key] === undefined) {
      out[key] = Array.isArray(want) ? want.filter((item, i) => !want.slice(0, i).some((x) => same(x, item))) : object(want) !== null ? merge({}, want as Json, where, kept) : want;
      continue;
    }
    const was = out[key];
    if (Array.isArray(want) && Array.isArray(was)) {
      out[key] = [...was, ...want.filter((item, i) => !was.some((x) => same(x, item)) && !want.slice(0, i).some((x) => same(x, item)))];
    } else if (object(want) !== null && object(was) !== null) {
      out[key] = merge(was as Json, want as Json, where, kept);
    } else if (!same(was, want)) {
      kept.push(`${where} is ${JSON.stringify(was)} in the file and was kept; the factory wants ${JSON.stringify(want)}`);
    }
  }
  return out;
}

// The text of .gitignore with `.claude/worktrees/` added as its last line, or null if some line already ignores that folder.
// The line endings and the missing final newline of the file are kept.
export function withIgnore(text: string | null): string | null {
  const lines = (text ?? '').split(/\r?\n/).map((l) => l.trim());
  if (lines.some((l) => ['.claude/worktrees', '.claude/worktrees/', '/.claude/worktrees', '/.claude/worktrees/'].includes(l))) return null;
  const eol = text !== null && text.includes('\r\n') ? '\r\n' : '\n';
  const body = text === null || text === '' ? '' : text.endsWith('\n') ? text : text + eol;
  return body + WORKTREES + eol;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function object(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null;
}
