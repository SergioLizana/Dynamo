---
name: setup
description: Put the factory in the current project - propose the project's checks from its scripts, have the human confirm them and choose the language of the documents, run `dynamo setup` with them and report what it printed. Use when the human runs /dynamo:setup in a project that has no board or no .claude/factory.json yet (or to set up again, which also brings an installed factory.json up to date with the template after `claude plugin update`).
argument-hint: (none)
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dynamo/dynamo.ts" *), Bash(git rev-parse --show-toplevel)
disable-model-invocation: true
---

# /dynamo:setup

A thin skill over `node "${CLAUDE_PLUGIN_ROOT}/dynamo/dynamo.ts" setup --check <command>... --language <name>`. The path of the engine changes
with each version of the plugin, so a person cannot type it; this skill is the one command. It proposes the checks, the
human decides them, and `setup` does the rest (board, `factory.json`, settings, labels, CI, commit). Talk to the human in
the language their `CLAUDE.md` asks for. `setup` prints one JSON line and exits 0 (done), 1 (failed) or 2 (called wrong).

Run the command exactly as written, with nothing appended: the Bash tool already reports its exit code. A command with
something appended, such as `; echo "exit=$?"`, is no longer covered by `allowed-tools` and asks for permission.

## 1. Read the project

1. Run it from the project's folder. If `git rev-parse --show-toplevel` (exactly so, nothing appended) fails,
   **stop**: say this is not a git repository and run nothing.
2. If `.claude/factory.json` exists, `setup` brings it up to date with the template by itself: it adds the keys it lacks,
   removes the ones nothing reads and says both. A key with no value in the template is asked as on a first install: if
   the file has no `project.checks`, they must be asked in step 3 and given with `--check`. Read its `project.checks` and
   `project.documentsLanguage`: they are the current
   checks (the second question of step 3 asks whether to keep them) and the current language (the third question).
3. Read the scripts of the project: the `scripts` of `package.json` if there is one (also `pyproject.toml`, `Makefile`
   or `Cargo.toml` if that is what the project has). Do not run any of them.

## 2. Propose the checks

A check is a command the project already runs: its tests, its linter, its type check, its build, `git diff --check <base>`.
Read `${CLAUDE_PLUGIN_ROOT}/guides/factory.md` («Automatic check») before choosing, and propose:

1. Only scripts the project has, never one you invent. Prefer the ones that are deterministic and end by themselves
   (`test`, `lint`, `typecheck`, `build`); leave out `start`, `dev`, `watch` and anything that serves or waits.
2. A script of `package.json` as `node --run <script>`, not `npm run <script>`: the checks run without a shell and `npm`
   cannot start that way on Windows. The install goes inside the script the check runs (a script such as
   `"verify": "npm ci && node --run build"`), because the check runs in a clean copy with no `node_modules`; if the
   project has no such script, say so and propose the one to add, but do not edit `package.json` yourself.
   Say too that the script must be committed before the setup runs, because the rehearsal of the checks runs on `HEAD`:
   a script that is only in the working folder is not in it.
3. `git diff --check <base>` last, as a check of whitespace.
4. If the project has no script at all, propose only `git diff --check <base>` and say that there is nothing else to run.

## 3. Have the human confirm

The setup runs the checks and writes everything, so nothing runs before this step is answered. Show the proposed
checks as a numbered list, each with the script it comes from, and ask the human, in one message:

1. Are these the checks, or which to add, remove or change?
2. Only when `.claude/factory.json` already has checks: keep them (no `--check`, none run) or replace them with these?

3. Which language the documents are written in (commits, GitHub comments, verdicts, tickets), as the name of the
   language, such as `English` or `Español`. When `factory.json` already has one, say it and offer to keep it. If the
   human gives none, the language is `English` for a new `factory.json`, and the one it has for an existing one.

Wait for the answer. If the human cancels, or gives no check and the project has no `factory.json`, **stop**: run
nothing and say that `setup` needs at least one check in a project with no `factory.json`. Never run `setup` with a
check the human has not confirmed.

## 4. Run the setup

Run `node "${CLAUDE_PLUGIN_ROOT}/dynamo/dynamo.ts" setup` followed by one `--check "<command>"` per confirmed check, in
order, for example `node "${CLAUDE_PLUGIN_ROOT}/dynamo/dynamo.ts" setup --check "node --run verify" --check "git diff --check <base>" --language "Español"`.
With the human's answer to keep the existing checks, pass no `--check`. Pass `--language "<name>"` with the language the
human chose; if they chose none, or to keep the one the file has, pass no `--language`. Use the Bash tool with `run_in_background: true`
and `timeout: 7200000` (the maximum, two hours): the checks run one after another before anything is written, each up to
`project.checkTimeoutMinutes`, and a background command is stopped at its `timeout` too (10 minutes by default, so the
default is not enough), not only a foreground one. The `timeout` covers all the checks together, not one.

Tell the human the setup was launched and that you will report when it exits. Then wait for the notification that the
background command ended; do not poll it, do not loop on it, and do nothing else meanwhile.

From the launch until step 5, do not read, edit or move any file by hand, and do not retry with other checks without
asking again: if it fails, step 5 says what to do.

## 5. Report what it printed

When the notification says the command ended, read its output and its exit code. Show the human the JSON line `setup`
printed, word for word, with the exit code, and then say in plain words, from that line only:

1. Exit 0: the keys of `factory.json` it brought up to date (`keysAdded`: added with the template's value; `keysFilled`:
   asked or read as on a first install; `keysRemoved`: removed because nothing reads them; each only when not empty), the board (`board`, `boardCopied`), the files written (`path`, `settings`, `gitignore`; the language of the documents is the `documentsLanguage` of that file), the labels, the
   Dependabot file, `ci` and `ciMissing` (the checks no workflow of the project runs: say them, they are the human's to
   fix), `codeScanning`, and whether the setup committed (`commit`, `clean`). Give the `push` command exactly as printed:
   the push and the pull request are the human's, never run it.
2. Exit 1: nothing was written when `error` says so. Give the `error`. If a check has a `hint`, give the form it
   suggests and offer to run the setup again with it (go back to step 3).
3. Exit 2: the call was wrong. Give the `error` and stop.

If the output has no JSON line, show what it has and say so. If the notification says the command was stopped at the
`timeout` of step 4, tell the human it was cut off by the time limit, not that the checks failed; `setup` may have left a
temporary worktree of the rehearsal behind, so tell them to look at `git worktree list`. Do not run it again without
asking.

## End

Finish with a short summary: the checks confirmed, the language, the exit code, and the push command if there is one. Never run
`dynamo run`, push, or open a pull request.
