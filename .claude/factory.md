# Factory data

The values of the project data are in the `project` block of `.claude/factory.json`, which the `board` workflow (the start of the `run`) reads
without an agent. This file keeps what the values mean and how to change them. The skills and agents name none of
the values themselves: to use the factory in another project, fill in the JSON and leave the skills alone.

## Repository

- `project.repo`: the repository (tickets are its GitHub issues).
- `project.mainBranch`: the main branch.
- `project.workingBranch`: the `release/x.y.z` in progress (ticket branches start from it and merge into it).

## Board

- `project.boardOwner`, `project.boardNumber`, `project.boardId` and `project.boardName`: the GitHub project.
- `project.statusFieldId`: its Status field.
- `project.boardCommands`: the file with the board commands (`move_card`, dependencies, status history).

The columns (*Todo*, *Build*, *Verify*, *Review*, *Needs Human*, *Done*) with their option ids are in
`.claude/factory.json` (`options`); skills and agents take every column name from there.

*Needs Human* is where a stuck ticket ends: `/implement` and the `run` workflow move its card there, with a comment that
says what failed. A person takes it out (see the board commands file).

`small` (model and effort) is for the script's small agents: the literal reads, the card moves, the reports and the
cleanup. The start of the run has no agent of its own; see `documentation/launch-list.md`, «The start».

The phases of the `run` workflow (order, column, model, effort,
agent type and where a failure goes) are in `.claude/factory.json`. How to change them or add a phase:
`documentation/launch-list.md`, «The phases».

If a state is renamed or recreated, read the ids again with `gh project field-list <number> --owner <owner> --format json`
(`project.boardNumber`, `project.boardOwner`) and update `options` (board commands file).

## Labels

- `project.doneLabel`: done in the working branch (the issue stays open until it reaches the main branch).

## Automatic check

`project.checks`: the commands of the check. All must exit 0. `<base>` in a command is the working branch; in *Verify* the run replaces it with the sha `git merge-base HEAD <base>` printed in the ticket's copy.

## Documents

- `project.documentsLanguage`: the language of documents, commits, GitHub comments and verdicts.
- `project.plan`: the plan.
- `project.backlog`: the backlog.
- `project.specifications`: where specifications go, with `<slug>` filled in.
- `project.launchOneTicket`: how to launch one ticket by hand.
