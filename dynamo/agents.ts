// What dynamo asks of a `claude -p` agent and what it makes of the answer: the arguments of the call, and the reading of its
// `stream-json` output. Pure: the edge that runs claude is claude.ts. The stream was probed on Claude Code 2.1.312: the last line
// is a `result` with the cost, the turns, the session and, when a schema was given, the
// `structured_output`; a spent `--max-budget-usd` ends it with subtype `error_max_budget_usd`, terminal_reason
// `budget_exhausted` and is_error true. The usage limit is a `result` whose `api_error` is `usage_limit_reached`, with the
// time it resets in `resetsAt` (on the result, or in the last `rate_limit_event` before it): the only end that pauses a
// ticket. Any other end that is neither a success nor a spent budget is `unknown`, and the ticket goes to Needs Human
// (`endingOf`).
//
// The tools of an agent come only from its agent file, never by flag (probed on 2.1.312): a `tools:` line is
// the agent's whole list, with no MCP tools, and it wins over `--tools`; with no line the agent gets the session's. The
// answer of `--json-schema` is the tool StructuredOutput, so an agent file with a `tools:` line must list it
// (tests/claude.test.ts checks the agents dynamo runs).

// One agent run: the plugin's `agents/<agent>.md`, launched as `dynamo:<agent>` (so it cannot clash with an agent of the project), the folder (a copy) it works in, the file that keeps its whole
// stream, the JSON schema of its answer, the most it may spend (USD), the most time it may take (`timeoutMs`; past it with
// no result, it is closed with its processes and ends as `timeout`), the session id it gets, and whether it sees the
// skills (the Builder may need one a ticket names, such as plugin-authoring; the reviewer only reads and judges), and
// whether `session` is a conversation to go on with (`--resume`, a Builder cut halfway) rather than the id of a new one.
export type AgentRun = {
  agent: string;
  prompt: string;
  cwd: string;
  log: string;
  schema: unknown;
  budget: number;
  timeoutMs: number;
  session: string;
  skills: boolean;
  resume?: boolean;
};

// How an agent ended: success, its budget spent, timeout (past its time limit with no result: the ticket's reason for
// Needs Human, not a round), limit (the usage limit: the ticket is paused, no round is spent), unknown (any other end: a
// stream with no result at all, an is_error with no known ending: the ticket goes to Needs Human with its reason, because
// trying it again and again would never end) or error (a success whose answer is not the one of its schema: that one is the
// ticket's failure).
export type Ending = 'success' | 'budget' | 'timeout' | 'limit' | 'unknown' | 'error';

export type AgentResult = {
  ending: Ending;
  structured: unknown;
  cost: number | null;
  turns: number | null;
  session: string | null;
  detail: string | null;
  // When the usage limit resets, as an ISO time; only an agent that ended as `limit` can have it.
  resetsAt: string | null;
  // The permission check of `auto` could not answer at some point of this run (`isOutage`); absent when it always could.
  outage?: boolean;
};

// The agent runs without anyone to answer a permission prompt: `none` denies what would ask, and `auto` decides the rest.
// The prompt goes on stdin, so its length is no limit on the command line. A run without skills gets
// `--disable-slash-commands`, which takes every skill out of its context, the project's too: to give it one back, its
// agent file can tell it to read that SKILL.md as a file, or the run drops the flag.
export function agentArgs(run: AgentRun): string[] {
  return [
    '-p', '--agent', `dynamo:${run.agent}`,
    '--output-format', 'stream-json', '--verbose',
    '--json-schema', JSON.stringify(run.schema),
    '--max-budget-usd', String(run.budget),
    '--permission-mode', 'auto', '--permission-prompts', 'none',
    ...(run.resume ? ['--resume'] : ['--session-id']), run.session,
    ...(run.skills ? [] : ['--disable-slash-commands']),
  ];
}

export type Line = Record<string, unknown>;

