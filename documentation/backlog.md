# Backlog

Ideas and risks that come up along the way and do not become a ticket unless a real problem asks for them (plan §8.1).
Each entry says where it comes from and what has been verified.

## Protect `main`

- **Origin:** review of #4 (2026-10-26). The deny list in `.claude/settings.json` stops `git push` and `gh api -X/--method`,
  but `gh api <path> -f …` makes an implicit POST, and `gh api graphql` accepts mutations: an unattended run could write
  to `main` through the API.
- **Verified:** with the Free plan and a private repository, GitHub does not allow protecting branches or creating rules:
  `gh api repos/SergioLizana/Dynamo/branches/main/protection` → `403 Upgrade to GitHub Pro or make this repository
  public`; `.../rulesets` gives the same.
- **Options:** GitHub Pro; or the agents use a fine-grained token with *Contents* read-only (the agents do not need to
  write code to GitHub: they merge locally), and *Issues* and *Projects* with write access. Not checked whether a
  fine-grained token can write to a user Project.
- **Why not a separate `git-ops` agent with more permissions** (considered 2026-10-26): the `deny` rules apply to the whole
  session, subagents included, so one cannot deny something to the Builder and allow it to another agent without a
  custom hook; the rules on Bash are not a barrier (the Builder can call `git` from another program), and no agent needs
  to push: they merge locally. The real cut is in the credentials of the unattended run:
  - `gh`: the fine-grained token above, passed as `GH_TOKEN` only in the launch command;
  - `git push`: uses the system credential manager, not `GH_TOKEN`; to remove it from that run, empty `credential.helper`
    with environment variables (`GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_0`, `GIT_CONFIG_VALUE_0`).
  - Neither one is checked. It is not complete isolation either (an agent with Bash in the same user could reach the
    credential manager): only a container gives that (plan §7 and §10.4).
- **When:** before leaving unattended lists running (stage 3).
- **Different permissions per agent** (checked in `code.claude.com/docs/en/sub-agents.md` on 2026-10-27): the header of a
  subagent accepts `tools`, `disallowedTools`, `permissionMode` and `hooks`. It does not accept its own `allow` or `deny`
  rules: the ones in `settings.json` apply to the whole session, subagents included. `disallowedTools` removes the whole
  tool (`Bash(git push *)` removes all of Bash) and `permissionMode` is ignored if the session is in `auto`, like our
  `-p`. The only thing that filters commands agent by agent is a `PreToolUse` hook in its header, which only runs while
  that agent is active. It works to trim (a Builder without push), never to give an agent more than the session has. It is
  a good-faith barrier, like `deny`, and it would be a custom command that has to work on Linux, macOS and Windows. Try it
  only when a ticket needs to split permissions between agents.
- **Push to `release/x.y.z`** (considered 2026-10-26): today `git push` is in `ask` (in a normal session it asks; in `-p`
  it is denied). It is not moved to `allow` because no ticket needs it (it merges locally), and a rule such as
  `Bash(git push origin release/*)` would also let through `git push origin release/0.1.0:main`, with nothing in GitHub to
  stop it. It will be needed in stage 3b, when `/run` uploads the release to open the PR against `main`: decide it then,
  together with the credentials (a token that only pushes `release/*`) or GitHub Pro.

## A separate identity for the agents

- **Origin:** review of #4. Everything the agents do (comments, labels, ticket edits) goes out under the name
  `SergioLizana`: GitHub does not distinguish what the human did from what an agent did.
- **Options:** a machine account (conditions for this type of account on GitHub not checked) or a GitHub App. A
  fine-grained token of the own account limits what the agent can do, but does not change the author.

## `git worktree` permissions for `/run`

- **Origin:** tests of #17. `git worktree add` and `git worktree remove` are not in `.claude/settings.json`; in a normal
  session the `auto` mode decided them. With `claude -p --permission-prompts none` they would be denied if the mode does
  not approve them.
- **When:** the `run` workflow removes its copies with `git worktree remove` in its last `runner` call. If a real run
  asks for permission there, add the rule then.

## Automatic deletion of subagent copies, unseen

- **Origin:** review of #17. The table in `documentation/parallel-launch-trial.md` says that a subagent's copy is deleted by
  itself "if nothing changes, not even the branch". It comes from the documentation (research §3.2): in the tests no copy
  was deleted by itself, because both had changes or had changed branch.
- **When:** if `/run` ends up depending on that cleanup.

## *Closed* column on the board

