# Factory data

`.claude/factory.json` is the configuration of a project. A new project starts from the template,
`templates/factory.json`, which holds `version` and only the values of a project; this file is the guide to each of
them and to how to choose it.

The file has two parts:

- `project`: what the project sets, typed by a person. `dynamo` reads it without an agent.
- `board`: the ids of the GitHub project (its number, id, name, the id of its Status field and the ids of its
  columns). They are read from GitHub and written by the setup; nobody types them, and the template has no `board`
  block.

The skills and agents name none of the values: to use the factory in another project, fill in the template and leave
the skills alone. In the template, `"<…>"` marks a value that has no sensible example (`repo`, `boardOwner`, `checks`);
the setup or the person replaces it. Every other value is a working example that can stay as it is until a real run
shows it needs a change.

## Version

`version` (top of the file) numbers the format of the file: which keys it has and what they mean. It is not Dynamo's
release. `dynamo` reads only the version it knows: a file with no `version`, or with another one, is refused with an
error that says which version it reads and points at the template. There is no migration; a project with an older file
starts again from the template. The number goes up only when the format changes in a way an older file cannot satisfy.
Do not change it by hand.

## Repository

- `project.repo`: the repository, as `<owner>/<name>`. Its GitHub issues are the tickets. Take it from the URL of the
  repository.
- `project.mainBranch`: the main branch, the one only a person approves into. Take the default branch of the
  repository (usually `main`).

The working branch (the `release/x.y.z` in progress, where ticket branches start and merge) is not a value: it is state
that changes with every release, so `dynamo` reads it from git. It is the greatest `release/x.y.z` branch, local or on
`origin` (as last fetched), above the last tag `v<x.y.z>`. With none, the subcommand that needs it fails and says which
branch to create (the next minor after the last tag, `release/0.1.0` with no tag). `dynamo release close` makes the next
branch on the merge commit and changes no file.

## Board

- `project.boardOwner`: the owner of the GitHub project, a user or an organization. It is usually the owner of
  `project.repo`, but a project can belong to another account.
- `board.boardNumber`, `board.boardId` and `board.boardName`: the GitHub project, read from the board.
- `board.statusFieldId`: its Status field.
- The board commands (`move_card`, dependencies, status history) are in `github-board.md`.

The columns (*Backlog*, *Todo*, *Build*, *Verify*, *Review*, *Merge*, *Needs Human*, *Done*) are Dynamo's: the board template
fixes their names, and the code (`dynamo/columns.ts`) and the skills name them; the file has no `columns` or `phases`.
Only their option ids are in the file, in `board.options`, keyed by those names.

*Needs Human* is where a stuck ticket ends: `dynamo run` moves its card there, with a comment that
says what failed. A person takes it out (see `github-board.md`).

If a state is renamed or recreated, read the ids again with `gh project field-list <number> --owner <owner> --format json`
(`board.boardNumber`, `project.boardOwner`) and update `board.options` (`github-board.md`).

## Labels

- `project.doneLabel`: the label a ticket gets when it is done in the working branch (the issue stays open until it
  reaches the main branch). Any name; the label must exist in the repository.
- `project.epicLabel`: the label of an epic, the spec `/dynamo:to-spec` writes as an issue. Only for people to see it in the
  list of issues: what makes an issue a ticket is its card on the board, and an epic has none, because nothing adds it
  (the board does not add an issue by itself, not even a sub-issue). Its tickets are its sub-issues, and they get a card
  because `/dynamo:to-tickets` creates them with `--project`. Any name; the label must exist in the repository.
- `project.ideaLabel`: the label of an idea, an issue for something that is not a ticket yet. It tells an idea from a
  parked ticket in the *Backlog* column of the board. Any name; `dynamo setup` creates it in the repository if it lacks it.

## Limits of a run

`project.budgetUsd` holds, per agent of `dynamo run` (`builder`, `reviewer`), the most one run of that agent may spend,
in USD: `dynamo run` passes it as `--max-budget-usd`, so each round's Builder and each round's reviewer has the whole
amount. An agent that reaches it stops, and the ticket goes to *Needs Human* with that reason. Each is a number above 0.
To choose it, start with the example and look at what the first tickets cost (the release report sums it): set it
above the most a healthy ticket of the project spends. Too low and healthy tickets stop; too high and a ticket that is
lost spends a lot before it stops. The reviewer reads and does not build, so it needs less than the Builder.

