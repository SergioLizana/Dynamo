# Using the board

For the agents: read it when a task touches the board or the tickets. It says what the board means, who moves what
and how to read it without filling the context. The raw commands, and how each one was tested, are in
`github-board.md`. Below, `<repo>` is
`project.repo` and `<n>` an issue number.

## What it is

The tickets are GitHub issues of `<repo>`; the board is a GitHub Project with one Status field. The columns are the eight
below, fixed by the board template: their names are Dynamo's, in the code (`dynamo/columns.ts`) and the skills. Their
option ids are in the block `board` of `.claude/factory.json` (`board.options`, keyed by those names); never write the
ids from memory.

| Column | Means |
|---|---|
| *Backlog* | Parked: written, but not to be built yet. The human brings it back by moving its card to *Todo* in GitHub |
| *Todo* | Waiting. A new ticket lands here (`/dynamo:to-tickets` moves it; GitHub adds it with no status) |
| *Build* | The Builder is changing the code |
| *Verify* | The automatic check runs |
| *Review* | The `reviewer` judges the change |
| *Merge* | The reviewer passed it: the card is here until the merge into the working branch ends (the checks after the merge run here) |
| *Needs Human* | Stuck: a comment says what failed, where it stopped, what is left and how to relaunch it |
| *Done* | Merged into the working branch, with the done label (`project.doneLabel`) |

«Done» is not «closed»: the issue stays open until the release PR reaches the main branch (`Closes #n`).

The board view in GitHub is filtered with `is:open`, so a closed ticket leaves *Done*: the column shows only tickets
still open. The card of a closed ticket still exists; only the view hides it.

## Who moves what

- `dynamo run` moves the card at every real step, and checks each move.
- `/dynamo:to-tickets` moves a new ticket to *Todo*.
- The Builder and the `reviewer` never move a card; they only read.
- Only the human takes a card out of *Needs Human* (`github-board.md`, «Needs Human»).

## Reading without filling the context

- **Never list the board** (`gh project item-list`): it returns every card of every ticket ever made. Read one issue
  at a time.
- **Ask only for the fields you need**, with `--json <fields>` and `--jq`. Bodies and comments only of the ticket you
  work on, never of a list.
- The card of one ticket: `gh issue view <n> -R <repo> --json projectItems --jq '.projectItems[0].status.name'`.
- Its blockers (the native relation is the truth; the «Blocked by» section of the body is only for reading):
  `gh api repos/<repo>/issues/<n>/dependencies/blocked_by --jq '.[]|{number,state}'`.
- The open tickets: `gh issue list -R <repo> --state open --json number,title` (no bodies).

## When a ticket is ready

Open, without the done label, with a card on the board (an issue with no card, an epic for one, is never a ticket: «no
card on the board»), its card in *Todo* (a card in *Backlog* or *Needs Human* is not ready; a card in a phase column is ready only with its
file `.claude/worktrees/runs/<n>.json`, whose run is dead, as `dynamo/resumes.ts` does; the reason names the column),
and every blocker closed or with the done label. A closed blocker
stays in the relation with `state: closed`.

## Moving a card

By the issue URL and the column name, then read back only that issue: `move_card` in `github-board.md`.
If the card is not in the column, move it once more; if it is still not there, stop and say so with the output.

## Evidence

The state changes of a card are written by GitHub, not by an agent: the GraphQL query «Checking which states a card
has passed through» in `github-board.md`. A comment by an agent is a claim, not evidence.

## Git Bash

An argument that starts with `/` (a title like `/dynamo:autopilot …`) is rewritten as a Windows path: put
`MSYS_NO_PATHCONV=1` before the command (`dynamo` sets it itself for its agents and its own commands; by hand it is
still needed). A body given with `--body-file` is not affected.
