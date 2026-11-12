---
name: new-release
description: Open the next release branch when the human decides - fetch, make `release/<last tag + bump>` from the main branch on origin, push it and check it out, all with no questions. Use when the human runs /dynamo:new-release <patch|minor|major> to start the next release.
argument-hint: <patch|minor|major>
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dynamo/dynamo.ts" *)
disable-model-invocation: true
---

# /dynamo:new-release <patch|minor|major>

A thin skill over `node "${CLAUDE_PLUGIN_ROOT}/dynamo/dynamo.ts" release new`. It decides nothing and asks the human
nothing: the bump is its argument, and the human launching it is the authorization for the writes below (a new branch and
its push). Talk to the human in the language their `CLAUDE.md` asks for. The subcommand prints one short JSON line and
exits 0 (done), 1 (failed) or 2 (called wrong); the decision is the exit code, read with the line.

This skill never pushes anything but the new branch and never touches the main branch.

Run the command exactly as written, with nothing appended: the Bash tool already reports its exit code. A command
with something appended, such as `; echo "exit=$?"`, is no longer covered by `allowed-tools` and asks for permission.

## 1. Start

1. The argument must be exactly one of `patch`, `minor` or `major`. With none, or any other: **stop** and say that the
   bump is the argument (`/dynamo:new-release <patch|minor|major>`). Write nothing; do not ask, do not pick one.
2. `git status --short`. With any output: **stop** and say that the folder must be clean, because the skill ends by
   checking out the new branch. Write nothing.

## 2. Fetch

`git fetch origin`. The branch starts from the main branch on origin, and a release branch that exists only on origin
must count as open. Any failure: **stop** and show the literal output. Nothing was written.

## 3. Dry run

`node "${CLAUDE_PLUGIN_ROOT}/dynamo/dynamo.ts" release new --bump <bump> --dry-run`. It writes nothing.
- Exit 0: tell the human its `message`, and keep from the line the `branch`.
- Exit 1 or 2 (a release branch above the last tag is already open, there is no tag yet, …): **stop** and show the
  literal line. Nothing was written.

## 4. Open

1. `node "${CLAUDE_PLUGIN_ROOT}/dynamo/dynamo.ts" release new --bump <bump>` (the same bump, without `--dry-run`).
   - Exit 0: go on.
   - Exit 1 or 2: **stop** and show the literal line; do not run it again and do not repair anything by hand.
2. `git push origin <branch>`: naming the ref, never `--all`, `--tags`, `--force` or any other branch. Claude Code's
   prompt for the push is the human's only gate. If it is refused or fails: **stop** and show the literal output, say
   that the branch exists only here, and do not retry or undo anything.
3. `git checkout <branch>`. If it fails: **stop** and show the literal output.

## End

Finish with a short summary: the bump, the branch opened, and whether it was pushed and checked out, or where it
stopped.
