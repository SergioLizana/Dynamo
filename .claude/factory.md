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

| State | Option id |
|---|---|
| Todo | `7e5c5ff3` |
| In Progress | `a41ae146` |
| Verify | `a243ce09` |
| In Review | `7eccea7a` |
| Needs Human | `40dfd960` |
| Done | `e617f390` |

*Needs Human* is where a stuck ticket ends: `/implement` and the `run` workflow move its card there, with a comment that
says what failed. A person takes it out (see `documentation/github-board.md`).

If a state is renamed or recreated, read them again with
`gh project field-list 1 --owner SergioLizana --format json`.

## Labels

- Done in the working branch (the issue stays open until it reaches the main branch): `hecho-en-release`.

## Automatic check

All must exit 0. `<base>` is the working branch.

- `claude plugin validate . --strict`
- `git diff --check <base>`

## Documents

- Language of documents, commits, GitHub comments and verdicts: Spanish.
- Plan: `documentation/agent-factory-plan.md`.
- Backlog: `documentation/backlog.md`.
- Specifications: `documentation/spec-<slug>.md`.
- Launching one ticket by hand: `documentation/launch-one-ticket.md`.
