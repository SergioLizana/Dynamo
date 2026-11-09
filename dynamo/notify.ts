// The notice to the human, sent: a POST of one line to the URL in the environment variable DYNAMO_NOTIFY_URL (an ntfy.sh
// topic, for one). With no variable there is no notice and no error; the URL stays in the environment, out of git. A notice
// that cannot be sent never stops the run: it comes back as the text of what failed. `post` is the network edge, so that a
// test passes a fake instead of reaching one.
export const NOTIFY_URL = 'DYNAMO_NOTIFY_URL';

export type Post = (url: string, line: string) => Promise<{ ok: boolean; status: number }>;
export type Notify = (line: string) => Promise<string | null>;

const post: Post = (url, line) => fetch(url, { method: 'POST', body: line, signal: AbortSignal.timeout(15_000) });

// Null when the line was sent or there was nowhere to send it; else what went wrong.
export async function notify(line: string, env: NodeJS.ProcessEnv = process.env, send: Post = post): Promise<string | null> {
  const url = env[NOTIFY_URL];
  if (url === undefined || url === '') return null;
  try {
    const r = await send(url, line);
    return r.ok ? null : `the notice was refused: status ${r.status}`;
  } catch (e) {
    return `the notice could not be sent: ${e instanceof Error ? e.message : String(e)}`;
  }
}
