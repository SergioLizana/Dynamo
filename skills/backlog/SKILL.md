---
name: backlog
description: Put one idea on the board - a short issue (the idea and where it came from) with the idea label and its card in the Backlog column, and nothing more. Use when the human, or a model during a session, finds something that is not a ticket yet and must not be lost, with /dynamo:backlog «the idea in one sentence».
argument-hint: "«the idea in one sentence»"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dynamo/dynamo.ts" card *), Bash(gh label list *), Bash(gh label create *), Bash(gh issue list *), Bash(gh issue create *), Bash(gh issue view *)
---

# /dynamo:backlog

Turn one idea into a short issue on the board, told apart from a parked ticket by its label. A model may launch this
skill by itself, so it does only that and no more: it never moves the card out of *Backlog* and never turns the idea
into a ticket (that is `/dynamo:discover #<n>`, later, by the human). Talk to the human in the language their
`CLAUDE.md` asks for; the issue is written in `project.documentsLanguage`.

Every project value (`project.repo`, `project.ideaLabel`, `board.boardName`) is read from `.claude/factory.json`, with
its meaning in `${CLAUDE_PLUGIN_ROOT}/guides/factory.md`; never write them here. The column is *Backlog*: the board's
columns are Dynamo's, fixed by the board template, so the skill names it. Read
`${CLAUDE_PLUGIN_ROOT}/guides/board-guide.md` for how to read one issue without listing the board.

Run each `node` command exactly as written, with nothing appended, or it is no longer covered by `allowed-tools`.

## 1. Start

1. The idea is `$ARGUMENTS`. If it is empty, **stop**: show the usage `/dynamo:backlog «the idea in one sentence»`
   and create nothing.
2. Find where it came from, from what you already know: the ticket, the release report, the conversation or the file
   where it appeared (a number `#<n>`, a path, or «said in a session»). Do not ask the human for it; if you do not
   know, write «not recorded».
3. Check the repository once for the same idea: `gh issue list -R <repo> --state open --label <ideaLabel> --json number,title`.
   If an open issue already says it, **stop** and report its number: create nothing.

## 2. The label

1. Read the labels of the repository: `gh label list -R <repo> --json name --limit 1000`.
2. If `project.ideaLabel` is not among them (a project installed before the label existed), create it:
   `gh label create <ideaLabel> -R <repo>`. If that fails, **stop** and report the output.

## 3. Create the issue

1. `gh issue create -R <repo> --title "<the idea, one short line>" --body-file - --label <ideaLabel> --project "<board.boardName>"`,
   with the body on standard input (if the shell rewrites a title that starts with `/`, see
   `${CLAUDE_PLUGIN_ROOT}/guides/github-board.md`):

   ```markdown
   ## Idea
   <the idea in one or two sentences>

   ## Where it came from
   <the ticket, report, file or session>
   ```

   Nothing else: no acceptance criteria, no blockers, no parent. It is not a ticket.
2. Move its card to *Backlog*: `node "${CLAUDE_PLUGIN_ROOT}/dynamo/dynamo.ts" card <n> Backlog`. A new issue lands on
   the board with no status, so this is the move that puts it there. Exit 0 is done; exit 1 or 2 is not: keep the
   literal line (its `error` says why) and report it.

Never move the card to any other column, never edit the issue afterwards and never run `dynamo run`.

## 4. Read it back

Read from GitHub, not from memory: `gh issue view <n> -R <repo> --json number,url,labels,projectItems`. It must show
the label `project.ideaLabel` and the card with the status *Backlog*. If either is missing, say which, with the output.

## End

Report in two lines: the issue number and link, and that it has the idea label and its card in *Backlog*, or what is
missing. Remind the human, once, that the idea becomes work with `/dynamo:discover #<n>`; this skill does not do it.
