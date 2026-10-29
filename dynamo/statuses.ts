// What `dynamo status` says, from the log folders of a run and nothing else: the notes `dynamo run` makes of each step of a
// ticket (`steps.jsonl`, notes.ts) and the streams of its agents (`<agent>-<round>.jsonl`). Pure: the subcommand reads the
// files and hands their text here. A log still being written has a last line cut, and a line that is not JSON is skipped.
import { parseLine } from './agents.ts';

// One step of a ticket, as `dynamo run` notes it: it started, its card moved to a column, an agent ended, the check ended
// (`text`: how), it merged, it stopped (`text`: why) or it was skipped (`text`: why).
export type Note = {
  step: 'start' | 'column' | 'agent' | 'check' | 'merged' | 'stopped' | 'skipped';
  round: number;
  at: string;
  column?: string;
  agent?: string;
  ending?: string;
  cost?: number | null;
  turns?: number | null;
  text?: string;
};

// The text of the files of one ticket's log folder, by file name.
export type LogFolder = { ticket: number; files: Record<string, string> };

export type StatusRow = {
  ticket: number; column: string | null; round: number; running: boolean; step: string | null; turns: number; cost: number;
};
export type Status = {
  rows: StatusRow[]; blocked: { ticket: number; reason: string }[]; skipped: { ticket: number; why: string }[];
};

export const STEPS_FILE = 'steps.jsonl';

// An agent's log is `builder-<round>.jsonl` or `reviewer-<round>.jsonl`. Within a round the Builder comes before the reviewer.
const AGENT_FILE = /^(builder|reviewer)-([1-9]\d*)\.jsonl$/;

type Agent = { round: number; order: number; text: string };

export function statusOf(folders: LogFolder[]): Status {
  const status: Status = { rows: [], blocked: [], skipped: [] };
  for (const f of [...folders].sort((a, b) => a.ticket - b.ticket)) {
    const notes = (f.files[STEPS_FILE] ?? '').split('\n').map(parseLine).filter((l) => l !== null) as Partial<Note>[];
    const last = notes.at(-1);
    if (last?.step === 'skipped') {
      status.skipped.push({ ticket: f.ticket, why: last.text ?? 'skipped' });
      continue;
    }
    const agents = agentsOf(f.files);
    const results = agents.map((a) => a.text.split('\n').map(parseLine).findLast((l) => l?.type === 'result'));
    const latest = agents.at(-1);
    const ended = last?.step === 'stopped' || last?.step === 'merged';
    if (last?.step === 'stopped') status.blocked.push({ ticket: f.ticket, reason: last.text ?? 'stopped' });
    status.rows.push({
      ticket: f.ticket,
      column: notes.findLast((n) => typeof n.column === 'string')?.column ?? null,
      round: last?.round ?? latest?.round ?? 1,
      // An agent whose stream has no result line yet is still working (unless the ticket ended: a killed agent leaves none).
      running: latest !== undefined && !ended && results.at(-1) === undefined,
      step: latest === undefined ? null : lastStep(latest.text),
      turns: results.reduce((sum, r) => sum + number(r?.num_turns), 0),
      cost: results.reduce((sum, r) => sum + number(r?.total_cost_usd), 0),
    });
  }
  return status;
}

function agentsOf(files: Record<string, string>): Agent[] {
  const agents: Agent[] = [];
  for (const [name, text] of Object.entries(files)) {
    const m = AGENT_FILE.exec(name);
    if (m !== null) agents.push({ round: Number(m[2]), order: m[1] === 'builder' ? 0 : 1, text });
  }
  return agents.sort((a, b) => a.round - b.round || a.order - b.order);
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// The last tool call or message of an agent's stream, in one short line: «Edit dynamo/run.ts», «Bash node --test», or the
// first words of what it said. Null while the stream has no message yet.
export function lastStep(stream: string): string | null {
  const message = stream.split('\n').map(parseLine).findLast((l) => l?.type === 'assistant' && contentOf(l).length > 0);
  const item = message === undefined || message === null ? undefined : contentOf(message).at(-1);
  if (item === undefined) return null;
  if (item.type === 'tool_use') {
    const input = typeof item.input === 'object' && item.input !== null ? (item.input as Record<string, unknown>) : {};
    const target = [input.file_path, input.path, input.command, input.pattern, input.description, input.prompt].find((v) => typeof v === 'string');
    return short(`${String(item.name ?? 'tool')} ${typeof target === 'string' ? target : ''}`);
  }
  return typeof item.text === 'string' && item.text.trim() !== '' ? short(item.text) : null;
}

function contentOf(line: Record<string, unknown>): Record<string, unknown>[] {
  const message = line.message;
  const content = typeof message === 'object' && message !== null ? (message as Record<string, unknown>).content : undefined;
  return Array.isArray(content) ? content.filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null) : [];
}

function short(text: string, max = 80): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

// The status as lines for a person: a row per ticket, then the blocked and the skipped with their reason.
export function table(status: Status): string[] {
  const head = ['ticket', 'column', 'round', 'last step', 'turns', 'cost'];
  const body = status.rows.map((r) => [
    `#${r.ticket}`, r.column ?? '-', String(r.round), `${r.running ? '(running) ' : ''}${r.step ?? '-'}`, String(r.turns), `$${r.cost.toFixed(2)}`,
  ]);
  const width = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(width[i])).join('  ').trimEnd();
  return [
    line(head), ...body.map(line),
    ...(status.blocked.length > 0 ? ['', 'Blocked:', ...status.blocked.map((b) => `  #${b.ticket}: ${short(b.reason, 200)}`)] : []),
    ...(status.skipped.length > 0 ? ['', 'Skipped:', ...status.skipped.map((s) => `  #${s.ticket}: ${short(s.why, 200)}`)] : []),
  ];
}
