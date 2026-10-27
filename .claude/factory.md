# Factory data

Project data the factory's skills and agents read. They name none of it themselves: to use the factory in another
project, fill in this file and leave the skills alone.

## Repository

- Repository: `SergioLizana/Dynamo` (tickets are its GitHub issues).
- Main branch: `main`.
- Working branch: `release/0.1.0` (the `release/x.y.z` in progress; ticket branches start from it and merge into it).

## Board

- Project: owner `SergioLizana`, number `1`, id `PVT_kwHOAbB1zs4BoyYk`, name `Dynamo`.
- Status field: `PVTSSF_lAHOAbB1zs4BoyYkzhnQ1FA`.
- Board commands (`move_card`, dependencies, status history): `documentation/github-board.md`.

The columns (*Todo*, *Build*, *Verify*, *Review*, *Needs Human*, *Done*) with their option ids are in
`.claude/factory.json` (`options`); skills and agents take every column name from there.

*Needs Human* is where a stuck ticket ends: `/implement` and the `run` workflow move its card there, with a comment that
says what failed. A person takes it out (see `documentation/github-board.md`).

The phases of the `run` workflow (order, column, model, effort,
agent type and where a failure goes) are in `.claude/factory.json`. How to change them or add a phase:
`documentation/launch-list.md`, «The phases».

If a state is renamed or recreated, read the ids again with
`gh project field-list 1 --owner SergioLizana --format json` and update `options` (`documentation/github-board.md`).

## Labels

- Done in the working branch (the issue stays open until it reaches the main branch): `in-release`.

## Automatic check

All must exit 0. `<base>` is the working branch.

- `claude plugin validate . --strict`
- `git diff --check <base>`

## Documents

- Language of documents, commits, GitHub comments and verdicts: English.
- Plan: `documentation/agent-factory-plan.md`.
- Backlog: `documentation/backlog.md`.
- Specifications: `documentation/spec-<slug>.md`.
- Launching one ticket by hand: `documentation/launch-one-ticket.md`.
