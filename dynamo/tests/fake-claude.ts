// A stand-in for `claude` in the tests of dynamo: the tests put it in DYNAMO_CLAUDE and leave the real claude off the PATH.
// Its state is the folder in FAKE_CLAUDE:
//   answer.json  { "stdout": "...", "stderr": "", "code": 0 }: what every call prints and exits with
//   calls.jsonl  one line per call: its arguments, what it read on stdin and the folder it ran in
// A call with no answer exits 1 with «fake claude: no answer» on stderr.
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Answer = { stdout?: string; stderr?: string; code?: number };

const state = process.env.FAKE_CLAUDE ?? '';
let stdin = '';
try { stdin = readFileSync(0, 'utf8'); } catch { /* no stdin */ }
appendFileSync(join(state, 'calls.jsonl'), JSON.stringify({ args: process.argv.slice(2), stdin, cwd: process.cwd() }) + '\n');

let answer: Answer | undefined;
try { answer = JSON.parse(readFileSync(join(state, 'answer.json'), 'utf8')); } catch { /* no answer */ }
if (!answer) {
  process.stderr.write('fake claude: no answer\n');
  process.exit(1);
}
process.stdout.write(answer.stdout ?? '');
process.stderr.write(answer.stderr ?? '');
process.exit(answer.code ?? 0);