`project.timeoutMinutes` holds, per agent of `dynamo run` (`builder`, `reviewer`), the most one run of that agent may
take, in minutes: an agent still running past it with no result is closed together with every process it started, and
its ticket goes to *Needs Human* with the reason and the path of the agent's log (the ticket's `steps.jsonl` and its
comment). It spends no round and is not retried; it is relaunched by hand, as any ticket in *Needs Human*. Each is a
number above 0 (it may have decimals) and has no default in the code: a missing one is an error, as a missing
`project.budgetUsd` is. To change it, edit the number in `.claude/factory.json`; set it above the longest healthy run
of the project, which the log of a run shows.

`project.ticketsAtOnce` is how many tickets of a list `dynamo run` takes at once, each in its own copy: so it is also
the most agents that run at the same time, since a ticket runs one agent at a time. A ticket waits for a free place and
for its blockers of the list to be merged; merges still go one at a time, whatever the number. It is a whole number
from 1 (1 runs the list one ticket after another); more spends more of the usage limit at once. Start with 1 and raise
it when the project has independent tickets and the usage limit allows it.

## Levels

`project.levels` holds, per level of difficulty (`low`, `medium`, `high`), the model and the effort of the two agents of a
ticket of that level: `builder` and `reviewer`, each with `model` (`sonnet`, `opus`, or any name `claude --model` takes)
and `effort` (`low`, `medium`, `high`, `xhigh` or `max`, as `claude --effort`). The whole block is optional, and so is
every level, agent and value in it: what is not set takes the starting value, so a file with no `levels` runs with them.
The template lists them, which are:

