# Using the board

For the agents: read it when a task touches the board or the tickets. It says what the board means, who moves what
and how to read it without filling the context. The raw commands, and how each one was tested, are in
`documentation/github-board.md` (the file `project.boardCommands` of `.claude/factory.json` names). Below, `<repo>` is
`project.repo` and `<n>` an issue number.

## What it is

The tickets are GitHub issues of `<repo>`; the board is a GitHub Project with one Status field. The column names and
their option ids are in `.claude/factory.json` (`columns`, `options` and the `column` of each phase); never write them
from memory.

| Column | Means |
|---|---|
| *Todo* | Waiting. A new ticket lands here (`/to-tasks` moves it; GitHub adds it with no status) |
| *Build* | The Builder is changing the code |
| *Verify* | The automatic check runs (also after the merge) |
| *Review* | The `reviewer` judges the change |
| *Needs Human* | Stuck: a comment says what failed, where it stopped, what is left and how to relaunch it |
| *Done* | Merged into the working branch, with the done label (`project.doneLabel`) |

«Done» is not «closed»: the issue stays open until the release PR reaches the main branch (`Closes #n`).

## Who moves what

- `/implement` (and, from phase 2, `dynamo run`) moves the card at every real step, and checks each move.
- `/to-tasks` moves a new ticket to *Todo*.
- The Builder and the `reviewer` never move a card; they only read.
- Only the human takes a card out of *Needs Human* (`documentation/github-board.md`, «Needs Human»).

## Reading without filling the context

- **Never list the board** (`gh project item-list`): it returns every card of every ticket ever made. Read one issue
  at a time.
- **Ask only for the fields you need**, with `--json <fields>` and `--jq`. Bodies and comments only of the ticket you
  work on, never of a list.
- The card of one ticket: `gh issue view <n> -R <repo> --json projectItems --jq '.projectItems[0].status.name'`.
- Its blockers (the native relation is the truth; the «Blocked by» section of the body is only for reading):
  `gh api repos/<repo>/issues/<n>/dependencies/blocked_by --jq '.[]|{number,state}'`.
- The open tickets: `gh issue list -R <repo> --state open --json number,title` (no bodies).
- When `dynamo` has the subcommand, use it instead: `node dynamo/dynamo.ts board [n ...]` (#79) reads tickets, cards
  and blockers in one short JSON line; `card` and `comment` (#80) write and read back.

## When a ticket is ready

Open, without the done label, its card not in *Needs Human*, and every blocker closed or with the done label. A closed
blocker stays in the relation with `state: closed`.

## Moving a card

By the issue URL and the column name, then read back only that issue: `move_card` in `documentation/github-board.md`.
If the card is not in the column, move it once more; if it is still not there, stop and say so with the output.

## Evidence

The state changes of a card are written by GitHub, not by an agent: the GraphQL query «Checking which states a card
has passed through» in `documentation/github-board.md`. A comment by an agent is a claim, not evidence.

## Git Bash

An argument that starts with `/` (a title like `/implement …`) is rewritten as a Windows path: put
`MSYS_NO_PATHCONV=1` before the command. A body given with `--body-file` is not affected.