export function parseStream(text: string): AgentResult {
  const lines = text.split('\n').map(parseLine).filter((l): l is Line => l !== null);
  const init = lines.find((l) => l.type === 'system' && l.subtype === 'init');
  const result = lines.findLast(isAgentEnd);
  const outage = lines.some(isOutage) ? { outage: true } : {};
  if (!result) {
    return { ending: endingOf(undefined), structured: null, cost: null, turns: null, session: asText(init?.session_id), detail: 'the stream has no result line', resetsAt: null, ...outage };
  }
  const subtype = asText(result.subtype);
  const ending = endingOf(result);
  const errors = Array.isArray(result.errors) ? result.errors.filter((e): e is string => typeof e === 'string') : [];
  return {
    ending,
    structured: result.structured_output ?? null,
    cost: asNumber(result.total_cost_usd),
    turns: asNumber(result.num_turns),
    session: asText(result.session_id) ?? asText(init?.session_id),
    detail: ending === 'success' ? null : errors.length > 0 ? errors.join('; ') : subtype,
    resetsAt: ending === 'limit' ? resetOf(result, lines) : null,
    ...outage,
  };
}

// A command the permission check of `auto` could not judge: its server failed, which says nothing of the command. It is the
// only `permission_denied` with this reason (probed on 2.1.318); a real denial gives its own reason.
function isOutage(line: Line): boolean {
  return line.type === 'system' && line.subtype === 'permission_denied' && line.decision_reason_type === 'classifier' && line.decision_reason === 'Classifier unavailable';
}

// The ending from the last `result` line of a stream (undefined when it has none): a success, a spent budget and the usage
// limit are known; everything else is unknown.
export function endingOf(result: Line | undefined): Ending {
  if (result === undefined) return 'unknown';
  if (isUsageLimit(result)) return 'limit';
  if (result.subtype === 'error_max_budget_usd' || result.terminal_reason === 'budget_exhausted') return 'budget';
  return result.subtype === 'success' && result.is_error !== true ? 'success' : 'unknown';
}

const USAGE_LIMIT = 'usage_limit_reached';

// `api_error` is the name of the error, or an object that names it in `type`, `code` or `error`.
function isUsageLimit(result: Line): boolean {
  const e = result.api_error;
  if (e === USAGE_LIMIT) return true;
  return typeof e === 'object' && e !== null && [(e as Line).type, (e as Line).code, (e as Line).error].includes(USAGE_LIMIT);
}

// When the limit resets, as an ISO time: `resetsAt` of the result (or of its `api_error`), or else of the last
// `rate_limit_event` before it. A number is seconds since the epoch (milliseconds if it is that big); a text is a date.
function resetOf(result: Line, lines: Line[]): string | null {
  const e = result.api_error;
  const event = lines.findLast((l) => l.type === 'rate_limit_event')?.rate_limit_info;
  const found = [result.resetsAt, typeof e === 'object' && e !== null ? (e as Line).resetsAt : undefined, typeof event === 'object' && event !== null ? (event as Line).resetsAt : undefined]
    .map(asTime).find((t) => t !== null);
  return found ?? null;
}

function asTime(value: unknown): string | null {
  const at = typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : typeof value === 'string' && value !== '' ? new Date(value) : null;
  return at === null || Number.isNaN(at.getTime()) ? null : at.toISOString();
}

// Whether a line of the stream is the end of the agent: a `result` that is not the report of a task notification. A resumed
// session first reports the background shell its previous session left running: a `task_notification` and a `result` of its
// own (origin `task-notification`, 0 turns, no cost), and only then the real conversation and its real `result`.
export function isAgentEnd(line: Line | null): line is Line {
  if (line === null || line.type !== 'result') return false;
  const origin = line.origin;
  return !(typeof origin === 'object' && origin !== null && (origin as Line).kind === 'task-notification');
}

// A line of the stream as an object, or null when it is blank, not JSON, or JSON that is not an object.
export function parseLine(line: string): Line | null {
  if (line.trim() === '') return null;
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Line) : null;
  } catch {
    return null;
  }
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
