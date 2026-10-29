// What dynamo asks of a `claude -p` agent and what it makes of the answer: the arguments of the call, and the reading of its
// `stream-json` output. Pure: the edge that runs claude is claude.ts. The stream was probed on Claude Code 2.1.312 (the
// comments on #86): the last line is a `result` with the cost, the turns, the session and, when a schema was given, the
// `structured_output`; a spent `--max-budget-usd` ends it with subtype `error_max_budget_usd`, terminal_reason
// `budget_exhausted` and is_error true. The usage limit has not been seen yet (research §3.6), so an end that is neither of
// these is a pause (`endingOf`).
//
// The tools of an agent come only from its agent file, never by flag (probed on 2.1.312, 2026-10-29): a `tools:` line is
// the agent's whole list, with no MCP tools, and it wins over `--tools`; with no line the agent gets the session's. The
// answer of `--json-schema` is the tool StructuredOutput, so an agent file with a `tools:` line must list it
// (tests/claude.test.ts checks the agents dynamo runs).

// One agent run: the agent of `.claude/agents/<agent>.md`, the folder (a copy) it works in, the file that keeps its whole
// stream, the JSON schema of its answer, the most it may spend (USD), and the session id it gets.
export type AgentRun = {
  agent: string;
  prompt: string;
  cwd: string;
  log: string;
  schema: unknown;
  budget: number;
  session: string;
};

// How an agent ended: success, its budget spent, paused (any other end: a usage limit, a stream with no result at all, an
// is_error with no known ending; the exact form of the usage limit is not known yet, so it is read as a pause, never as a
// failure of the ticket) or error (a success whose answer is not the one of its schema: that one is the ticket's failure).
export type Ending = 'success' | 'budget' | 'paused' | 'error';

export type AgentResult = {
  ending: Ending;
  structured: unknown;
  cost: number | null;
  turns: number | null;
  session: string | null;
  detail: string | null;
};

// The agent runs without anyone to answer a permission prompt: `none` denies what would ask, and `auto` decides the rest.
// The prompt goes on stdin, so its length is no limit on the command line.
export function agentArgs(run: AgentRun): string[] {
  return [
    '-p', '--agent', run.agent,
    '--output-format', 'stream-json', '--verbose',
    '--json-schema', JSON.stringify(run.schema),
    '--max-budget-usd', String(run.budget),
    '--permission-mode', 'auto', '--permission-prompts', 'none',
    '--session-id', run.session,
  ];
}

export type Line = Record<string, unknown>;

export function parseStream(text: string): AgentResult {
  const lines = text.split('\n').map(parseLine).filter((l): l is Line => l !== null);
  const init = lines.find((l) => l.type === 'system' && l.subtype === 'init');
  const result = lines.findLast((l) => l.type === 'result');
  if (!result) {
    return { ending: endingOf(undefined), structured: null, cost: null, turns: null, session: asText(init?.session_id), detail: 'the stream has no result line' };
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
  };
}

// The ending from the last `result` line of a stream (undefined when it has none): only a success and a spent budget are
// known; everything else is a pause.
export function endingOf(result: Line | undefined): Ending {
  if (result === undefined) return 'paused';
  if (result.subtype === 'error_max_budget_usd' || result.terminal_reason === 'budget_exhausted') return 'budget';
  return result.subtype === 'success' && result.is_error !== true ? 'success' : 'paused';
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
