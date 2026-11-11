// The model and effort each level of difficulty runs its agents with (`project.levels` of factory.json; `project` is its
// block). Pure: a project sets only what it wants to change and the rest is the starting values of the epic #222.
export const LEVELS = ['low', 'medium', 'high'] as const;
export type Level = (typeof LEVELS)[number];

const AGENTS = ['builder', 'reviewer'] as const;
export type Agent = (typeof AGENTS)[number];

// The efforts `claude --effort` takes.
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

// `effort` null is no `--effort`: the agent runs with the effort of its own file or of its model.
export type Setting = { model: string; effort: string | null };
export type Levels = Record<Level, Record<Agent, Setting>>;

// Haiku is not among them: a cheap Builder that fails and repeats costs more than a good one at the first try. The Reviewer
// of `high` is today's, `opus` with no effort set.
export const STARTING: Levels = {
  low: { builder: { model: 'sonnet', effort: 'low' }, reviewer: { model: 'sonnet', effort: 'medium' } },
  medium: { builder: { model: 'sonnet', effort: 'medium' }, reviewer: { model: 'sonnet', effort: 'high' } },
  high: { builder: { model: 'sonnet', effort: 'high' }, reviewer: { model: 'opus', effort: null } },
};

const asObject = (v: unknown, key: string): Record<string, unknown> => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`factory.json: ${key} must be an object`);
  return v as Record<string, unknown>;
};

const unknownKeys = (o: Record<string, unknown>, known: readonly string[], key: string): void => {
  const extra = Object.keys(o).find((k) => !known.includes(k));
  if (extra !== undefined) throw new Error(`factory.json: ${key}.${extra} is not one of ${known.join(', ')}`);
};

function settingOf(start: Setting, given: unknown, key: string): Setting {
  if (given === undefined) return { ...start };
  const o = asObject(given, key);
  unknownKeys(o, ['model', 'effort'], key);
  const { model, effort } = o;
  if (model !== undefined && (typeof model !== 'string' || model.trim() === '')) throw new Error(`factory.json: ${key}.model must be a model name`);
  if (effort !== undefined && !(EFFORTS as readonly unknown[]).includes(effort)) throw new Error(`factory.json: ${key}.effort must be one of ${EFFORTS.join(', ')}`);
  return { model: model ?? start.model, effort: (effort as string | undefined) ?? start.effort };
}

// The level of a ticket, from the `Level: low|medium|high` line of its body (set by /dynamo:to-tickets; the human can change
// it). A ticket with no such line, as every older one, or a line that names no level, runs as `high`, which is today's.
export function levelOf(body: string | null): Level {
  const line = body === null ? null : /^Level:[ \t]*(low|medium|high)[ \t]*\r?$/im.exec(body);
  return line === null ? 'high' : (line[1].toLowerCase() as Level);
}

// The settings of every level: what `project.levels` changes, field by field, over the starting values. A key that is not
// a level, an agent, `model` or `effort` is an error, so a typo does not pass for the default.
export function levelsOf(project: Record<string, unknown>): Levels {
  const given = project.levels === undefined ? {} : asObject(project.levels, 'project.levels');
  unknownKeys(given, LEVELS, 'project.levels');
  const out = {} as Levels;
  for (const level of LEVELS) {
    const key = `project.levels.${level}`;
    const l = given[level] === undefined ? {} : asObject(given[level], key);
    unknownKeys(l, AGENTS, key);
    out[level] = {
      builder: settingOf(STARTING[level].builder, l.builder, `${key}.builder`),
      reviewer: settingOf(STARTING[level].reviewer, l.reviewer, `${key}.reviewer`),
    };
  }
  return out;
}
