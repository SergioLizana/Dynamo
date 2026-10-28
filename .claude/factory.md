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

## Permissions

`.claude/settings.json` holds the rules of the whole session: Claude Code has no `allow` or `deny` of its own per agent
(`documentation/backlog.md`, «Different permissions per agent»), so the `allow` list is the ceiling for every phase and
agent. An agent's header can only take tools away. Each rule is the narrowest form of a command the factory runs; a
command outside these forms asks (or is refused in `-p`), which is the point.

| Phase or agent | Tools | Commands it runs (the rule is in `allow`) |
| --- | --- | --- |
| `board` workflow (start) | `runner`: Bash | `git status --porcelain --untracked-files=no`, `git branch --show-current`, and, each one inside `sh -c 'out=$(… 2>&1); code=$?; printf %s "$out" \| base64; exit $code'`, `cat .claude/factory.json` and `gh api graphql` (read) |
| `run` workflow, Build | `builder`: all tools | `git rev-parse`, `git branch --show-current`, `git checkout -b ticket/…`, `git log`, `git cherry-pick <base>..<branch>` (round 2), `git add`, `git commit`, `gh issue view`, `gh issue comment` |
| `run` workflow, Verify | `runner`: Bash only | the card move and read-back (`gh project item-edit`, `gh issue view`), `git -C <copy> status`, `rev-parse`, `merge-base`, and the checks inside `sh -c 'cd <copy> && …'` |
| `run` workflow, Review | `reviewer`: Read, Grep, Glob, Bash (no Edit or Write) | `git -C <copy> diff`, `log`, `show`, `status`, `gh issue view`, `ls`, `wc`, and what a checkbox needs to be proven |
| `run` workflow, Merge | `runner`: Bash only | `git merge --no-ff ticket/…`, `git merge-base`, `git revert -m 1 --no-edit HEAD`, `git merge --abort`, the checks, `gh issue edit --add-label`, `gh issue comment` (through `sh -c 'printf … \| base64 --decode \| …'`), and its read-back (`gh issue view --json comments`, inside the `out=$(…)` form above) |
| `run` workflow, cleanup | `runner`: Bash only | `git branch --list`, `git worktree list`, `remove` (inside `sh -c`) and `prune` |
| `release-report` workflow | `runner`: Bash only | `git rev-parse`, `git rev-list --count`, `git ls-remote --heads origin`, and, each one inside the `out=$(… 2>&1)` form above, `cat .claude/factory.json` (alone), `git log --first-parent`, `gh api graphql` (read), `gh project item-list`, `gh pr list`; the report file under `.claude/worktrees/` (written through `sh -c 'printf … \| base64 --decode \| …'`, read back with `cat` in the `out=$(…)` form) |
| `/implement`, `/to-tasks`, `/discover` | the session's | the same git and `gh` forms; `gh issue create`, `gh api repos/<repo>/issues/…` (the blocker relation), `git stash push -u -m` |

What is not in `allow` on purpose: `gh api *` (only `gh api graphql` and `gh api repos/<repo>/issues/…`), `git push`
(`ask`; the run prints it for the human), `gh pr create` and `gh pr edit` (the run prints them for the human), any
`git merge` that is not `--no-ff ticket/…` or `--abort`, a bare `cat`, and `git switch`. Nothing relies on Claude Code's own
read-only exemption: every command above, `ls` and `wc` (the reviewer's) included, has a rule in `allow`. `cat` has none of its
own: the two reads the workflows make (`.claude/factory.json` and the report file) are `sh -c 'out=$(cat … 2>&1); …'` rules.

The rules that name the repository, the board and its ids (`gh project item-edit …`, `gh api repos/…`, `gh pr list -R …`,
`gh issue comment … -R …`) copy `project.repo`, `project.boardNumber`, `project.boardOwner`, `project.boardId`,
`project.statusFieldId` and `project.doneLabel`; if one of those changes in `factory.json`, change the rule too.
The `sh -c '…'` rules are the exact shapes the workflows build (`run.js`, `board.js`, `release-report.js`; the helpers `inCopy`,
`fromText` and `asBase64`): a rule for a `sh -c` command matches its whole text, so each one ends where the command ends. A
`*` inside one stands for the part that varies (a path, a query, the base64 text) and cannot be narrowed further. A check added to `project.checks` needs its own
`sh -c 'cd * && <check>'` rule.
