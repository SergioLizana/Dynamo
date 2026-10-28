# Dynamo: the agent factory, starting point

Date: 2026-10-26. Origin: conversation about Cadenza, the research into Matt Pocock's approach and another person's
factory scheme. Status: design, kept in line with what is built. The six pieces of §6.2 exist and the factory builds
itself with them (stage 2 in use, §8); the design decisions below are the ones of 2026-10-26.

Reviewed on 2026-10-26 against `agent-factory-research.md` (hereafter "the research"). The idea does not change:
we build the factory ourselves, step by step, on a real project. What is added are rules that the evidence makes
indispensable: an automatic check before the reviewer, a cap of 2 rounds, measuring from the first ticket and short lists.

Change of 2026-10-26: **the factory is built with the factory.** The minimum is written by hand (§8, stage 1) and the
rest the factory builds itself, ticket by ticket. On reaching "complete" (§8.1) it moves to a real project.

## 1. What I want

A piece of software in a **private repository** that is an **agent factory**, for now only with Claude (Claude Code),
with which to build **other** programs in an organized way, without vibecoding directly in the terminal.

- It is not an open source product. It is a personal tool and, at the same time, a way to study AI, agents, SDD
  (specification-driven development) and automation.
- **It is ours.** The skills and the factory's logic are written by us, so that we understand every piece. What we do not
  reinvent is the plumbing that Claude Code already ships (see §6.3).
- **The bottleneck is me.** The factory must work without me having to watch the PC every few hours. I step in at two
  moments: when approving the task list and when reviewing the PRs at the end.
- That everything ends in PRs that I approve afterwards seems fine to me, for now.

## 2. Why not continue with Cadenza

Cadenza was heading in this direction, but it ended up as a mix of ideas: a factory, an open source product and a
custom panel, all at once and without first closing the factory. Concrete signs, measured on 2026-10-25 and 26:

- A plan of 28 tasks to "slim down the orchestrator", and the orchestrator **grew** from 138 to 155 lines while the limit
  of its test rose from 138 to 250.
- Almost all the tasks were Cadenza improving itself: tasks to fix how tasks are created. Cadenza was not used to build
  any other software.
- Each fix asked for another: the working copies brought a Python command and copying the configuration by hand, and that
  asked for another task to remove it.
- The process weighed so much that its own gates were not met (one task was accepted with a criterion not met).
- From an idea to a ready task there were too many steps: document, plan, proposals, questions, the Define gate and the
  loop. It was easy to get lost.
- Unused machinery: 8 roles, profiles, slots, contracts, a 2,183-line harness, the duplicated kit with its
  synchronization, two orchestrators, and an 1,870-line HTML panel whose functions it did not need.

**Decision:** start a new repository. Cadenza is frozen as a reference (not deleted, no further investment) and from it we
bring **texts**, not code. Trimming it would have cost more than writing five new files, and it would have dragged along
names, rules and tests for things that no longer exist.

**The risk of "something of our own":** it is also what made Cadenza grow. What prevents it is rule 2 of §3: each piece is
born because the real project needs it, not because it is a good idea.

## 3. Working rules, so as not to repeat the same thing

1. **The factory is its own first client, until "complete".** Its own pieces are the first tickets. Each stage counts as
   done when it has been used on real tickets, not when it is programmed. On reaching "complete" (§8.1), the client
   becomes a real project, even if things are missing.
2. **Nothing is added without a real problem that asks for it.** If something hurts, note where and how much; only then is
   a piece added.
3. **Reliable first, then parallel.** A piece that fails one time in three, multiplied by six, gives two bad PRs to review
   and returns the bottleneck to me.
4. **Measure from the first ticket.** Turns, rounds and cost per ticket, recorded from stage 2 onwards; without data
   nothing is changed.
5. **No interface of its own.** The task list, the board, the PRs and the dependencies are already provided by GitHub.
6. **The automatic check decides.** A ticket does not reach the reviewer if its tests, build and lint do not pass. Quality
   is decided by the verifier, not by the number of agents (research §7.3, §8.2).

## 4. Matt Pocock's approach

Read in his public skills (`to-tickets`, `implement`, `implement-spec`), the README of Sandcastle and the README of his
skills repository, on 2026-10-25.

**The idea:** few skills in Markdown, no harness, no state machine and no interface.

