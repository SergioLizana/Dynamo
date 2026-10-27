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
