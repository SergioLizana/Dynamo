// The CI side of `dynamo setup` as data: the seed workflow written when a project has none, and the comparison of an existing
// workflow with `project.checks`. Pure: the subcommand reads the workflow files and writes the seed.

// What `<base>` becomes in the CI: the branch the pull request goes to. The checkout fetches the whole history, so the branch is there.
export const CI_BASE = 'origin/${{ github.base_ref }}';

// Where the seed goes, and where a project's workflows are.
export const SEED_PATH = '.github/workflows/ci.yml';

// The workflow for a project with no CI: on pull requests to the main branch, on Node 24, one step per check. The project owns it
// from the moment it is written.
export function seedOf(mainBranch: string, checks: string[]): string {
  const steps = checks.map((check) => {
    const command = check.split('<base>').join(CI_BASE);
    return [`      - name: ${JSON.stringify(command)}`, '        run: |', ...command.split('\n').map((l) => `          ${l}`)].join('\n');
  });
  return [
    '# Written once by `dynamo setup` from project.checks: the same commands Verify runs, with the base as the branch the pull request',
    '# goes to. This file is the project\'s from now on; the setup never changes it.',
    'name: CI',
    '',
    'on:',
    '  pull_request:',
    `    branches: [${JSON.stringify(mainBranch)}]`,
    '',
    'permissions:',
    '  contents: read',
    '',
    'jobs:',
    '  checks:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '        with:',
    '          fetch-depth: 0 # a check against the base needs the history of the branch',
    '      - uses: actions/setup-node@v4',
    '        with:',
    '          node-version: 24',
    ...steps,
    '',
  ].join('\n');
}

// The commands a workflow runs: the value of every `run:` key, one entry per line of a block. A comment line of a block is not a
// command, a folded block (`>`) is one line, and the indentation indicator of a block header (`|2-`, `|-2`) is understood.
export function runLinesOf(workflow: string): string[] {
  const lines = workflow.split(/\r?\n/);
  const found: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*(?:-\s+)?)run:\s*(.*)$/.exec(lines[i]);
    if (m === null) continue;
    const indent = m[1].length;
    const value = m[2].trim();
    const block = /^([|>])(?:[+-]?\d?|\d[+-])\s*(?:#.*)?$/.exec(value);
    if (block === null) {
      const one = scalarOf(value);
      if (one !== '') found.push(one);
      continue;
    }
    const body: string[] = [];
    while (i + 1 < lines.length && (lines[i + 1].trim() === '' || lines[i + 1].search(/\S/) >= indent + 1)) body.push(lines[++i].trim());
    const commands = body.filter((l) => l !== '' && !l.startsWith('#'));
    if (block[1] === '>') { if (commands.length > 0) found.push(commands.join(' ')); } else found.push(...commands);
  }
  return found;
}

// A one-line value of YAML: quotes removed, and a plain value without its trailing « # comment».
function scalarOf(value: string): string {
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    const end = value.indexOf(quote, 1);
    return end === -1 ? value.slice(1) : value.slice(1, end);
  }
  return value.replace(/\s+#.*$/, '').trim();
}

// The checks no line runs. A check is found when its words appear in a line whole (`node --run build` is not found in
// `node --run build:prod`), in the same order and with any spacing, and `<base>` stands for any single word, also the expression
// `origin/${{ github.base_ref }}` a CI spells it with. The checks are in the order they were given.
export function missingChecks(checks: string[], lines: string[]): string[] {
  const prepared = lines.map((l) => l.replace(/\$\{\{[^}]*\}\}/g, 'EXPR'));
  return checks.filter((check) => {
    const pattern = new RegExp(`(?<!${WORD})${check.trim().split(/\s+/).map(wordOf).join('\\s+')}(?!${WORD})`);
    return !prepared.some((l) => pattern.test(l));
  });
}

// The characters that make a longer word of a command: what follows or precedes a check must not be one of them.
const WORD = '[\\w:.\\/@$%=+~,-]';

function wordOf(word: string): string {
  return word.split('<base>').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\S+');
}