- **Origin:** the human, 2026-10-27, on finding #21 (test ticket of #18) closed but with its card in *Todo*. He wants to
  see on the board, without opening each ticket, when he has to step in. The *Needs Human* column (#36) covers the
  stuck tickets; a *Closed* column is still open.
- **Not checked:** whether the project's built-in flow ("Item closed") can move the card to *Closed* by itself when the
  issue is closed. In the history of #21 there is a `Todo -> Closed` and a `Closed -> Todo` on 2026-10-26 at 23:46 that
  nobody has explained, with no *Closed* option existing.

## Splitting `/implement` into several agents

- **Origin:** the human, 2026-10-27: it is often read that each phase of a factory has its own agent, and there are
  orchestrators that are a skill launching subagents (like Pocock's `implement-spec`).
- **How it is now:** `/implement` is one session that follows `.claude/agents/builder.md` itself, runs the commands of
  "Automatic check" (no model, so that it does not depend on what one answers) and launches the `reviewer` subagent,
  with its own context and read-only. The `run` workflow already splits the phases: one agent per phase (the `builder`,
  the `reviewer`) and the script decides the rest from the commands' exit codes. What stays open is only whether the
  by-hand `/implement` should split too.
- **Verified:** a subagent can launch its own up to three levels below the main session (subagent documentation,
  2026-10-27).
- **Data:** from #14 to #16, 13-17 turns and 0.49-0.86 USD per ticket. The only extra round (#15) came from the order of
  the steps, not from mixing phases.
- **Signal to do it:** the Builder runs out of context on large tickets, or there are rounds because the Builder judges
  itself. Before that, read research §3 and §7 on separating phases.

## `/to-request` takes free text as the file name

- **Origin:** use on 2026-10-27. `/to-request` expects a short name as an argument (`$0`). A list of pending items was
  passed to it and `$0` became "Sigue": the file would have been called `spec-Sigue.md`. The name was taken from the idea
  by hand.
- **When:** the next time `/to-request` is touched.

## Notes from tickets #15 and #16

- **Origin:** final comments of #15 and #16 (2026-10-26).
- `/to-tasks` without an argument accepts the `/discover` summary as the specification: not tested in real use.
- `/to-request` writes "Nothing agreed" in an empty section, and the `request.md` template uses "None".
- #16 added two things that no checkbox asked for (sending ideas to `backlog.md` and the limit of ~70 characters per
  line), and the reviewer said PASS: watch whether the reviewer lets through what goes beyond the ticket.

## Minor findings of the review of 2026-10-27

Small things found when reviewing the list #53-#58. None is a problem yet; each waits for a ticket that touches the file.

- **`to-tasks` and the board states.** The skill says the board states are in `.claude/factory.md` and moves the new
  card to *Todo* by name. It should take the states from `.claude/factory.json` and the column from `columns.todo`.
- **Document paths in `/implement` and in the ticket comment.** `/implement` names `documentation/github-board.md` and
  `documentation/launch-one-ticket.md`, and `ticketComment` in `run.js` names `documentation/github-board.md` and
  `documentation/launch-list.md` in the «To relaunch» line. They should come from the project data
  (`project.boardCommands`, `project.launchOneTicket`; `launch-list.md` has no key yet).
- **The ticket template and the plan path.** `.claude/templates/ticket.md` ends with the literal
  `documentation/agent-factory-plan.md`; it should take the path from `project.plan`.
- **`documentation/spec-pendientes-etapa-2.md`** has a Spanish name. It needs an English one (the files in
  `documentation/` are named in English, `CLAUDE.md`).
- **«Parado en» in `run.js`.** The comment before the phase functions still says «Parado en»; the comment, the report and
  the docs say «Stopped at».
- **The `bloqueado` label on GitHub.** No skill, agent or workflow uses it since #36 (the column *Needs Human* is the
  signal). The human deletes it: `gh label list -R SergioLizana/Dynamo` still showed it on 2026-10-27.
- **`move_card()` in `documentation/github-board.md`** is bash-only and reads at most `--limit 100` cards. The form
  `gh project item-edit <number> --owner <owner> --url <issue URL> --field "Status" --value "<column>"`, which `cardCommands`
  in `run.js` already uses, works on any shell and with any number of cards; replace the function by it.
- **Out of the ticket, noted by the Builders and never taken to the backlog.**
  - #38: `CLAUDE.md` said the research stayed in Spanish; it reads English now (nothing left to do).
  - #41: `to-tasks` still says the states are in `factory.md` (first entry above); plan §6.5 said that nothing else copies
    the phase models while it cited them; fixed in #61.
  - #43: Git Bash turns a commit subject that starts with «/» into a path (the first commit became
    «C:/Program Files/Git/implement …» and was amended). `/implement` step 5 and the Builder could warn about a leading
    «/» in a subject, or set `MSYS_NO_PATHCONV=1`.
