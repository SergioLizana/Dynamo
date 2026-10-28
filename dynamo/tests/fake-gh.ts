// A stand-in for `gh` in the tests of dynamo: the tests put it in DYNAMO_GH and leave the real gh off the PATH. Its state
// is the folder in FAKE_GH:
//   answers.json  [{ "args": ["issue", "view"], "code": 0, "stdout": "...", "stderr": "" }]: the first answer whose args
//                 begin the call's arguments is the reply
//   calls.jsonl   one line per call: its arguments and what it read on stdin
// A call with no answer exits 1 with «fake gh: not handled» on stderr.
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Answer = { args: string[]; code?: number; stdout?: string; stderr?: string };

const state = process.env.FAKE_GH ?? '';
const args = process.argv.slice(2);
let stdin = '';
try { stdin = readFileSync(0, 'utf8'); } catch { /* no stdin */ }
appendFileSync(join(state, 'calls.jsonl'), JSON.stringify({ args, stdin }) + '\n');

let answers: Answer[] = [];
try { answers = JSON.parse(readFileSync(join(state, 'answers.json'), 'utf8')); } catch { /* no answers */ }
const answer = answers.find((a) => a.args.every((arg, i) => args[i] === arg));
if (!answer) {
  process.stderr.write(`fake gh: not handled: ${args.join(' ')}\n`);
  process.exit(1);
}
process.stdout.write(answer.stdout ?? '');
process.stderr.write(answer.stderr ?? '');
process.exit(answer.code ?? 0);
