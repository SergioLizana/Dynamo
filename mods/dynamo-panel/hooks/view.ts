// What the «Dynamo» pane shows, as plain data: `dynamo status --json` in, a view out. No mod API here, so a test of the
// repository can run it. The pane asks for that one command and for nothing else: it reads no log and no other command.
export const STATUS_COMMAND = ['node', 'dynamo/dynamo.ts', 'status', '--json'];
export const REFRESH_MS = 3000;

export type Row = { ticket: number; column: string | null; round: number; running: boolean; step: string | null; turns: number; cost: number };
export type View = {
  rows: Row[]; blocked: { ticket: number; reason: string }[]; skipped: { ticket: number; why: string }[]; error: string | null;
};
// What `$.process.run` resolves with, or the error it rejects with (the command could not start, or hung).
export type Ran = { exitCode: number; stdout: string; stderr: string } | Error;

const failed = (error: string): View => ({ rows: [], blocked: [], skipped: [], error });

// A failing `dynamo status` (exit 1, no JSON, a JSON of another shape, a command that did not start) is a line in the pane.
export function viewOf(ran: Ran): View {
  if (ran instanceof Error) return failed(`dynamo status did not run: ${ran.message}`);
  let json: unknown;
  try {
    json = JSON.parse(ran.stdout);
  } catch {
    return failed(`dynamo status failed (exit ${ran.exitCode}): ${first(ran.stderr) || first(ran.stdout) || 'no output'}`);
  }
  const out = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {};
  if (ran.exitCode !== 0 || out.ok !== true) return failed(`dynamo status failed (exit ${ran.exitCode}): ${String(out.error ?? first(ran.stderr)) || 'no reason'}`);
  if (!Array.isArray(out.rows) || !Array.isArray(out.blocked) || !Array.isArray(out.skipped)) return failed('dynamo status answered without rows, blocked and skipped');
  return { rows: out.rows as Row[], blocked: out.blocked as View['blocked'], skipped: out.skipped as View['skipped'], error: null };
}

function first(text: string): string {
  return text.trim().split('\n')[0].slice(0, 200);
}

export function rowText(r: Row): string {
  const step = r.step === null && !r.running ? '-' : `${r.running ? '(running) ' : ''}${r.step ?? ''}`.trim();
  return `#${r.ticket}  ${r.column ?? '-'}  r${r.round}  ${step}  ${r.turns} turns  $${r.cost.toFixed(2)}`;
}
