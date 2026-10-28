'use strict';
// A dry run of a workflow script (.claude/workflows/*.js) outside Claude Code. The script is a function body with
// `args`, `agent`, `workflow` and `log` in scope. The `runner` agent is played here: it runs each command it is given, in
// order, in a real shell inside a scratch copy of the repository, stops at the first command that fails and returns each
// command with its exit code and output, as the real one does. Two things make it harsher than a good runner on purpose:
//   - an output is cut at TRUNCATE characters, as the Bash tool does (about 2 KB), and
//   - `mutate(command, n)` can change a character of a command before it runs (a runner that copies badly).
// `gh` and `git` are replaced by tests/workflows/fake-gh.js. It needs `sh` in the PATH (Git Bash on Windows).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { analyze } = require('../../.claude/hooks/outside-writes.js');

const ROOT = path.resolve(__dirname, '..', '..');
const TRUNCATE = 2000;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const fwd = (p) => p.replace(/\\/g, '/');

function scratch() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'claude-dryrun-')));
  fs.mkdirSync(path.join(dir, '.git'));
  fs.mkdirSync(path.join(dir, '.claude', 'worktrees'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, '.claude', 'factory.json'), path.join(dir, '.claude', 'factory.json'));
  const state = path.join(dir, 'state');
  fs.mkdirSync(state);
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const fake = fwd(path.join(__dirname, 'fake-gh.js'));
  for (const tool of ['gh', 'git']) fs.writeFileSync(path.join(bin, tool), `#!/bin/sh\nexec node "${fake}" ${tool} "$@"\n`, { mode: 0o755 });
  return { dir, state, bin };
}

// options: file (script), args, env, workflow (stub for child workflows), agent (stub for the other agents),
// mutate(command, index, call) → command and garble(output, command, index, call) → output (a runner that copies a command
// or an output badly), lose(call) → true to run a call but return nothing, limits (to override factory.json in the scratch copy)
async function dryRun(options) {
  const { dir, state, bin } = scratch();
  if (options.limits) {
    const f = path.join(dir, '.claude', 'factory.json');
    const json = JSON.parse(fs.readFileSync(f, 'utf8'));
    json.runner = options.limits;
    fs.writeFileSync(f, JSON.stringify(json, null, 2));
  }
  const factory = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'factory.json'), 'utf8'));
  const env = { ...process.env, ...options.env, FAKE_STATE: state, PATH: bin + path.delimiter + process.env.PATH };
  const seen = { commands: [], longCommands: [], longOutputs: [], refused: [], calls: 0, runnerCalls: 0, labels: [] };
  let n = 0;

  async function agent(prompt, opts = {}) {
    seen.calls++;
    seen.labels.push(opts.label);
    if (opts.agentType !== 'runner') return options.agent ? options.agent(prompt, opts, { dir, state }) : null;
    seen.runnerCalls++;
    const call = seen.runnerCalls;
    const commands = [...String(prompt).matchAll(/^\d+\. (.*)$/gm)].map((m) => m[1]);
    const results = [];
    for (const original of commands) {
      const limit = (factory.runner || {}).maxCommand;
      if (limit && original.length > limit) seen.longCommands.push(original);
      const command = options.mutate ? options.mutate(original, n++, call) : original;
      seen.commands.push(command);
      const bad = analyze(command, { cwd: dir, root: dir, tmp: os.tmpdir() });
      if (bad.length) { seen.refused.push({ command, bad }); results.push({ command, exitCode: 126, output: `refused by the hook: ${bad.join(', ')}` }); break; }
      const p = spawnSync('sh', ['-c', command], { cwd: dir, env, encoding: 'utf8' });
      const full = `${p.stdout || ''}${p.stderr || ''}`;
      if (full.length > ((factory.runner || {}).maxOutput || Infinity) && !options.allowLongOutput) seen.longOutputs.push({ command, length: full.length });
      const cut = full.length > TRUNCATE ? full.slice(0, TRUNCATE) : full;
      const output = options.garble ? options.garble(cut, command, n++, call) : cut;
      results.push({ command, exitCode: p.status === null ? 1 : p.status, output: output === '' ? '(Bash completed with no output)' : output });
      if (p.status !== 0) break;
    }
    if (options.lose && options.lose(call)) return null;
    return { results };
  }

  const workflow = async (spec, a) => (options.workflow ? options.workflow(spec, a, { dir, state, factory }) : null);
  const src = fs.readFileSync(path.join(ROOT, options.file), 'utf8').replace(/^export const meta = /m, 'const meta = ');
  const script = new AsyncFunction('args', 'agent', 'workflow', 'log', src);
  const logs = [];
  let result, error;
  try { result = await script(options.args === undefined ? null : options.args, agent, workflow, (m) => logs.push(String(m))); } catch (e) { error = e; }
  const posts = fs.existsSync(path.join(state, 'posts.jsonl')) ? fs.readFileSync(path.join(state, 'posts.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const left = fs.readdirSync(path.join(dir, '.claude', 'worktrees'));
  return { result, error, logs, posts, seen, dir, state, left, factory };
}

module.exports = { dryRun, ROOT };
