// A stand-in for `claude` in the tests of dynamo: the tests put it in DYNAMO_CLAUDE and leave the real claude off the PATH.
// Its state is the folder in FAKE_CLAUDE:
//   answers.json  [{ "agent": "builder", ...answer }]: the k-th call with `--agent X` gets the k-th answer of agent X
//   answer.json   { "stdout": "...", "stderr": "", "code": 0 }: what a call with no answer in answers.json gets
//   calls.jsonl   one line per call: its arguments, what it read on stdin, the folder it ran in and, with `watch`, what
//                 `git status --porcelain` printed in that folder
// An answer can also, in this order: `commit` a file in the folder it runs in ({ file, text, message }), print `stdout`,
// wait until the file `waitFor` exists, and print `then`. A call with no answer exits 1 with «fake claude: no answer».
// `commit` and `watch` run git, found on FAKE_CLAUDE_PATH.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Answer = {
  agent?: string; stdout?: string; stderr?: string; code?: number; then?: string; waitFor?: string; watch?: string;
  commit?: { file: string; text: string; message: string };
};

const state = process.env.FAKE_CLAUDE ?? '';
const args = process.argv.slice(2);
const agent = args[args.indexOf('--agent') + 1];
let stdin = '';
try { stdin = readFileSync(0, 'utf8'); } catch { /* no stdin */ }

const read = <T>(name: string, empty: T): T => {
  try { return JSON.parse(readFileSync(join(state, name), 'utf8')); } catch { return empty; }
};
const earlier = (() => {
  try { return readFileSync(join(state, 'calls.jsonl'), 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l).agent); } catch { return []; }
})().filter((a) => a === agent).length;
const mine = read<Answer[]>('answers.json', []).filter((a) => a.agent === agent);
const answer: Answer | undefined = args.includes('--agent') && mine.length > 0 ? mine[earlier] : read<Answer | undefined>('answer.json', undefined);

// The PATH of the tests has no programs: git is looked for in FAKE_CLAUDE_PATH, which the test gives when it needs git.
const gitEnv: Record<string, string | undefined> = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'PATH'));
gitEnv.PATH = process.env.FAKE_CLAUDE_PATH ?? '';
const git = (...a: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8', env: gitEnv });
const watched = answer?.watch === undefined ? {} : { watched: git('-C', answer.watch, 'status', '--porcelain').stdout };
appendFileSync(join(state, 'calls.jsonl'), JSON.stringify({ args, stdin, cwd: process.cwd(), agent, ...watched }) + '\n');

if (!answer) {
  process.stderr.write('fake claude: no answer\n');
  process.exit(1);
}
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
process.exit(answer.code ?? 0);
