---
name: close-release
description: Close the release the working branch names, once the human merged its release PR in GitHub - fetch, check the merged PR, rewrite the merged PR's release report in the documents language, make the milestone, the tag, the GitHub Release and the next branch, close the milestone, push the tag and the next branch, and leave the next branch checked out, all with no questions. Use when the human runs /dynamo:close-release <patch|minor|major> after merging the release PR.
argument-hint: <patch|minor|major>
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dynamo/dynamo.ts" *)
disable-model-invocation: true
---

# /dynamo:close-release <patch|minor|major>

A thin skill over `node "${CLAUDE_PLUGIN_ROOT}/dynamo/dynamo.ts" release close`. It
decides nothing and asks the human nothing: the bump is its argument, and the human launching it is the authorization
for the writes below (a milestone, a tag, a GitHub Release, a new branch, the push of the tag and of that branch).
Talk to the human in the language their `CLAUDE.md` asks for. The subcommand prints one short JSON line and exits 0
(done), 1 (failed) or 2 (called wrong); the decision is the exit code, read with the line.

The human merges the release PR in GitHub before launching this skill. This skill never merges it, never pushes
anything but the tag and the next branch, and never touches the main branch.

Run the command exactly as written, with nothing appended: the Bash tool already reports its exit code. A command
with something appended, such as `; echo "exit=$?"`, is no longer covered by `allowed-tools` and asks for permission.

## 1. Start

1. The argument must be exactly one of `patch`, `minor` or `major`. With none, or any other: **stop** and say that the
   bump is the argument (`/dynamo:close-release <patch|minor|major>`). Write nothing; do not ask, do not pick one.
2. `git status --short`. With any output: **stop** and say that the folder must be clean, because the skill ends by
   checking out the next branch. Write nothing.

## 2. Fetch

`git fetch origin`. The release PR was merged on GitHub, so its merge commit may not be in the local repository yet. The
release to close is the working branch, which `dynamo` reads from git: the greatest `release/x.y.z` branch, local or on
`origin`, above the last tag (it is not in `factory.json`), so the fetch also brings it in.
Any failure: **stop** and show the literal output. Nothing was written.

## 3. Dry run

`node "${CLAUDE_PLUGIN_ROOT}/dynamo/dynamo.ts" release close --bump <bump> --dry-run`. It checks the merged PR and writes nothing.
- Exit 0: tell the human its `message`, and which release it closes (`base`), and keep from the line the `version`, `tag`,
  `next` and `nextBranch`.
- Exit 1 with `missing` or `extra` in the line (a difference on the merged PR): **stop**. Show its `message` word for
  word; nothing was written.
- Any other exit 1 or 2 (the release PR is not merged, there is no release branch above the last
  tag, …): **stop** and show the literal line. Nothing was written, and the PR is not merged by this skill.

## 4. The report

The release report is written by `dynamo report` with a frame of fixed English text, and the code cannot know every
language; you can. What the human merged is the body of the release PR, and `release close` takes the text of the GitHub
Release from that body, so the rewrite is made on the body of the merged PR: that is what reaches the Release. Its file
is `.claude/worktrees/release-report-<base>.md`, with `<base>` the `base` of step 3 and its `/` written as `-`; it is
only where you write the rewrite.

1. Read `project.documentsLanguage` and `project.repo` in `.claude/factory.json`. If the language is English, say so
   and go on to step 5: there is nothing to rewrite.
2. Read the body of the PR (`pr` of step 3): `gh pr view <pr> -R <repo> --json body --jq .body`.
3. Rewrite it in that language, section by section, and write it to the file of the report. Change no number, no `#n`
   (a `Closes #n` line stays exactly as it is), no command, no path, no branch, tag or version name and no cost: only
   the words around them. A quoted result comment or ticket title is translated like the rest. Do not add, drop or
   reorder a line, a section or a list item.
4. `gh pr edit <pr> -R <repo> --body-file <file>`. Any failure: **stop** and show the literal output; nothing else
   was written.
5. Run the dry run of step 3 again: the rewritten body must still pass it. With `missing` or `extra` in the line:
   **stop** and show its `message`; the rewrite changed a `Closes #n` line and the human decides.
6. Say in one line that the body of the PR, and so the GitHub Release, will carry the report in that language.

## 5. Close

1. `node "${CLAUDE_PLUGIN_ROOT}/dynamo/dynamo.ts" release close --bump <bump>` (the same bump, without `--dry-run`).
   - Exit 0: go on. The subcommand has closed the milestone of the release too (it is the last thing it writes): nothing
     is left to close by hand.
   - Exit 1 or 2: **stop** and show the literal line. Its `error` says what was made and what was taken back; do not run
     `close` again and do not try to repair it by hand: the human decides.
2. `git push origin <tag>`, then `git push origin <nextBranch>`: one push each, naming the ref, never `--tags`, `--all`,
   `--force` or any other branch. Claude Code's prompt for each push is the human's only gate. If one is
   refused or fails: **stop** and show the literal output, say which of the two was pushed and which was not, and do not
   retry or undo anything.
3. `git checkout <nextBranch>`. If it fails: **stop** and show the literal output.

## End

Finish with a short summary: the version closed, the bump, the next branch, and whether it was closed and
pushed with the next branch checked out, or where it stopped.