1. **Grill:** the agent talks the idea through with you, checks facts in the repository instead of asking them, and closes
   the decisions.
2. **To-spec:** writes the specification with fixed sections.
3. **To-tickets:** splits the specification into tickets.
   - Vertical slices: each ticket delivers something that works from end to end.
   - Each one fits in a clean context window and is checked on its own.
   - Each one has "Blocked by". The "frontier" is the tickets whose blockers are already done.
   - **The human approves the whole list once:** size, that each blocker is real and what to merge or split.
4. **Implement:** one ticket per session, with clean context between one and the next. It warns against simulating
   parallelism with several sessions in the same folder.
5. **Implement-spec (the parallel one):**
   - an integration branch;
   - one implementer per ticket on the frontier, each in its own working copy (worktree) and branch, in the background,
     which before finishing brings in the latest of the integration branch;
   - a merger that puts each result into the integration branch;
   - new implementers as soon as a merge changes the frontier;
   - a single review at the end and **one PR** for the human;
   - **no human gates during the run.**

   What it does not say: what to do on a merge conflict or a ticket that fails (research §4.2). That is what this design
   adds.
6. **Sandcastle:** the fully unattended version, with the agents in containers and several branch strategies (`head`,
   `merge-to-head`, `branch`).
7. **Configurable task manager:** its initial setup asks where the tickets live (GitHub, GitLab, local files or other).

What he acknowledges himself: delegating this way increases the human review, and he does not yet know how to keep PRs
small. (Unverified: the research did not find the quote. Do not use it as an argument.)

**What changes most with respect to Cadenza:** there is no approval gate per task. The approved ticket is the contract.
That is what saves turns.

**How it is used here:** his skills are read as **reference** before writing ours; they are not copied or installed as is.

Sources:
- https://github.com/mattpocock/skills
- https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/implement-spec/SKILL.md
- https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/to-tickets/SKILL.md
- https://github.com/mattpocock/sandcastle
- https://www.dandoescode.com/blog/matt-pococks-skills-choosing-the-right-workflow

## 5. Another reference scheme

Another person's factory scheme (screenshot of 2026-10-26):

```text
Input → Spec writer → Builder → [Security | UX | UI | Code] → Approver → Human? → Main or PR → Production
                                (four reviewers in parallel)
```

| Piece | What it does | In this design |
|---|---|---|
| Input + Spec writer | The request becomes a specification | `/discover` + `/to-request` |
| (does not appear) | Splits into tickets that fit in a context | `/to-tasks`: provided by Pocock, missing here |
| Builder | Implements | `/implement` |
| (does not appear) | Automatic check: tests, build, lint | Inside `/implement`, before the reviewer |
| 4 reviewers | Each one looks at one approach | One reviewer at the start; per approach when needed |
| Approver | Gathers the verdicts and decides | Done by `/implement`: if there are failures, it goes back to the Builder |
| Human? → Main / PR | Decides whether a person is needed | At the start, always a PR |
| Production | Deployment | Out of scope at the start |

**The good parts:**
- reviewers by approach, which give finer reviews;
- an approver that gathers the verdicts before bothering the person;
- deciding according to risk whether a person is needed.

**With care:**
- **It does not draw the loop.** If a reviewer fails, something has to go back to the Builder with the findings, with a
  cap on rounds.
- **Four reviewers cost four times as much per round.** In Cadenza, the task that used 3 approaches × 2 rounds was the most
  expensive of all: 60.5 M cache reads.
- **Going to main without a person** is the last thing to be activated: first, the approver has to get many PR tasks
  right, and that has to be measured. No company in the research does it (research §6.3).

## 6. The design

### 6.1 The flow

```text
Idea → /discover → /to-request → /to-tasks (I approve the list, 5-8 tickets)    ← me, once
                         ↓
/run: while tickets remain
        frontier = tickets whose blockers are already merged
        each one (up to N at a time), in its own working copy, goes through the phases of `.claude/factory.json`:
                Build → Verify (tests, build, lint) → pass? no → Build
                                        yes → Review → pass? no → Build
                maximum 2 rounds in total
            pass → Merge: merged into release/x.y.z → tests again on release/x.y.z
            not passing after 2 rounds → "blocked" with its reason; continues with the rest
            those that depend on a blocked one are skipped and go into the report
                         ↓
PR from release/x.y.z against main + report (blocked, skipped, cost)       ← me, at the end
```

