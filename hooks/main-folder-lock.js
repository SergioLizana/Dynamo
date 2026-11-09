#!/usr/bin/env node
// PreToolUse hook for Edit, Write, NotebookEdit and Bash: while a `dynamo run` is alive, refuses a change to a file of the
// main folder, because `dynamo merge` stops when that folder is not clean. The copies under
// `.claude/worktrees/` (ignored by git) and everything outside the main folder, the scratchpad included, stay writable.
// The run is alive when its lock `.claude/worktrees/run.json` says so (dynamo/runlock.ts decides: the pid answers and the
// heartbeat is recent); with no lock or a dead one nothing is refused. Claude Code gives the hook a JSON on stdin
// ({ tool_name, tool_input, cwd }); exit 2 refuses and sends stderr to the agent. A Bash command is read the way
// outside-writes.js reads it (command text, not a jail), so a script file that writes in the main folder is not seen.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyze, real, within, mainFolder } = require('./outside-writes.js');
const { holderOf, answers, readLock } = require('../dynamo/runlock.ts');

const WIN = process.platform === 'win32';
const FILE_TOOLS = { Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };

function target(file, cwd) {
  const f = WIN ? file.replace(/^\/([a-zA-Z])(?=\/|$)/, '$1:') : file;
  return real(path.resolve(cwd, f));
}

function main() {
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    process.exit(0); // nothing to check
  }
  const tool = input.tool_name;
  const args = input.tool_input || {};
  if (tool !== 'Bash' && !FILE_TOOLS[tool]) process.exit(0);
  const cwd = real(path.resolve(input.cwd || process.cwd()));
  const root = mainFolder(cwd);
  if (!root) process.exit(0);
  const holder = holderOf(readLock(path.join(root, '.claude', 'worktrees', 'run.json')), Date.now(), answers);
  if (!holder) process.exit(0);

  const copies = path.join(root, '.claude', 'worktrees');
  const allows = (p) => !within(root, p) || within(copies, p);
  let bad = [];
  try {
    if (tool === 'Bash') {
      if (typeof args.command === 'string') bad = analyze(args.command, { cwd, root, tmp: real(os.tmpdir()), allows });
    } else {
      const file = args[FILE_TOOLS[tool]];
      if (typeof file === 'string' && !allows(target(file, cwd))) bad = [target(file, cwd)];
    }
  } catch (e) {
    bad = [`a command the hook cannot analyse (${e.message})`];
  }
  if (bad.length) {
    console.error(
      `Refused: the run of pid ${holder.pid} (since ${holder.since}) is alive, and a change to the main folder (${root}) ` +
        `would stop its merge, which needs that folder clean: ${[...new Set(bad)].join(', ')}. ` +
        `Wait for \`dynamo run\` to end, or work in a copy under .claude/worktrees/ or in the scratchpad.`,
    );
    process.exit(2);
  }
}

main();
