// A stand-in for `claude` in the tests of dynamo: the tests put it in DYNAMO_CLAUDE and leave the real claude off the PATH.
// Its state is the folder in FAKE_CLAUDE:
//   answers.json  [{ "agent": "builder", ...answer }]: the k-th call with `--agent X` gets the k-th answer of agent X; an
//                 answer with `ticket` is only for the calls whose prompt says «Ticket #<ticket>», counted apart
//   answer.json   { "stdout": "...", "stderr": "", "code": 0 }: what a call with no answer in answers.json gets
//   calls.jsonl   one line per call: its arguments, what it read on stdin, the folder it ran in, the ticket of its prompt,
//                 how many fake claudes were running when it started (itself too) and, with `watch`, what
//                 `git status --porcelain` printed in that folder
//   running/      one file per fake claude while it runs
// An answer can also, in this order: create the file `touch`, `commit` a file in the folder it runs in ({ file, text,
// message }), print `stdout`, wait until the file `waitFor` exists, and print `then`. A call with no answer exits 1 with
// «fake claude: no answer». `commit` and `watch` run git, found on FAKE_CLAUDE_PATH.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Answer = {
  agent?: string; ticket?: number; stdout?: string; stderr?: string; code?: number; then?: string; waitFor?: string; watch?: string;
  touch?: string; commit?: { file: string; text: string; message: string };
};

const state = process.env.FAKE_CLAUDE ?? '';
const args = process.argv.slice(2);
const agent = args[args.indexOf('--agent') + 1];
let stdin = '';
try { stdin = readFileSync(0, 'utf8'); } catch { /* no stdin */ }
const said = /Ticket #(\d+)/.exec(stdin);
const ticket = said === null ? null : Number(said[1]);

const running = join(state, 'running');
mkdirSync(running, { recursive: true });
const me = join(running, String(process.pid));
writeFileSync(me, '');
const together = readdirSync(running).length;
const leave = (code: number): never => {
  rmSync(me, { force: true });
  process.exit(code);
};

const read = <T>(name: string, empty: T): T => {
  try { return JSON.parse(readFileSync(join(state, name), 'utf8')); } catch { return empty; }
};
const mine = read<Answer[]>('answers.json', []).filter((a) => a.agent === agent && (a.ticket === undefined || a.ticket === ticket));
const perTicket = mine.some((a) => a.ticket !== undefined);
const earlier = (() => {
  try { return readFileSync(join(state, 'calls.jsonl'), 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l)); } catch { return []; }
})().filter((c) => c.agent === agent && (!perTicket || c.ticket === ticket)).length;
const answer: Answer | undefined = args.includes('--agent') && mine.length > 0 ? mine[earlier] : read<Answer | undefined>('answer.json', undefined);

// The PATH of the tests has no programs: git is looked for in FAKE_CLAUDE_PATH, which the test gives when it needs git.
const gitEnv: Record<string, string | undefined> = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'PATH'));
gitEnv.PATH = process.env.FAKE_CLAUDE_PATH ?? '';
const git = (...a: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8', env: gitEnv });
const watched = answer?.watch === undefined ? {} : { watched: git('-C', answer.watch, 'status', '--porcelain').stdout };
appendFileSync(join(state, 'calls.jsonl'), JSON.stringify({ args, stdin, cwd: process.cwd(), agent, ticket, running: together, ...watched }) + '\n');

if (!answer) {
  process.stderr.write('fake claude: no answer\n');
  leave(1);
} else {
  if (answer.touch !== undefined) writeFileSync(answer.touch, '');
  if (answer.commit) {
    writeFileSync(answer.commit.file, answer.commit.text);
    git('add', answer.commit.file);
    git('commit', '-q', '-m', answer.commit.message);
  }
  process.stdout.write(answer.stdout ?? '');
  if (answer.waitFor !== undefined) {
    const until = Date.now() + 20000;
    while (!existsSync(answer.waitFor) && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  process.stdout.write(answer.then ?? '');
  process.stderr.write(answer.stderr ?? '');
  leave(answer.code ?? 0);
}