- **The skills and the reviewer read `.claude/factory.md`.** The text says «read `.claude/factory.md`», which only points
  to the JSON. They should name `.claude/factory.json` directly (`implement`, `to-tasks`, `to-request`, `discover` and
  the `reviewer`). From the run of #53-#55.

## Phases without globals, and a cap on parallel builds (#59)

- **Origin:** ticket #59, moved to the backlog by the human on 2026-10-27: it waits for a real problem.
- **What it asked for:** the phase functions of `run.js` use globals declared hundreds of lines later (`P`, `base`,
  `builds`) and change `ctx` inside `read()`. Each phase would be an entry with `input(t, ctx, env)` and
  `judge(result, t, ctx, env)` and no globals, with `run.js` at most 300 lines; `factory.json` would gain `limits`
  (`maxRounds`, `parallel`), and the script would never run more than `parallel` builds at once (plan §6.1 says N starts
  at 2; today the workflow has no cap).
- **Already done from it:** the round fields reset when a round starts (#56) and the agent ceiling of a ticket that
  passes in round 1 (#58).
- **When:** a run uses up the usage limit or the machine with several builds at once, or `run.js` is hard to change.

## Splitting `run.js` into files (#60)

- **Origin:** ticket #60, moved to the backlog by the human on 2026-10-27. The human wants `run.js` split into several
  JavaScript files once it grows. The workflow runtime has no documented `import`; its one documented composition is a
  child workflow (`workflow({scriptPath}, args)`, one level deep, no shared functions). Nobody has tried either.
- **To test, with throwaway scripts outside `.claude/workflows/`:** an `import` of a sibling file; a child
  `workflow({scriptPath})` with object args and a returned value; whether a script under `.claude/workflows/run/` shows up
  as a `/` command; and what a resume does with a child.
- **When:** only if `run.js` grows again after #53-#58. Then the findings and a recommendation go in
  `documentation/launch-list.md`, «The phases».

## The board read brings the tickets already in the release

- **Origin:** question during run `wf_0a4017b2-50d` (2026-10-28). With no numbers, `board.js` reads the first 100 open
  tickets, and a merged ticket stays open with `in-release` until the release reaches `main`: of about 40 open tickets,
  about 30 are already done. They travel through the read only to be dropped by the script.
- **Verified:** the query is `issues(states:OPEN, first:100)` in `board.js`; it has no label filter.
- **Option:** ask GitHub only for the open tickets without the done label (a search such as `is:open -label:in-release`).
- **When:** if the read is still slow or heavy after #76 moves the big reads to a command.

## A skill to close a release

- **Origin:** ticket #74 (2026-10-28), closed when 0.1.0 was frozen (`documentation/orchestrator-review.md`). Closing a
  version is a fixed sequence with delicate steps: the release PR must close every ticket merged since the main branch
  (PR #66 had 2 `Closes` of 50 when 0.1.0 was frozen), only the human merges it, and afterwards nothing records which
  tickets shipped in which version, and `workingBranch` in `factory.json` still points to the closed release.
- **Decided by the human (2026-10-28):** the version goes in a milestone and a git tag, «closed» keeps meaning «in the
  main branch», and no label is added for it.
- **What the ticket asked:** an interactive `close-release` skill: before the merge, check the `Closes` lines against
  the merged tickets and stop for the human; after it, the milestone, the tag `v<x.y.z>` on the merge commit, a GitHub
  Release with the report and the next `release/<x.y.z>` with `workingBranch` set, in one commit.
- **When:** 0.1.0 is closed by hand. If closing 0.2.0 hurts again, it becomes a ticket, as a `dynamo` subcommand or a
  skill that calls it.

## The multi-project harness (ideas of the external diagnosis)

- **Origin:** part 2 of the diagnosis in `documentation/Research/` (2026-10-28), reviewed in
  `documentation/orchestrator-review.md`, phase 6. None is built before a real project asks for it (plan §3, rule 2).
- **Ideas, each with its trigger:**
  - A QA step with browser screenshots against the criteria: a ticket passes checks and review but fails in the browser.
  - A review panel by risk, with confidence scores and finding ids: failures found in the release PR that the reviewer
    let through, counted.
  - A human gate in a step (schema, payments): a project with changes that must not merge without a person.
  - Stack profiles (KMP, Android, iOS in CI): the KMM app starts.
  - Knowledge from Obsidian or Confluence: a project keeps its docs there.
  - Another backend (Agent SDK, Codex): a second backend is needed, or data says another model reviews better.
  - A single binary (Bun): a project where Node is not available.
  - A declarative pipeline in YAML with `when` conditions: two projects need different pipelines. Until then the
    pipeline stays in code.
- **Not before:** formal interfaces (`Board`, `Runner`, `Knowledge`) with a single implementation each.

## The live view of a run: a Claude Code mod

- **Origin:** question of the human, 2026-10-28. With `claude -p` processes there is no `/workflows` view.
- **Idea:** a mod with a «Dynamo» pane beside the chat that refreshes from `dynamo status --json`, one row per ticket
  (column, round, last step, turns, cost). Details in `documentation/orchestrator-review.md`, phase 2.
- **When:** the logs and `dynamo status --json` exist and the first real list shows that the log and the board are not
  enough.

## The agent log is written only when the agent ends

- **Origin:** ticket #86 (merged, 2026-10-28). `runAgent` (`dynamo/claude.ts`) runs `claude -p --agent` through `exec`
  (`dynamo/exec.ts`), which uses `spawnSync`: the stream arrives whole when the process ends, and only then
  `writeFileSync(run.log, …)` writes it.
- **Problem:** while an agent works its log does not exist or is empty, so the live view above (the last step of each
  agent, read from `logs/*.jsonl` or `dynamo status --json`) would have nothing to show until the agent is done.
  Also, `exec` has a `maxBuffer` of 64 MB: a bigger stream makes `spawnSync` fail and the log is lost too.
- **Options (none chosen):**
  - Give the child's stdout to the log file itself (a file descriptor as the stdio of `spawnSync`), so the log grows
    live and does not depend on the buffer. It changes `exec.ts`, and the result is read back from the file.
  - Move to an asynchronous `spawn`, which running two tickets at once (N = 2 with a merge lock) needs anyway.
- **When:** the ticket that builds `dynamo run` or the live view, whichever comes first. Nothing to fix before.

## The Builder explores the code again on every ticket

- **Origin:** the cost of the first `dynamo run` list (2026-10-29). The Builder's cost is turns × context: #91's Builder
  read 3.15 M cached tokens in 63 turns and wrote 35 k; it read about 106 k characters with Read (#90's, about 51 k),
  mostly to find its way, and carried them through every turn after.
- **Ideas, none chosen (the human, 2026-10-29):**
  - `project.map` in `factory.json`: a command or file that gives each project's map of the code (in Dynamo, the header
    of each `dynamo/*.ts`), read first by the Builder. The human is not convinced: left out for now.
  - An explorer per list, before the Builders (Pocock's `implement-spec`, step 2): it reads what the list's tickets need
    and leaves short notes outside the repository that every Builder reads. The first place where a cheaper model would
    fit: it reads a lot, writes little and does not code.
- **When:** if the Builders of the lists made with the new chain (phase 3, §3.3 of `orchestrator-review.md`) still
  read as much; or on the first real project, which has no Dynamo headers to lean on.

## The Builder starts with tools it never uses

- **Origin:** the `init` line of `.claude/worktrees/logs/91/builder-1.jsonl` (2026-10-29): 36 tools (the Claude Docs MCP,
  Workflow, Cron, WebSearch, DesignSync…) and about 70 skills, because `builder.md` had no `tools:` line and `claude -p`
  inherits everything. Matt Pocock trims the same («How To Kill The Bloat In Claude Code's System Prompt», aihero.dev).
- **Done (by hand, the human's choice, 2026-10-29):** `builder.md` has `tools: Read, Edit, Write, Bash, Glob, Grep, Skill,
  StructuredOutput` (what the Builders of 90 91 92 used); the reviewer runs with `--disable-slash-commands`. The Builder
  keeps the skills: #92's used `plugin-authoring`, which its ticket asked for. `--strict-mcp-config` is not needed: a
  `tools:` line already leaves out every MCP tool (probed with #91's fix, `2980b4d`).
- **Probed** with `claude -p --agent <name> --model haiku` and a schema: the Builder starts with 8 tools and 18.0 k tokens
  of context in its first turn (25.7-27.4 k in 90 91 92); the reviewer with 0 skills, no MCP server and 9.8 k (10.2 k).
  Both answered with their schema.
- **Left:** the Builder still sees 41 skills. Pocock's settings (`disableBundledSkills`, `skillOverrides`, through
  `--settings`) could trim them; not tried. To check on the next list: turns and cost against 90 91 92.

## Tools to save tokens that were looked at and left out

- **Origin:** question of the human, 2026-10-29.
- **Caveman** (a skill that makes the answers terse): it compresses prose, and the Builder's output is mostly code in
  Edit and Write; independent measures give 12-23 % of the output. The texts of tickets and verdicts would lose quality.
- **Headroom** (a proxy that compresses tool outputs): 95 % of the Builder's input already arrives cached; the Builder
  needs the code it reads verbatim; and it adds a Python service in front of every run.
- **A Haiku agent for the mechanical steps:** in `dynamo` they are code, at no cost and with real exit codes.
