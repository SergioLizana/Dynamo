// A stand-in for `gh` in the tests of dynamo: the tests put it in DYNAMO_GH and leave the real gh off the PATH. Its state
// is the folder in FAKE_GH:
//   answers.json  [{ "args": ["issue", "view"], "code": 0, "stdout": "...", "stderr": "" }]: the first answer whose args
//                 begin the call's arguments is the reply
//   issue.json    optional, one issue that keeps what is done to it: { "title", "boardName", "options", "column",
//                 "labels": [], "comments": [] }. With it, `project item-edit … --value <column>` moves its card,
//                 `issue edit … --add-label` adds a label, `issue comment … --body-file -` adds a comment, and
//                 `issue view … --json <fields>` prints those fields of it; any other call goes to answers.json
//   calls.jsonl   one line per call: its arguments and what it read on stdin
// A call with no answer exits 1 with «fake gh: not handled» on stderr.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Answer = { args: string[]; code?: number; stdout?: string; stderr?: string };
type Issue = { title: string; boardName: string; options: Record<string, string>; column: string | null; labels: string[]; comments: string[] };

const state = process.env.FAKE_GH ?? '';
const args = process.argv.slice(2);
let stdin = '';
try { stdin = readFileSync(0, 'utf8'); } catch { /* no stdin */ }
appendFileSync(join(state, 'calls.jsonl'), JSON.stringify({ args, stdin }) + '\n');

let issue: Issue | undefined;
try { issue = JSON.parse(readFileSync(join(state, 'issue.json'), 'utf8')); } catch { /* no issue */ }
const after = (flag: string) => args[args.indexOf(flag) + 1];
if (issue) {
  const save = (i: Issue) => writeFileSync(join(state, 'issue.json'), JSON.stringify(i));
  const [a, b] = args;
  if (a === 'project' && b === 'item-edit') { save({ ...issue, column: after('--value') }); process.exit(0); }
  if (a === 'issue' && b === 'edit' && args.includes('--add-label')) { save({ ...issue, labels: [...issue.labels, after('--add-label')] }); process.exit(0); }
  if (a === 'issue' && b === 'comment') { save({ ...issue, comments: [...issue.comments, stdin] }); process.exit(0); }
  if (a === 'issue' && b === 'view' && args.includes('--json')) {
    const i = issue;
    const fields: Record<string, () => unknown> = {
      title: () => i.title,
      labels: () => i.labels.map((name) => ({ name })),
      comments: () => i.comments.map((body, k) => ({ body, url: `https://github.com/o/r/issues/1#issuecomment-${k + 1}` })),
      projectItems: () => (i.column === null ? [] : [{ title: i.boardName, status: { name: i.column, optionId: i.options[i.column] } }]),
    };
    process.stdout.write(JSON.stringify(Object.fromEntries(after('--json').split(',').map((f) => [f, fields[f]?.()]))));
    process.exit(0);
  }
}

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