| Level | Builder | Reviewer |
| --- | --- | --- |
| `low` | sonnet, effort low | sonnet, effort medium |
| `medium` | sonnet, effort medium | sonnet, effort high |
| `high` | sonnet, effort high | opus, no effort set (the model's own) |

To change one, write only that value: `"levels": { "medium": { "reviewer": { "model": "opus" } } }` makes the Reviewer of
`medium` an opus with the effort the table gives it, and leaves the rest as it is. A key that is not a level, an agent,
`model` or `effort`, or a value that is not a model name or one of those efforts, is an error that names the key, so a typo
is not taken for the default. Haiku is not among the starting values: a cheap Builder that fails and repeats costs more
than a good one at the first try. The budgets and timeouts of «Limits of a run» do not change with the level.

## Automatic check

`project.checks`: the commands of the check, a list of strings, each one a command the project already runs (its tests,
its linter, its type check, `git diff --check <base>`). All must exit 0. Choose commands that are deterministic and
that end by themselves, and that a healthy change passes; the check is what lets a ticket reach the reviewer. Programs
run directly, with no shell, so a command is a program and its arguments. `<base>` in a command is the working branch;
in *Verify* the run replaces it with the sha `git merge-base HEAD <base>` printed in the ticket's copy.

**An npm script is written `node --run <script>`, not `npm run <script>`.** A command runs with no shell, and `npm`
cannot start that way on Windows (the setup answers 127 and names this form); `node --run` can, and it runs the script of
`package.json` with its own shell and `node_modules/.bin` on the PATH.

**The install goes inside the check.** Verify and the merge run the checks in a clean copy of the branch, which has no
`node_modules`. A check that needs the packages must install them itself, and a command cannot chain two programs, so
the install is part of the script the check runs: `"verify": "npm ci && node --run build"` in `package.json`, and
`node --run verify` in `project.checks`. The installed packages stay in that copy and are removed with it. The skill
`/dynamo:setup` proposes the checks from the scripts of the project, and the human confirms them before the setup runs
them once.

`project.checkTimeoutMinutes`: the most one command of `project.checks` may run, in minutes; one value for every
command, required, with no default in the code (a missing, zero or non-numeric value is an error in `dynamo verify` and
`dynamo merge`). A command still running after it is closed together with every process it started and counts as a
failed check, with «timed out after N min» first in its output: in *Verify* the Builder gets it in the next round, in
the merge the ticket goes to *Needs Human*, as with any failed check. A test that does not end is usually the change's
fault. To change it, edit the number (it may have decimals, e.g. 0.5); set it above the longest healthy run of the
slowest command of the check.

## Documents

- `project.documentsLanguage`: the language of documents, commits, GitHub comments and verdicts, written as the name of
  the language (`English`). Choose the language the people who read the repository work in.

## Reinforcing the Builder and the Reviewer

Dynamo's Builder and Reviewer carry the tools every project has and the rules that hold in any project. A project that
needs more (a browser to check a page, an agent of its own) adds it in two optional files, committed in the project so
that every ticket's copy has them:

- `.claude/dynamo/builder.md`: reinforces the Builder.
- `.claude/dynamo/reviewer.md`: reinforces the Reviewer.

A project with neither file runs as without them, and keeps getting Dynamo's improvements with `claude plugin update`.
Write only the file of the agent that needs it.

Each file has two parts:

- The front matter, with `tools:`: the tools the file adds, a comma-separated list like the `tools:` of an agent. They
  join the tools of Dynamo's agent; they do not replace them. MCP tools are named `mcp__<server>__<tool>`: a tool of an
  MCP server is not available to the agent until it is listed here.
- The body, the rules the file adds: how to use those tools and what the project asks of the agent in its own terms.

At launch `dynamo run` joins the two into one agent: Dynamo's tools plus the project's, and Dynamo's text unchanged with
the project's body below it, under the heading «Rules of this project: they add to the rules above, never override
them». Name and description stay Dynamo's, and nothing is written to a file. So the file holds only what is the
project's; copying a whole agent into the project would leave it behind every improvement of Dynamo.

An example, `.claude/dynamo/reviewer.md` of a web project whose Reviewer checks a page in a browser:

```markdown
---
tools: mcp__playwright__browser_navigate, mcp__playwright__browser_snapshot, mcp__playwright__browser_resize
---

When a checkbox is about what a page shows, open it with the browser tools and look at it at 1024 px and at 390 px
wide before judging; a checkbox about a page that nobody saw is not proven.
```

### What a reinforcement cannot do

A reinforcement only adds. It cannot:

- **Remove Dynamo's rules or tools.** Its rules come after Dynamo's and add to them; if they contradict Dynamo's,
  Dynamo's win. It has no way to take a tool off the list.
- **Change the model or the effort.** They are set by the level of each ticket, whatever the file says.
- **Give the Reviewer Edit or Write.** The judge must not touch what it judges: if `.claude/dynamo/reviewer.md` lists
  `Edit` or `Write`, `dynamo run` stops and says why, and launches no agent.

### An agent of the project as a tool

A tool can be `Agent(<name>)`, where `<name>` is an agent of the project in `.claude/agents/<name>.md`: the Builder or
the Reviewer then hands a part of its work to that agent and gets its answer back. For example, a Reviewer that hands
the check of a page to the project's `page-checker`:

```markdown
---
tools: Agent(page-checker)
---

For a checkbox about what a page shows, ask `page-checker` and use its answer as evidence.
```

## Permissions

`.claude/settings.json` holds the rules of the whole session: Claude Code has no `allow` or `deny` of its own per agent,
so the rules are the same for every phase and agent. An agent's header can only take tools away. The `allow`
list holds what runs with no check, each rule the narrowest form of a command the factory runs; a command outside it
asks in a plain session, and `auto` decides it under `dynamo run`.

| Phase or agent | Tools | Commands it runs (the rule is in `allow`) |
| --- | --- | --- |
| `dynamo run`, Build | `builder`: all tools | `git rev-parse`, `git branch --show-current`, `git log`, `git status`, `git add`, `git commit`, `gh issue view`, `gh issue comment`, `git merge`, `git merge --abort`, `git branch --list`, `git worktree list`, and the node commands that run the tests (`git merge <base>` has no rule in `allow`: it is left to `auto`) |
| `dynamo run`, Review | `reviewer`: Read, Grep, Glob, Bash and StructuredOutput, its answer (no Edit or Write) | `git diff`, `log`, `show`, `status`, `gh issue view`, `ls`, `wc`, and what a checkbox needs to be proven |
| `dynamo` itself (`run`, `verify`, `merge`, `board`, `report`, …) | not an agent: it starts its own git, `gh` and check processes (`dynamo/exec.ts`) | no rule applies to them |
| `/dynamo:to-tickets`, `/dynamo:to-spec`, `/dynamo:discover` | the session's | the same git and `gh` forms; `gh issue create`, `gh api repos/<repo>/issues/…` (the blocker relation) |
| `/dynamo:close-release`, `/dynamo:new-release` | the session's | `git status`, `git checkout release/<next>` (both in `allow`), `git fetch` (no rule: it asks in the session) and `git push` (`ask`) |

`dynamo run` starts its agents with `--permission-mode auto` and no prompts (`dynamo/agents.ts`): a command that no rule
allows is decided by `auto`, and one that `auto` would still ask about is denied. When the check of `auto` itself is down
(«gave no verdict»), a Builder it stopped goes on after a wait, with no round spent (`dynamo/rounds.ts`).

What is not in `allow` on purpose: `gh api *` (only `gh api graphql` and `gh api repos/<repo>/issues/…`), `git push`
(`ask`; the run prints it for the human), `gh pr create` and `gh pr edit` (the run prints them for the human), a bare
`cat`, and `git switch`. Nothing relies on Claude Code's own read-only exemption: every command in the table, `ls` and
`wc` (the reviewer's) included, has a rule in `allow`, or the table marks it as one that asks or is left to `auto`.

The rules that name the repository, the board and its ids (`gh project item-edit …`, `gh api repos/…`) copy
`project.repo`, `board.boardNumber`, `project.boardOwner`, `board.boardId`, `board.statusFieldId` and
`project.doneLabel`; if one of those changes in `factory.json`, change the rule too.

## Writes outside the repository

Nothing keeps an agent's files inside the repository except this (source
https://code.claude.com/docs/en/sandboxing):

- Claude Code's sandbox (`sandbox.enabled`) limits the writes of shell commands to the working folder and the temp
  folder. It runs on macOS, Linux and WSL2 (not WSL1). On native Windows there is no sandbox:
  the page says «On native Windows, Claude Code runs commands unsandboxed», and the same when it cannot start unless
  `sandbox.failIfUnavailable` is `true`. So it cannot be the one guard, and it is not turned on.
- The guard is the `PreToolUse` hook for Bash in `hooks/hooks.json`, `hooks/outside-writes.js` (node;
  the same on every system). It reads the command text and refuses, with exit 2,
  a write or delete (redirections, `touch`, `mkdir`, `rm`, `mv`, `cp`, `tee`, `sed -i`, `tar`, `curl -o`, `git clone`,
  `git worktree add`, `find -delete`, `mktemp`, `sh -c` and `eval` strings, and any absolute or `../` path inside
  `node -e` or `python -c` code) whose target is not inside the working tree of the session (the repository, or the copy
  the session runs in) or in a `claude*` folder of the temp folder (the scratchpad). A target it cannot expand
  (`$UNSET/x`) is refused. Reads are not checked.
- It is a guard against an agent's mistake, not a jail: a script file that writes elsewhere, a path built in code, and
  the `Edit` and `Write` tools (which `allow` opens with `Edit(/**)`) and the PowerShell tool are not seen. Claude Code
  reads the hook when a session starts, so a session already open does not get it.
- To change what is allowed, edit `allowed` in the hook; to test it, `node --test hooks/outside-writes.test.js`.

## The main folder while a run is alive

`dynamo merge` stops when the main folder is not clean, so an edit made there while a `dynamo run` is alive can fail a
ticket that passed at its merge. The guard
is a second `PreToolUse` hook in `hooks/hooks.json`, `hooks/main-folder-lock.js`, for `Edit`, `Write`,
`MultiEdit`, `NotebookEdit` and `Bash`:

- It reads the lock of the run, the file `dynamo run` keeps in `.claude/worktrees/` of the main folder (`dynamo/runlock.ts`). The run is alive when its pid answers and
  its heartbeat is under 5 minutes old (`holderOf` in `dynamo/runlock.ts`, the same rule `dynamo run` uses).
- While it is alive, it refuses, with exit 2, a change to a file of the main folder, and says the pid of the run, since
  when it runs and why. For `Bash` it reads the command text with the same analysis as `outside-writes.js` (redirections,
  `touch`, `rm`, `mv`, `cp`, `sed -i`, …), so a script file that writes there is not seen. Reads and `git` commands are not
  refused, and `dynamo` itself is not a session: its writes are not checked.
- Writable: the copies under `.claude/worktrees/` (ignored by git), the scratchpad, and anything outside the main folder.
- With no lock, or a dead one (the pid does not answer or the heartbeat is old), nothing is refused.
- **The human waits for the run to end** (or stops it) before editing in the main folder; to work meanwhile, use a copy.
- To test it: `node --test dynamo/tests/main-folder-lock.test.ts`. Claude Code reads the hook when a session starts.