- **The integration branch is the `release/x.y.z` in progress** (now `release/0.1.0`). The ticket branches start from it
  and merge into it without asking; there is no intermediate branch per list.
- **Only what I approve reaches `main`.** When each list ends, `/run` opens or updates the `release/x.y.z` PR against
  `main` with that list's report. When to merge it is my decision: after a list or when closing the version.
- **N** is only how many tickets go at the same time. It starts at 2 (research §7.9). The workflow has no cap yet: it
  starts every ticket whose blockers are done (`documentation/backlog.md`).
- **`/implement` and `/run` are two ways to run the same loop,** not one inside the other: `/implement` is the loop for
  one ticket in the current session, and `/run` is the same loop as a workflow, with a script that decides and one agent
  per phase. The Builder's rules are one file, `.claude/agents/builder.md`, which both follow.
- **The round cap is 2**, fixed. Stripe allows at most 2 CI rounds (research §6.2, §8.2).
- **Lists of 5-8 tickets.** So that the final PR can be read. If even that is hard, it moves to one PR per ticket against the
  integration branch (see §10, question 2). Large PRs are reviewed worse and merged less often (research §7.1, §7.2, §8.5).

### 6.2 The pieces

We write all of them ourselves. Before writing each skill, the Pocock ones that do the same thing are read
(`grill-with-docs`, `to-spec`, `to-tickets`, `implement`, `implement-spec`).

| Piece | Type | What it does | What it does not do |
|---|---|---|---|
| `/discover` | skill | Talks the idea through, checks facts in the repository and closes the decisions. At the end it says whether it fits in one ticket or needs a specification | Does not write the specification or create tickets |
| `/to-request` | skill | Writes the specification with the template, in the same session | Decides nothing new |
| `/to-tasks` | skill | Proposes the ticket list (title, blocked by, what it delivers, when it is done), with 5-8 at most; adjusts it with me until I approve it and creates all the tickets | Does not implement or plan in depth |
| `/implement <ticket>` | skill | The unit: branch, tests, implementation, **automatic check** (tests, build, lint; if it fails, neither commit nor reviewer), review, back to the Builder if it fails (max. 2 in total), commit and merge into `release/x.y.z`. The final comment on the ticket has the rounds, the checks and the reviewer's verdict; the cost goes in the report of the list. Moves the board card at each real step (§6.5). The Builder's rules are `.claude/agents/builder.md` | Does not merge into main |
| `/run` | workflow | The assembly line, `.claude/workflows/run.js`: a script reads the tickets and the main folder in GitHub, starts each ticket once its blockers are done, and takes it through the phases of `.claude/factory.json` in its own working copy (Build with the `builder`, Verify with the check, Review with the `reviewer`, Merge into `release/x.y.z`, with the tests run again after the merge); it skips the dependents of a blocked ticket; at the end it updates the `release/x.y.z` PR against `main` with the report, or gives the command to open it, and never pushes | Does not implement; the script decides and its state lives in GitHub, not in the conversation |
| `reviewer` | subagent | Read-only; reviews the change against the ticket's checkboxes and **whether it goes beyond the ticket**; returns PASS or FAIL with evidence | Does not edit files |

Two subagents are not pieces of their own, they are roles of the `/run` workflow: the `builder` (Sonnet; the one
definition of the Builder's rules, which `/implement` also follows) and the `runner` (Haiku; runs a list of commands
literally and returns their output, so the script decides from exit codes and not from an agent's summary).

Why the reviewer checks whether the agent goes beyond the ticket: it is the most common failure of an unattended agent;
Spotify's judge vetoes one session in four for that reason (research §7.4). It goes in the same reviewer, not in a separate
judge.

### 6.3 What is ours and what we use from Claude Code

The logic is ours; the plumbing is Claude Code's. `/run` stays ours even though underneath it uses options that already
exist.

| Ours | What we use underneath (research) |
|---|---|
| Which ticket goes now (frontier), when it is blocked, what is skipped, what goes into the report | Working copies: subagents with `isolation: worktree` or `git worktree add` (§3.2, §3.3) |
| The Builder → check → reviewer loop, with a cap of 2 | `Stop` hook for the check (§3.9) |
| What is recorded per ticket | `claude -p --output-format json` gives `total_cost_usd`; `--max-turns` and `--max-budget-usd` set caps (§3.8) |
| When it is merged and what happens if it clashes | Background sessions (`claude --bg`) that open PRs (§3.4) |
| When a list is launched | The system task scheduler (cron, launchd or Windows' own) launching `claude -p`, or `/loop` in an open session |

Everything runs **locally**, on my PC (§10, question 3). In stage 3a it is tested which of these options works best before
writing `/run`. `implement-spec` is read as a **comparison**, to see what it solves and what it does not, not to replace
ours.

### 6.4 Repository structure

**At the start, the skills live in the `.claude/` of this same repository**, because the factory is its first client. They
are taken out into a plugin when the real project arrives (stage 4), which is the second client. Before that, a separate
plugin would repeat Cadenza's "duplicated kit with synchronization" (§2).

```text
dynamo/
  CLAUDE.md             # what it is, automatic check, main branch, tickets on GitHub; links to documentation/
  .claude/
    skills/
      discover/SKILL.md
      to-request/SKILL.md
      to-tasks/SKILL.md
      implement/SKILL.md
    agents/
      builder.md        # the Builder's rules, one definition for /implement and /run
      reviewer.md
      runner.md         # runs a list of commands literally, for the script of /run
    workflows/
      run.js            # /run: the assembly line (workflow, not a skill)
    templates/
      request.md        # problem, solution, what changes for the user, decisions, how it is tested, out of scope, notes
      ticket.md         # problem, what it delivers, acceptance criteria as checkboxes, blocked by, out of scope
    factory.json        # the project data, the board columns and the phases of /run; the script reads it
    factory.md          # what each value of factory.json means and how to change it
  documentation/
```

`.worktreeinclude` (what is copied to each working copy: `.env`, etc.) is not there yet: no ticket has needed it.

When the real project arrives, `.claude-plugin/plugin.json` is added and the skills move to `skills/`, `agents/` and
`templates/` at the root, so they can be installed there as a plugin.

**The factory's automatic check:** almost everything is Markdown, so there are few tests. The format is checked (front
matter of skills and agents, and `claude plugin validate` once there is a plugin) and the tests of the scripts, if there
turn out to be any. The real test is using each piece; that is why this phase does not get longer.

If there is a plugin, it is installed **at project level**: the plugins in `.claude/settings.local.json` do not reach the
working copies (research §3.3).

### 6.5 Where the tickets live

**GitHub issues** in the factory's private repository, and later in the real project's: list, board (Projects), the "blocked
by" relation and a link to the PRs, with nothing to build. Only GitHub until something else is needed (rule 2).

**Board:** https://github.com/users/SergioLizana/projects/1, with the columns *Todo*, *Build* (the Builder), *Verify*
(the automatic check), *Review* (the `reviewer`), *Needs Human* (stuck ticket) and *Done* (merged into `release/x.y.z`).
The names, the ids of their options and the agent and model of each phase are in `.claude/factory.json`; nothing else
copies them. It **always shows the step the agent is working on**, also when a
ticket goes back from *Review* to *Build* in another round. A stuck ticket ends in *Needs Human*, with a comment that says what failed, at which step it stopped, what
is left (branch or stash) and how to relaunch it. It carries no label: the column is the signal. Taking it out of *Needs
Human* and relaunching it is in `documentation/github-board.md`.

Checked on 2026-10-26 (details and commands in `documentation/github-board.md`, template in `.claude/templates/ticket.md`):
- **Blocked by:** the native GitHub relation (`.../dependencies/blocked_by`). A closed blocker stays listed with
  `state: closed`; the project has no "Blocked by" column.
- **Done in release:** label `in-release` + card in *Done*; the issue stays open until it reaches `main` (the release
  PR carries `Closes #n`; the automatic closing is untested). The `/run` frontier is the open issues without that label
  whose blockers have it or are closed.

## 7. What has to be solved to work without me

- **Permissions.** An unattended run cannot stop to ask whether it may edit a file. It has to be decided what it is allowed
  (list of commands and paths) or isolated in a container, like Sandcastle (see §10, question 4).
- **Not left stuck waiting for me.** The `auto` mode asks again after 3 consecutive blocks or 20 in total, and a background
  session is left at "Needs input" (research §3.4, §3.12). It needs `--permission-prompts none` or a maximum time.
- **Windows.** Claude Code has no sandbox on native Windows, and the "do not ask again" rules are stored in each working copy
  and lost when it is deleted (research §3.3, §8.6). As everything runs locally, it is solved with the permissions of §10,
  question 4; WSL2 is plan B.
- **Usage limits.** Several agents at once use up the usage window much faster, and it has never been measured how much fits.
  `/run` has to be able to stop at the limit and resume without losing anything. In `-p` or background mode, a dynamic
  workflow fails when it reaches the limit instead of waiting (research §3.6).
- **Cost.** A cap per ticket with `--max-budget-usd` (see §10, question 6).
- **The PC on.** Yes, while a list is running. Claude Code's scheduled tasks run in the cloud (research §3.16), so locally the
  system task scheduler is used (cron, launchd or Windows' own).
- **Working copies.**
  - They start from the main branch, not from the integration branch, unless `worktree.baseRef: "head"` is set or they are
    created with `git worktree add` (research §3.3). Otherwise the tickets do not see the work they depend on.
  - A new copy does not bring `.env` or dependencies: `.worktreeinclude` and an installation step are needed, or the tests will
    fail falsely.
  - With `-p` the copies are not deleted by themselves: `/run` cleans them up at the end.
- **`claude -p` and trust.** It runs the project's hooks and MCP servers without asking whether you trust the folder (research
  §3.8). It is only used on our own projects.
- **The bottleneck moves to review.** It is mitigated by lists of 5-8 tickets, the automatic check, the reviewer inside the loop
  and one commit per ticket inside the PR.
- **A bad ticket hidden in the large PR.** The worst failure is a change that passes the tests but does something else
  (research §7.3, §7.4). It is mitigated by the reviewer that checks whether it goes beyond the ticket and by the report per
  ticket.
- **Clashes when merging.** Before merging, each ticket brings in the latest of the integration branch and runs the tests
  again; if it clashes, it is marked blocked and is not resolved blindly. **After each merge, the tests are run again on the
  integration branch:** two tickets can merge without conflict and break something together (research §7.6).
- **The coordinator's context.** `/run` does not read whole diffs or logs: each implementer returns a short summary and the
  state lives in the tickets.
- **Beta pieces.** Agent view, Projects and scheduled tasks are in preview and change almost every week (research §7.12).
  They are tested before relying on them.

## 8. Stages

The minimum is written by hand; the rest is built by the factory itself.

| Stage | What I have at the end | Done when |
|---|---|---|
| 0. Start | Private repository `SergioLizana/Dynamo` cloned in `E:\Proyectos\Dynamo`, short `CLAUDE.md`, branch `release/0.1.0`, GitHub Projects board with the stage 1 tickets | The repository exists, `gh` has a session and the board shows the tickets (done 2026-10-26) |
| 1. By hand | `/to-tasks`, `/implement`, the `reviewer` and the ticket template, written in conversation after reading Pocock's. This plan acts as the specification, so `/discover` and `/to-request` are not needed yet | `/to-tasks` splits this plan into a list of 5-8 tickets on GitHub that I understand without rereading them, and I know how to mark "blocked by" and "done" |
| 2. The unit | `/implement` builds those tickets one at a time: the automatic check, the cap of 2 rounds, `/discover`, `/to-request`, the request template; turns, rounds and cost recorded on each ticket | 3 tickets **in a row** are merged into `release/x.y.z` without my intervention, with their data recorded, and reach `main` in the PR I accept |
| 3a. Simple parallel | `/implement` builds `/run` for N = 2 over tickets **with no dependencies between them**; first, test which local plumbing works best (subagents in a copy, `claude --bg`) and compare with `implement-spec` | Two tickets go at the same time and are merged into `release/x.y.z` without my intervention |
| 3b. Assembly line | `/run` builds what it is missing: frontier, merge into `release/x.y.z`, tests after each merge, skipping the dependents of a blocked ticket and the report | A list of tickets with dependencies ends in a PR without my intervention along the way: **"complete"** |
| 4. Real project | The skills become a plugin and are installed in the real project; the factory is used there | The first real list of the project ends in a PR |
| 5. Improve from data | Reviewers by approach, decision on whether a person is needed, more N… | Each improvement answers a problem measured in the real project |

Measuring is no longer a stage: it starts in stage 2. The integration branch with automatic merging goes in stage 3b because
it is the only thing the research marks as "not tested" (§8.4), and there are few tasks that can really be done in parallel
(§7.6).

### 8.1 What "complete" is and the barriers against growing

**"Complete"** is fixed now and does not move: the 6 pieces of §6.2 work and a list of tickets with dependencies ends in a PR
without my intervention (stage 3b). Not one more piece.

Barriers while the factory builds itself:
- **What occurs to me along the way** goes to a list "after the real project" (`documentation/backlog.md`), not to a ticket.
- **Size limit:** each skill, at most about 150 lines.
- **On reaching "complete", it moves to the real project**, even if things are missing. The improvements of stage 5 come from
  what hurts there, not from the factory itself.
- **Alarm signal:** if a ticket serves to fix how tickets are created and no measured failure asks for it, it is Cadenza's
  path (§2). It stops and is noted.

## 9. What to bring from Cadenza (`E:\Proyectos\cadenza`)

Only as reference text, adapted. For the skills that define tasks, the main reference is Pocock's (§4); Cadenza's texts are
secondary, so as not to drag its ceremony along.

| What | Where it is in Cadenza | What for |
|---|---|---|
| Reviewer prompt | `kit/ai/agents/reviewer.md` | Base of the `reviewer`: reviews against criteria, does not edit, returns PASS/FAIL with evidence |
| Reviewers by approach | `.claude/agents/reviewer-{code,errors,security,tests,ui}.md` | For stage 5 |
| Question format and writing rules | `kit/ai/templates/document-style.md` | Questions with options and one recommended; clear prose |
| Task template | `kit/ai/templates/task.md` | Checkable acceptance criteria |
| Proposals already thought through | `work/proposals/resolved/de-idea-a-tareas.md`, `plan-legible.md` | Loose ideas for `/discover`, `/to-request`, `/to-tasks` and the writing rules |
| Token meter | `mods/sdd-metrics` | Only if `total_cost_usd` from `claude -p` is not enough |
| Working-copy research | `docs/cadenza/research/prueba-copias-de-trabajo.md` | Stage 3a: what works inside a worktree |
| Plan with Pocock's analysis | `docs/cadenza/requests/adelgazar-el-orquestador-tareas.md` (annex 5.9) | Context |

Lessons from the Claude Code runtime that still hold:
- The orchestrator works better as a skill in the main session than as a subagent: that way it can talk with the person, and
  it does not spend nesting levels.
- Claude Code has a tool to move the session into an existing working copy (`EnterWorktree`) and another to launch isolated
  subagents in their own copy and in the background: candidates for `/run`.
- Plugins installed locally (`.claude/settings.local.json`) do not reach a new working copy.
- Note: a subagent cannot write files called `FINDINGS.md` or `ANALYSIS.md` (verified with Claude Code 2.1.296). It only
  matters if the factory uses those names; the design is not built around it.

## 10. Open questions

Only those I have to decide myself, with the recommended option. Already answered: N = 2 to start (research §7.9) and
tickets only in GitHub (rule 2).

1. **Which real project is built on reaching "complete"?** I already have one in mind; it is made concrete in stage 4.
   Recommended: one that can be iterated on step by step, with easy tests and little risk; nothing that handles sensitive
   data at the start (research §8.2).
2. **How do I review what reaches `release/x.y.z`?** Decided: the tickets are merged into `release/x.y.z` without asking, and
   only the PR that I approve reaches `main` (§6.1). It remains to decide whether the report for each list is enough or,
   when review becomes costly, each ticket opens its own PR against `release/x.y.z` (research §8.5).
   Recommended: start with the report, with lists of 5-8 tickets.
3. **Local or cloud execution?** Decided on 2026-10-26: **locally.** It only needs background sessions, launching lists at a
   given hour with the system task scheduler (cron, launchd or Windows') and watching the plan's usage limit. The cloud and
   Projects are not of interest for now.
4. **Which permissions are given to an unattended run?** Recommended locally: `auto` mode with an allow list and
   `--permission-prompts none`. `bypassPermissions` never outside a container (research §3.12, §8.8).
5. **What happens to the tickets that depend on a blocked one?** Recommended: they are skipped, listed in the report, and the
   PR opens only with what is finished.
6. **A cap on cost per ticket and per list?** Recommended: set it with `--max-budget-usd` and adjust it after the first 3
   tickets.
