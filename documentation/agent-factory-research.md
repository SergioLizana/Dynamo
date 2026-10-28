# Agent factories: what is really used (2025-2026)

Date all sources were consulted: **2026-10-26**. Reading document to decide the design of
`agent-factory-plan.md`.

**How to read it:**

- Every fact carries its link. When I could not check something against a primary source, I say so with
  **unverified**.
- I distinguish three kinds of claim: what the official documentation says, what the vendor says without evidence
  (**marketing**) and what the people who use it report (**users**).
- I read the GitHub stars with the GitHub API on 2026-10-26. They measure interest, not quality.
- The tools change every week. Many of the Claude Code pieces I cite were in "research preview" or in beta that day.

---

## 1. Summary in ten lines

1. What works in companies is always the same pattern: **one task, one isolated agent, automatic verification and a
   PR that a person reviews**. Stripe (more than 1,300 merged PRs per week in February 2026), Spotify (more than 1,500
   PRs) and Ramp (30% of their merged PRs in January 2026) use it.
2. In no serious source is anything merged without a person. Everything ends up in a reviewed PR.
3. Quality is decided by the **verifiers** (tests, build, lint and, sometimes, a model that judges the diff), not by
   the number of agents. "The verifier has to be nearly perfect, or Claude will solve the wrong problem" (Carlini,
   Anthropic).
4. Loops have a short cap. Stripe gives each agent **at most two CI rounds** and then hands the work back to the
   person.
5. The bottleneck moves from code to **review**: teams with a lot of AI merge 98% more PRs, but take 91% longer to
   review them and the PRs are 154% bigger (Faros, July 2025).
6. Several agents at once multiply the spend almost proportionally: ten sessions burn through the quota about ten
   times faster, according to the Claude Code documentation.
7. **Claude Code already ships almost all the pieces of a factory**: subagents in their own working copy, background
   sessions, `/batch`, dynamic workflows, `/goal`, cloud sessions that open PRs and fix them on their own, scheduled
   tasks and **Projects**, a coordinator that launches parallel threads in the cloud.
8. What it does not ship out of the box is the **ticket list with "blocked by"** and the **integration branch with a
   merger**. That is exactly what Matt Pocock's skills provide (`/to-tickets` and `/implement-spec`).
9. Community orchestrators are born and die fast (the vibe-kanban company shut down in April 2026, Crystal became
   obsolete in February, GSD is archived). The large swarms (ruflo, Gas Town) are expensive and publish no serious
   measurements.
10. For your case: copy what is missing (tickets with blockers), copy the proven practices of Stripe and Spotify
    (verify before the PR, cap on rounds, check that the change does not stray from the ticket) and **try the native
    Claude Code pieces before writing `/run` by hand**.

---

## 2. What an "agent factory" is

An agent factory is a system that turns requests into reviewable code using AI agents, with as little human
intervention as possible along the way. The person decides what gets done and accepts the result. The agents do the
work in between.

### 2.1 The common scheme

```text
Request → Specification → Task list (with dependencies)               ← the person approves
                                   ↓
                     Dispatch: which tasks are free
                                   ↓
        Agent in its isolated copy → Verifiers → passes? → PR
                  ↑____________ fails (max N rounds) ____|
                                   ↓
                     Human review → Merge                             ← the person accepts
```

### 2.2 Minimal vocabulary

| Term | What it means |
|---|---|
| Agent | A model that plans its steps and uses tools (read, edit, run commands). |
| Subagent | An agent that launches another agent for a specific task, with its own context, and that returns a summary. |
| Headless mode | Running the agent without an interface, from a script (`claude -p "..."`). |
| Working copy (worktree) | Another folder with its own branch of the same git repository. It lets two agents edit at the same time without stepping on each other. |
| Sandbox | An isolated box (container, virtual machine) where the agent can do anything without harming your machine. |
| Frontier | The tasks whose blockers are already resolved, that is, the ones that can be started now. |
| Integration branch | A branch where the results of several tasks are gathered before opening a single PR. |
| Verifier | An automatic checker: tests, compilation, lint, formatting. |
| LLM judge | A model that reads the diff and decides whether it meets the request. |
| Unattended (AFK) | The agent works without anyone watching or approving each step. |

### 2.3 The five patterns seen in practice

| Pattern | Who coordinates | Examples | Where the person is |
|---|---|---|---|
| 1. Session multiplexer | You | claude-squad, Conductor, vibe-kanban, Claude Code's agent view | You launch each session and review each one. **You are still the dispatcher.** |
| 2. One agent in a loop | A simple script | Ralph, `/goal`, Anthropic's harness for long tasks | You write the specification and review at the end. |
| 3. Coordinator and workers over a task list | A coordinator agent | Pocock's `implement-spec`, CCPM, Gas Town, agent teams, Projects | You approve the list and review the result. |
| 4. From issue to PR in the cloud | The product | Copilot coding agent, Codex cloud, Jules, Cursor, Devin, Kiro, claude-code-action | You assign the issue and review the PR. |
| 5. Fixed flow with agent steps | Deterministic code | Stripe's Minions, Spotify's Honk, Claude Code's dynamic workflows | You design the flow once and review the PRs. |

Your design is **pattern 3**, with workers that resemble patterns 4 and 5.

---

## 3. The pieces Claude Code ships

All of this section comes from the official documentation at `code.claude.com`, read on 2026-10-26. The versions
cited are from the v2.1.x series. Several pieces are in preview and may change.

### 3.1 Summary table

| Piece | What it gives a factory | Status | Key limit |
|---|---|---|---|
| [Subagents](https://code.claude.com/docs/en/sub-agents.md) | Workers with their own context, optionally in their working copy | Stable | 20 at a time per session; they nest up to 3 levels |
| [Working copies](https://code.claude.com/docs/en/worktrees.md) | Isolate each agent's edits | Stable | With `-p` they are not cleaned up on their own |
| [Agent view and background sessions](https://code.claude.com/docs/en/agent-view.md) | Launch full sessions that keep going without a terminal and open draft PRs | Preview | Local: they stop if you turn the machine off |
| [`/batch`](https://code.claude.com/docs/en/commands.md) | Split a big change into 5 to 30 independent pieces, each in its own copy | Bundled skill | The pieces must be independent |
| [Dynamic workflows](https://code.claude.com/docs/en/workflows.md) | A JavaScript script that launches and coordinates many subagents | Available on paid plans | No questions to the person mid-run |
| [Agent teams](https://code.claude.com/docs/en/agent-teams.md) | A lead with teammates and a task list with dependencies | Experimental, off by default | Does not isolate in working copies |
| [Headless mode (`claude -p`)](https://code.claude.com/docs/en/headless.md) | Launch Claude from scripts, with JSON output and cost | Stable | What would ask for permission is denied |
| [Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview.md) | The same Claude Code loop as a Python or TypeScript library | Stable | Designed for an API key |
| [Hooks](https://code.claude.com/docs/en/hooks.md) | Deterministic gates: run commands before or after each action | Stable | They run outside the sandbox |
| [`/goal`](https://code.claude.com/docs/en/goal.md) | Keep working until a condition is met | Stable | The judge only reads the conversation |
| [Skills](https://code.claude.com/docs/en/skills.md) and [plugins](https://code.claude.com/docs/en/plugins/overview.md) | Package instructions, agents, hooks and workflows | Stable | Not all of them reach the cloud |
| [Permission modes](https://code.claude.com/docs/en/permission-modes.md) and [sandbox](https://code.claude.com/docs/en/sandboxing.md) | Work without questions without wrecking anything | Stable | The sandbox does not exist on native Windows |
| [GitHub Actions](https://code.claude.com/docs/en/github-actions.md) | Implement issues from GitHub, without your PC | v1 | Spends Actions minutes |
| [Cloud sessions](https://code.claude.com/docs/en/claude-code-on-the-web.md) | Parallel tasks on Anthropic machines that open PRs and fix them | Pro, Max, Team, Enterprise | They share the usage limit |
| [Projects](https://code.claude.com/docs/en/claude-projects.md) | A coordinator that launches cloud threads in parallel and tells you which ones need you | Public beta on Pro and Max | Not in the CLI |
| [Scheduled tasks](https://code.claude.com/docs/en/routines.md) | Launch a cloud session on a schedule, by API or by a GitHub event | Preview | 100 runs per hour per account |
| [`/code-review`](https://code.claude.com/docs/en/commands.md) and [ultrareview](https://code.claude.com/docs/en/ultrareview.md) | Review the diff or a PR; `ultra` does a multi-agent review in the cloud | Bundled skill | `ultra`: 3 free on Pro and Max |

### 3.2 Subagents

A subagent is defined in `.claude/agents/<name>.md`. Its header accepts, among others, these fields
([source](https://code.claude.com/docs/en/sub-agents.md)):

- `isolation: worktree`: the subagent works in a temporary working copy. By default it branches from the repository's
  main branch, **not** from where you are. If it changes nothing, the copy deletes itself.
- `background: true`: it runs in the background. With nothing configured, the subagents the main session launches
  already start in the background.
- `model`, `effort` and `maxTurns`: model, effort and turn cap. On reaching the cap, it returns its work marked as
  partial.

Limits that matter:

- By default, with **20 subagents** running in a session, launching another fails. It is changed with
  `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`.
- A subagent can launch others **up to three levels** below the main conversation.
- If the main session is in `auto`, `acceptEdits` or `bypassPermissions` mode, the subagent uses that same mode and
  **ignores** the `permissionMode` you set.
- Permission questions from background subagents show up in the main session. If nobody answers, they wait.

### 3.3 Working copies (worktrees)

`claude --worktree <name>` creates a copy in `.claude/worktrees/<name>/`, on a branch `worktree-<name>`
([source](https://code.claude.com/docs/en/worktrees.md)). Useful details:

- A copy is a clean folder: it has no `.env` and no installed dependencies. The `.worktreeinclude` file copies files
  ignored by git, such as `.env`.
- `worktree.baseRef` decides where the copy branches from: `"fresh"` (the remote's main branch, the default) or
  `"head"` (your current point). For an integration branch you need `"head"` or to create the copy yourself with
  `git worktree add`.
- **With `-p` there is no automatic cleanup**: the copies stay on disk until you remove them with
  `git worktree remove`.
- Plugins installed at project level are also loaded in the copies (since v2.1.200). This matches what you noted:
  the ones installed in `settings.local.json` do not arrive.
- Claude Code blocks an isolated agent from editing or running git against the main folder.
- **On Windows**, when you approve a command with "don't ask again" inside a copy, the rule stays in that copy and is
  lost when it is deleted. On other systems it is saved in the main folder.

### 3.4 Agent view and background sessions

`claude --bg "task"` or `claude agents` launches full sessions that a supervisor process keeps running, even if you
close the terminal ([source](https://code.claude.com/docs/en/agent-view.md)). What it does for you:

- Before editing, every session launched this way **moves into its own working copy**.
- On finishing with changes, it is told to commit, push and **open a draft PR**. It never pushes to `main` or
  `master`, never force-pushes and never merges.
- `claude agents --json` gives the state of all sessions to a script.
- It warns when a session needs something, finishes or fails.

What it does not solve:

- A session that hits a permission question **stays on "Needs input"** until someone opens it and answers.
- It runs on your machine. It survives suspension, but **stops if you turn the machine off**.
- Ten sessions burn through the quota about ten times faster than one.

### 3.5 `/batch`

It is a bundled skill. It investigates the code, splits the change into **5 to 30 independent units** and shows you
the plan. When you approve it, it launches one background subagent per unit, each in its own working copy. Each
subagent implements, passes the tests and publishes its change ([source](https://code.claude.com/docs/en/commands.md)).

It is almost your `/run`, **but without dependencies**: it is designed for pieces that do not wait for each other.

### 3.6 Dynamic workflows

A workflow is a JavaScript script that Claude writes and that an engine runs in the background
([source](https://code.claude.com/docs/en/workflows.md)). It uses `agent()`, `pipeline()` and `parallel()` to launch
subagents. The difference from a subagent or a skill is **who keeps the plan**: here the script keeps it, not the
conversation, so the coordinator's context does not fill up.

- Up to **16 agents at a time** by default and **1,000 agents** at most per run.
- It warns with "Large workflow" if it goes over 25 agents or 1.5 million expected tokens.
- **It does not allow questions to the person mid-run.** For an approval between stages, you make one workflow per
  stage.
- It can be resumed within the same session. If it hits the usage limit, it waits and continues on its own, but
  **only in interactive subscription sessions**. In `claude -p`, in the SDK or in a background session, the agent
  fails.
- It is saved as a command in `.claude/workflows/` to repeat it.

The Claude Code team says they use them for migrations: one subagent per fix in its working copy, another agent that
reviews it adversarially, and then the merge
([blog, 2 June 2026](https://claude.dev/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code/)). The same
article warns: "most ordinary programming tasks do not need a panel of 5 reviewers".

### 3.7 Agent teams

A lead creates a **shared task list with dependencies**: a blocked task cannot be picked up until its blockers are
completed, and when they complete it unblocks itself ([source](https://code.claude.com/docs/en/agent-teams.md)). It is
the closest thing Claude Code has to your "frontier". But:

- It is **experimental and off by default** (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`).
- It **does not isolate teammates in working copies**: you have to split up files so they do not step on each other.
- They recommend 3 to 5 teammates. It costs about 7 times more tokens than a normal session when the teammates are in
  plan mode ([source](https://code.claude.com/docs/en/costs.md)).
- Declared limitations: they are not resumed after `/resume`, task state sometimes lags behind and blocks the
  dependent ones, and the lead may consider the work finished too early.
- It does not work with `claude -p`.

### 3.8 Headless mode (`claude -p`) and Agent SDK

`claude -p "task"` runs Claude without an interface ([source](https://code.claude.com/docs/en/headless.md)). Options
that matter for a factory:

- `--permission-mode auto`: a classifier approves or blocks each action in your place.
- `--permission-prompts none` (since v2.1.259): what would ask for permission is denied and Claude is told not to
  retry it. This way nothing is left waiting.
- `--output-format json`: returns the result, the session identifier and `total_cost_usd`, the estimated cost.
- `--max-turns` and `--max-budget-usd`: caps on turns and money.
- `--json-schema`: forces a JSON with a specific shape to be returned. Useful for the reviewer to say PASS or FAIL.
- `--resume <id>`: continues a specific session.
- `--bare` starts faster and without loading hooks, skills or `CLAUDE.md`, but **does not use your subscription**: it
  asks for an API key.
- Careful: without `--bare`, `-p` runs the project's hooks and MCP servers **without asking** if you trust the
  folder.

The [Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview.md) gives the same loop as a Python and
TypeScript library, with hooks, subagents, permissions, sessions and cost. The documentation asks for an API key and
says that third parties cannot offer claude.ai login in their products. For a personal factory, `claude -p` is enough
and simpler.

### 3.9 Hooks

Hooks run your commands at fixed moments ([source](https://code.claude.com/docs/en/hooks.md)). They are the
**deterministic gates** of a factory:

- `Stop`: when Claude finishes a turn. Spotify uses it to pass all the verifiers **before opening the PR**; if any
  fails, there is no PR ([Spotify, part 3](https://engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3)).
- `PreToolUse` and `PermissionRequest`: approve or deny actions without asking anyone.
- `TaskCompleted` and `TeammateIdle`: quality gates in agent teams.
- `WorktreeCreate` and `WorktreeRemove`: create the copies your own way.
- `Notification`: alerts when a background session needs you or finishes.

### 3.10 `/goal`

It sets an end condition and Claude keeps working until it is met ([source](https://code.claude.com/docs/en/goal.md)).
After each turn, a small model decides whether it is met, impossible or still missing. It works with `-p`.

Important detail: that judge **runs nothing**, it only reads what Claude has shown in the conversation. The condition
has to be provable from Claude's output, for example "`npm test` exits with code 0". To bound it, add "or stop after
20 turns" to the condition.

### 3.11 Skills and plugins

A skill is a `SKILL.md` that loads only when needed. A plugin packages skills, agents, hooks, MCP servers and
workflows ([source](https://code.claude.com/docs/en/plugins/overview.md)).

Beware of the cloud: **Projects** threads do not load the skills that are in the repository's `.claude/skills/`, nor
the plugins declared in its `.claude/settings.json`. You have to enable them in the claude.ai account or add the
plugins in the project settings ([source](https://code.claude.com/docs/en/claude-projects.md)).

### 3.12 Permissions and isolation

| Mode | What it does without asking | What it is for |
|---|---|---|
| `default` | Only read | Reviewing everything yourself |
| `acceptEdits` | Read, edit and common file commands | Iterating with supervision |
| `plan` | Read | Exploring without changing anything |
| `auto` | Everything, with a classifier that checks each action | Long tasks |
| `dontAsk` | Only what is allowed beforehand; the rest is denied | CI and closed scripts |
| `bypassPermissions` | Everything | **Only** containers or virtual machines without internet |

Source: [permission modes](https://code.claude.com/docs/en/permission-modes.md). About `auto` mode:

- It blocks by default, among other things, `curl | bash`, force-push, `git reset --hard`, production deployments and
  **merging a PR that no person has approved**.
- After **3 blocks in a row or 20 in total**, it stops deciding and goes back to asking. In an unattended session
  that means waiting forever.
- The documentation says it plainly: "it reduces permission questions, but does not guarantee safety".

About the [sandbox](https://code.claude.com/docs/en/sandboxing.md):

- It confines shell commands: writing only in the working folder and going out to the network only toward allowed
  domains.
- It works on macOS, Linux and WSL2. **On native Windows it does not exist**: commands run without a sandbox. If it
  cannot start, by default it silently carries on without a sandbox, unless you set `failIfUnavailable: true`.

### 3.13 GitHub Actions (`claude-code-action`)

The action [`anthropics/claude-code-action@v1`](https://github.com/anthropics/claude-code-action) (9.6k stars) runs
Claude Code on GitHub's runners ([source](https://code.claude.com/docs/en/github-actions.md)):

- **Interactive mode**: someone writes `@claude` in an issue or PR and Claude answers, implements and pushes commits.
- **Automatic mode**: with a `prompt`, it runs on any GitHub event, including a schedule. The prompt can be a skill
  (`/name`) or a plugin's skill.
- Authentication with an API key or with `CLAUDE_CODE_OAUTH_TOKEN`, a token from your subscription generated with
  `claude setup-token`.
- Spend is controlled with `--max-turns`, job timeouts and GitHub's concurrency.
- Practical detail: commits made with the default `GITHUB_TOKEN` **do not trigger other workflows**, so CI would not
  run on them. You have to use the Claude app or your own token.

It is a way to run "implement this ticket" without your PC turned on. It spends GitHub Actions minutes on top of
tokens.

### 3.14 Cloud sessions

A cloud session is Claude Code running on an Anthropic virtual machine
([source](https://code.claude.com/docs/en/claude-code-on-the-web.md)):

- `claude --cloud "task"` creates a session that clones your GitHub remote on your current branch. You have to push
  first.
- Each `--cloud` is an independent session: several can be launched in parallel.
- They work on `claude/...` branches and can create the PR.
- **Auto-fix**: Claude watches the PR, and when CI fails or someone comments, it investigates and pushes the fix if it
  is clear. It does not react to merge conflicts, because GitHub does not notify about them.
- GitHub credentials do not enter the machine: a proxy adds them from outside.
- They share the usage limit with everything else on your account, with no separate charge for the machine.
- `claude --teleport` brings a cloud session into your terminal.

### 3.15 Projects

**This is the piece that most resembles what you want.** A project is a long conversation where Claude acts as
coordinator and launches one **thread** (a cloud session) per task ([source](https://code.claude.com/docs/en/claude-projects.md)):

- The threads run in parallel, in the cloud, and **keep going even if you close the laptop**.
- Each thread works on its branch and opens a PR; afterwards it watches it with auto-fix.
- The **Overview** panel groups the threads by state: ready to review, "Waiting on you", working, and "Landing" for
  approved PRs or ones in the merge queue.
- The project's instructions and memory reach all the threads.
- The threads run in `auto` mode. The repository's permission rules are **not** applied.
- If a thread hits the usage limit, it waits and continues on its own when the limit renews.
- The coordinator sees what the threads report to it, not every step they take.

Limits and warnings:

- Public beta on **Pro and Max**, rolling out gradually. It is not on Team or Enterprise, nor in the CLI. You have to
  check whether it shows up in the claude.ai/code sidebar.
- By default, each thread uses **Opus with high effort**, which spends the most.
- There is no fixed number of threads: Claude launches as many as it thinks necessary. "At most two threads at a
  time" is a preference it keeps in memory, **not a hard cap**. The real cap is 200 new threads per day.
- The documentation recommends starting by asking it to propose the threads and wait for your go-ahead, and removing
  that brake when you see they come back well.
- **I did not find in the documentation** a dependency graph between tasks or an integration branch. It can be asked
  for through instructions, but I do not know whether it respects them (unverified).

### 3.16 Scheduled tasks in the cloud

They used to be called "routines". They are a saved configuration (prompt, repositories and connectors) that runs on
its own in the cloud ([source](https://code.claude.com/docs/en/routines.md)):

- Three triggers: **schedule**, **API call** and **GitHub events** (PRs, releases and issues: opened, labeled,
  assigned...).
- They run in `auto` mode, on `claude/...` branches, and appear as you on GitHub.
- Limits: 100 scheduled runs per hour per account, and 30 manual or API launches per hour per task.
- They are in preview and spend your subscription.

---

## 4. Community factories and orchestrators

### 4.1 Comparison table

Stars and date of the last push read with the GitHub API on 2026-10-26.

| Tool | Idea in one line | How tasks are defined | Parallelism | Where the person steps in | Maturity |
|---|---|---|---|---|---|
| [Pocock's skills](https://github.com/mattpocock/skills) | A few Markdown skills: interview, specification, tickets, implementation | Issues with "Blocked by" in GitHub, GitLab or files | `/implement-spec`: one subagent per free ticket, each in its own copy | Approves the ticket list and the final PR | 303k ★, active |
| [Sandcastle](https://github.com/mattpocock/sandcastle) | TypeScript library to launch agents in sandboxes | A prompt; templates that read issues from GitHub or Beads | One sandbox (Docker, Podman, Vercel) per run | Writes the prompt and reviews branches | 8.6k ★, active |
| [Superpowers](https://github.com/obra/superpowers) | Methodology in skills: design, plan, subagents, TDD and review | Task plan of 2 to 5 minutes | A fresh subagent per task, with review after each | Approves the design and chooses how to close the branch | 305k ★, active |
| [CCPM](https://github.com/automazeio/ccpm) | Project management with GitHub issues and working copies | PRD, epic and tasks with `depends_on` | Several agents per issue, in the same epic copy | Approves each phase and the merge | 8.4k ★, active |
| [Gas Town](https://github.com/gastownhall/gastown) | A "mayor" coordinates workers and a merge queue | "Beads": issues stored in git | Many workers; claims to scale to 20 or 30 agents | Talks to the mayor and handles escalations | 18.5k ★, active |
| [ruflo (formerly claude-flow)](https://github.com/ruvnet/ruflo) | Agent swarms on top of Claude Code via MCP and hooks | Prompts, workflows, "missions" | Swarm "topologies" (marketing) | Little documented | 79.3k ★, active |
| [BMAD](https://github.com/bmad-code-org/BMAD-METHOD) | Agile method with agent roles | Briefs, specifications and architecture | Does not describe it | Reviews each step | 54.6k ★; v6.12 stable, v7 in alpha |
| [SuperClaude](https://github.com/SuperClaude-Org/SuperClaude_Framework) | Configuration: 30 commands, 20 personas, 7 modes | Commands with a topic | `/spawn` with no detail | At every command | 23.9k ★, v4.3.0 |
| [Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin) | Loop of plan, work, review and "what was learned" | Plan from an interview | Multi-agent review | Initial interview and merge | 25.7k ★, active |
| [claude-squad](https://github.com/smtg-ai/claude-squad) | Terminal interface for several sessions | One prompt per session | tmux and one working copy per session | Launches, reviews and pushes each one | 8.7k ★; last push 2026-08-20 |
| [Conductor](https://www.conductor.build/docs/) | Mac app for parallel agents | One task per workspace | One copy and branch per task | Reviews the diff, opens the PR and merges | Closed source; macOS only |
| [Crystal → Nimbalyst](https://github.com/stravu/crystal) | Parallel sessions in working copies | One prompt per session | One copy per session | Reviews and compares | **Obsolete since February 2026** |
| [vibe-kanban](https://github.com/BloopAI/vibe-kanban) | Kanban board that launches agents | Board cards | One workspace with a branch per task | Plans, reviews and merges | 28.5k ★; **the company shut down on 10 April 2026** |
| [get-shit-done (GSD)](https://github.com/gsd-build/get-shit-done) | Meta-prompts and specification-driven development | Specifications | Unverified | Unverified | 64k ★; **archived** |
| [Ralph](https://ghuntley.com/ralph/) | A bash loop that repeats the same prompt | `specs/` and a `fix_plan.md` | Just one, with subagents inside | Writes the specifications and keeps watch | A technique, not a tool |
| [claude_code_agent_farm](https://github.com/Dicklesworthstone/claude_code_agent_farm) | More than 20 agents with lock files | Sweeps of fixes | Many at once | Launches and reviews | 922 ★ |

### 4.2 Short profiles

**Matt Pocock's skills.** The repository now has many more skills than the ones you read: `grill-with-docs`,
`to-spec`, `to-tickets`, `implement`, `implement-spec`, `code-review`, `pr`, `retro`, `wayfinder` and others
([README](https://github.com/mattpocock/skills)). `/setup-matt-pocock-skills` asks where the tickets live (GitHub,
GitLab, local files or other) and which labels to use. `implement-spec` treats the tickets as a **graph** with a
frontier, creates an integration branch, launches implementers in the background in their copy (each one passes `tdd`
and pulls the latest from the integration branch before finishing), uses a merger subagent, does a final review and
cleans up the copies ([SKILL.md](https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/implement-spec/SKILL.md)).
**It does not describe what to do about a merge conflict or a failing ticket.** I found no public metrics on its use.

**Sandcastle.** TypeScript library (`@ai-hero/sandcastle`) to run agents in Docker, Podman or Vercel sandboxes
([README](https://github.com/mattpocock/sandcastle)). It supports Claude Code, Codex, Cursor, OpenCode, Copilot and
Pi. Three branch strategies: `head` (writes in your folder), `merge-to-head` (a temporary branch that is merged and
deleted) and `branch` (commits on a named branch). Everything is local; the README does not describe how to open PRs.
It warns that launching copies in parallel with `head` or `merge-to-head` is not safe: each one needs its own branch.

**Superpowers.** By Jesse Vincent. Flow: interview, design approved in parts, working copy, plan of very small tasks,
one subagent per task with review after each, strict TDD and closing the branch
([README](https://github.com/obra/superpowers)). It says it is common for the agent to work "a couple of hours"
without drifting; that is the author's claim, with no measurements.

**CCPM.** PRD, epic and up to 10 tasks per epic with `depends_on`, `parallel` and `conflicts_with`, synchronized as
GitHub issues and sub-issues, and a working copy **per epic** ([README](https://github.com/automazeio/ccpm)). Its
figures ("89% less lost time", "75% fewer bugs") are **marketing**: it gives no method. Its own test compares three
scenarios chosen by the authors.

**Gas Town.** By Steve Yegge. A "Mayor" coordinates; the "polecats" are workers; the "Witness" detects stuck agents;
the "Refinery" is a merge queue that batches changes, runs checks and, if a batch fails, splits it to find the culprit
([README](https://github.com/gastownhall/gastown)). State lives in git, so an agent can restart without losing
anything. It claims to scale "comfortably to 20 or 30 agents". According to secondary sources, Yegge himself warns
that it is in alpha and should not be used seriously, and it is expensive: more than one Max subscription is needed
([heise](https://heise.de/-11178824), [Maggie Appleton](https://maggieappleton.com/gastown)). I did not read those
warnings in the original text: unverified.

**ruflo (formerly claude-flow).** An MCP server with about 314 tools, hooks and "swarms" with topologies and
consensus ([README](https://github.com/ruvnet/ruflo)). The agent counts do not match each other (100 and 98), and the
89% routing accuracy has no method. I treat it as **marketing** until I see independent measurements.

**BMAD.** Agile method with product experience, architecture, UX, development and testing
([README](https://github.com/bmad-code-org/BMAD-METHOD)). It adjusts the ceremony to the size of the change. A "BMad
Loop" module claims to build, verify and run a retrospective on a whole epic unsupervised; I did not try it nor find
measurements.

**SuperClaude.** A configuration layer with commands, personas and modes
([README](https://github.com/SuperClaude-Org/SuperClaude_Framework)). Its performance figures ("2-3 times faster,
30-50% fewer tokens") come with no method. It is not a factory: it does not run tasks in parallel in any documented
way.

**Compound Engineering.** Plugin by Every: interview, plan, work, simplification, review and a step that saves what
was learned in `docs/solutions/` ([README](https://github.com/EveryInc/compound-engineering-plugin)). `/lfg` runs the
whole loop alone: it opens the PR and watches CI with a bounded budget of fixes. It **does not merge** unless you
allow it.

**claude-squad, Conductor, Crystal and vibe-kanban.** They are multiplexers: they help you launch and watch several
sessions, each in its working copy, but **you still launch and review each one**. claude-squad needs tmux
([README](https://github.com/smtg-ai/claude-squad)). Conductor is from Melty Labs and, according to its
documentation, only works on macOS ([secondary source](https://www.conductor.build/docs/installation)). Crystal has
been obsolete since February 2026 ([README](https://github.com/stravu/crystal)). The vibe-kanban company shut down on
10 April 2026 because almost all its users were on the free tier; the project continues as local open source
([announcement](https://vibekanban.com/shutdown)). Besides, Claude Code's agent view already does the essentials of
all of them.

**Ralph.** Technique by Geoffrey Huntley, from July 2025: `while :; do cat PROMPT.md | claude-code ; done`
([post](https://ghuntley.com/ralph/)). One task per round, a plan the agent rewrites and tests as "backpressure". The
author himself warns that you will wake up to broken code, that the model tends to leave implementations half-done
and to repeat work already done, and that he would not use it on existing code. Thoughtworks put it on "Assess" in
April 2026 and points out its high token cost ([Radar](https://www.thoughtworks.com/en-de/radar/techniques/ralph-loop)).

---

## 5. Specification-driven development (SDD)

### 5.1 How each tool goes from idea to tasks

| Tool | From idea to tasks | How the tasks are run | What users say |
|---|---|---|---|
| [GitHub Spec Kit](https://github.com/github/spec-kit) (142.9k ★) | `constitution` (principles), `specify`, `clarify`, `plan`, `tasks`, `analyze` | `implement` and `converge`, repeated until it says "Converged"; it recommends reviewing each step | Too many repetitive Markdown files; excessive for a medium-sized change |
| [Kiro](https://kiro.dev/docs/specs/) (AWS) | `requirements.md`, `design.md` and `tasks.md` | "Run all tasks" builds a dependency graph and runs in **waves**: the independent tasks of a wave go at the same time | For a small bug it generated 4 stories with 16 criteria |
| [Kiro autonomous agent](https://kiro.dev/blog/introducing-kiro-autonomous-agent/) | One task per chat or a `kiro` label on a GitHub issue | One sandbox per task, **up to 10 at a time**, opens a PR and learns from review comments | Preview since December 2025; no usage data |
| [BMAD](https://github.com/bmad-code-org/BMAD-METHOD) | Briefs, specification and architecture, depending on size | Guided flows; a module for unattended epics | No data |
| [Pocock](https://github.com/mattpocock/skills) | Interview, `to-spec` and `to-tickets` (vertical slices with "Blocked by") | `implement` or `implement-spec` | No public data |
| [CCPM](https://github.com/automazeio/ccpm) | PRD, epic and tasks with dependencies | GitHub issues and agents per issue | No independent data |
| [Agent OS](https://github.com/buildermethods/agent-os) (5.5k ★) | Code standards and specifications | Done by whichever agent you use | No data |
| [Anthropic's planner](https://www.anthropic.com/engineering/harness-design-long-running-apps) | An agent turns a prompt of 1 to 4 sentences into a product specification | One generator per "sprint" and an evaluator | Internal experiment |

### 5.2 The most useful critique

Birgitta Böckeler, of Thoughtworks, tried Kiro, Spec Kit and Tessl in October 2025
([martinfowler.com](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)). Her conclusions:

- She distinguishes three levels: **spec-first** (the specification serves the task and can then be thrown away),
  **spec-anchored** (it is kept alongside the feature) and **spec-as-source** (only the specification is edited). The
  useful one today is the first.
- The flows do not adapt to the size of the problem. Reviewing a lot of Markdown can be harder than reviewing code.
- Agents do not follow all the instructions: having a specification gives a **false sense of control**. Spec Kit
  generated duplicate classes for her even though its notes said they already existed.
- She warns of the risk that these tools worsen exactly what they set out to improve: more review and more
  hallucinations.

**What is useful to you:** Kiro's "waves" are your "frontier". And the lesson on size confirms your `/discover`, which
decides whether something fits in a ticket or needs a specification.

---

## 6. What companies use

### 6.1 Commercial "issue to PR" products

| Product | How it receives tasks | Where it runs | In parallel | Review and merge | Known limits |
|---|---|---|---|---|---|
| [Copilot coding agent](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent) | Agents panel, conversation, issue or PR | Ephemeral cloud environment | One task per session | Branch and PR; you review it | One repository, one branch and **one PR per task**; maximum **59 minutes** per session |
| [Claude and Codex on GitHub (Agent HQ)](https://github.blog/changelog/2026-02-04-claude-and-codex-are-now-available-in-public-preview-on-github/) | Assign the issue to Claude, Codex, Copilot or all three | GitHub infrastructure; the Claude agent uses the Agent SDK | Several agents on the same issue | PR | Preview since 2026-02-04; Copilot Pro+ or Enterprise; 1 premium request per session |
| [Codex cloud](https://learn.chatgpt.com/docs/cloud) | ChatGPT (web, mobile, desktop) or terminal | Its own space per task | Yes | Commit or PR when you decide | I did not read the limits per plan |
| [Cursor Cloud Agents](https://cursor.com/docs/cloud-agent) | Desktop, web, Slack, Linear or `@cursor` on GitHub | One virtual machine per agent | "As many as you want" (said by Cursor) | PR with screenshots and videos | Not on the Free and Plus plans; asks for a spending limit |
| [Devin](https://docs.devin.ai/) | Slack, Teams, Linear, Jira, web or API | Its cloud | Yes, according to the documentation | Draft PR | The page I read does not detail prices or batches: unverified |
| [Factory (Droids)](https://docs.factory.com/) | App, CLI and web | Its cloud or local | "Missions" | Reviews the diff and merges | The page does not explain how they work: unverified |
| [Google Jules](https://jules.google/docs) | Repository, branch and prompt; **proposes a plan that you approve** | Virtual machine | 3, 15 or 60 tasks at a time depending on the plan | You decide | [15, 100 or 300 tasks per day](https://jules.google/docs/usage-limits) |
| [Kiro autonomous agent](https://kiro.dev/blog/introducing-kiro-autonomous-agent/) | `kiro` label or `/kiro` on an issue | Sandbox per task | Up to 10 | Explained PR | Preview with weekly limits |

What they have in common: **one PR per task**, the person reviews and nobody merges alone. Jules is the only one that
adds an approval of the plan before touching code.

### 6.2 Internal cases with a source

| Company | Agent | How a task starts | Isolation | Verification | Review | Figures |
|---|---|---|---|---|---|---|
| Stripe | [Minions](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents) (fork of Block's goose agent) | Label in a Slack thread, buttons in internal tools (for example, "fix this flaky test") | "Devboxes" pre-warmed in ~10 s, with no production or internet; **no working copies**, which did not work at their scale | Local lint in under 5 s; selective CI over more than 3 million tests; **maximum 2 CI rounds** | A person reviews everything; the agents write all the code | More than 1,000 PRs per week (9 Feb 2026); [more than 1,300](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2) (19 Feb 2026) |
| Spotify | [Honk](https://engineering.atspotify.com/2025/11/spotifys-background-coding-agent-part-1), on top of their Fleet Management system; according to secondary sources, they ended up using Claude Code ([InfoQ](https://infoq.com/news/2026/03/spotify-honk-rewrite)) | One prompt per migration; ad-hoc requests through Slack or GitHub | Container with few permissions | Verifiers that activate on their own (for example, Maven if there is a `pom.xml`) and an **LLM judge**; a `Stop` hook prevents opening the PR if anything fails | Human review | More than 1,500 merged PRs (6 Nov 2025); 60-90% time saved on migrations, according to the teams |
| Ramp | Inspect ([InfoQ](https://infoq.com/news/2026/01/ramp-coding-agent-platform/), which links [Ramp's post](https://builders.ramp.com/post/why-we-built-our-background-agent)) | Slack bot, web and Chrome extension | Virtual machines on Modal | The agent uses the same tools as an engineer: tests, databases, Sentry, Datadog | People, who can watch and guide live | ~30% of merged PRs (January 2026) |
| Anthropic | [C compiler](https://www.anthropic.com/engineering/building-c-compiler) (Carlini) | A bash loop restarts each session; the agents pick the "most obvious" next task | One Docker container per agent; task locking with files in git | Compiler test suites and GCC as an "oracle" | Research, no PR | 16 agents, ~2,000 sessions, ~$20,000 and 100,000 lines in two weeks |

More internal Anthropic data:

- **Long tasks** ([Nov 2025](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)):
  an initial agent prepares the environment, a progress file and a list of more than 200 features in JSON, all marked
  as failing. After that, each session does **a single feature**, tests it like a user and leaves the code ready to
  merge. They chose JSON because the model rewrites a JSON less than a Markdown file.
- **Planner, generator and evaluator**
  ([Mar 2026](https://www.anthropic.com/engineering/harness-design-long-running-apps)): the same game built by a
  single agent cost $9 in 20 minutes and came out broken; with the full harness, $200 in 6 hours, and it worked.
  Lesson: a separate evaluator is much easier to make demanding than an agent that judges itself. And every piece of
  the harness is an assumption about what the model cannot do: they must be reviewed with each new model and the
  superfluous ones removed.

Data I only found in secondary sources (**unverified**):

- Stripe: about 7,000 Minions PRs in one week of August 2026, according to Port's index cited by a podcast
  ([Port](https://software-factories.port.io/stripe)).
- Ramp: up to 75% of PRs, according to a podcast cited by third parties
  ([fourweekmba](https://fourweekmba.com/ai-ramp-inspect-agent-coding-verification-bottleneck/)).
- Coinbase: an internal agent that produces 5% of merged PRs
  ([third-party summary](https://rywalker.com/research/coinbase-forge)).
- Boris Cherny, creator of Claude Code: 5 sessions in the terminal and 5 to 10 on the web at the same time,
  according to summaries of a thread of his ([Slashdot](https://developers.slashdot.org/story/26/01/06/2239243/creator-of-claude-code-reveals-his-workflow)).

### 6.3 What all the companies repeat

1. **The agent does one thing only: change the code.** The push, the PR and Slack are done by the infrastructure
   around it (Spotify).
2. **Isolation makes it possible to grant all permissions.** Since a mistake stays inside the devbox, the agent runs
   without questions (Stripe).
3. **Fixed steps mixed with agent steps.** Lint and push are code; "implement" and "fix the CI" are agent. Stripe
   calls them "blueprints".
4. **Fast feedback before slow CI.** Local lint in seconds before pushing anything.
5. **Cap on rounds.** After two CI rounds, the work goes back to the person.
6. **Infrastructure for people, reused.** The same machines, the same CI and the same rules the engineers use. "What
   is good for people is good for agents" (Stripe).
7. **Always human review of the PR.**

---

## 7. Lessons and common failures

### 7.1 Review becomes the bottleneck

- Simon Willison, October 2025: "I can only focus on reviewing and merging one significant change at a time". That is
  why he only launches in parallel tasks that cost him little to review: research, small maintenance or work he
  himself specified in detail. "Code that comes from your own specification costs much less to review"
  ([blog](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/)).
- Faros, over more than 10,000 developers (July 2025): in teams with a lot of AI, 21% more tasks, 98% more merged
  PRs, **91% more review time**, **PRs 154% bigger** and 9% more bugs per developer. They found no improvement at
  company level ([report](https://www.faros.ai/blog/ai-software-engineering)). Faros sells analytics and the study is
  correlational.
- Maggie Appleton, on Gas Town: the limit becomes deciding what to build and how, and moving so fast that you never
  stop to think ([note](https://maggieappleton.com/gastown)).

### 7.2 PR size matters

- Studies over hundreds of thousands of PRs made by agents (the AIDev dataset): bigger changes and force-pushes are
  associated with fewer merges ([arXiv 2602.19441](https://arxiv.org/html/2602.19441v1)); documentation, CI and build
  PRs are accepted more, and performance and bug-fix ones less
  ([arXiv 2601.15195](https://arxiv.org/html/2601.15195v1)); 67.9% of rejected PRs have no reviewer comment: they are
  simply abandoned ([arXiv 2602.04226](https://arxiv.org/abs/2602.04226)).
- Your document says Pocock admits he still does not know how to keep PRs small. I did not find that sentence in a
  source I could read: unverified by me.

### 7.3 Without a good verifier, the agent solves the wrong problem

- Carlini: "the verifier has to be nearly perfect, or Claude will solve the wrong problem". And: "it is easy to see
  green tests and assume the work is done, when it rarely is"
  ([post](https://www.anthropic.com/engineering/building-c-compiler)).
- He designed the tests **for a model**: short output, errors in files with the word `ERROR` so they can be searched
  for, and a `--fast` option that runs a random sample, because the agent has no good sense of time.
- Spotify hides the build noise from the agent: its verifiers return only the summarized error message
  ([part 3](https://engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3)).
- Anthropic: agents perform much better when they test like a user, with a browser, than with unit tests alone
  ([post](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)).

### 7.4 Typical failures of an unattended agent

| Failure | Who reports it |
|---|---|
| Strays from what was asked: over-refactors or disables flaky tests. It is what their judge vetoes most | [Spotify](https://engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3) |
| Leaves half-done or placeholder implementations | [Huntley](https://ghuntley.com/ralph/), [Anthropic](https://www.anthropic.com/engineering/harness-design-long-running-apps) |
| Considers the work finished on seeing partial progress | [Anthropic](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) |
| Marks features as done without testing them end to end | Anthropic (same source) |
| Judges itself too leniently | [Anthropic](https://www.anthropic.com/engineering/harness-design-long-running-apps) |
| Searches badly and concludes something does not exist, and implements it twice | [Huntley](https://ghuntley.com/ralph/) |
| Kills itself with a command (`pkill -9 bash`) | [Carlini](https://www.anthropic.com/engineering/building-c-compiler) |
| Stays stuck waiting for a permission | [Agent view documentation](https://code.claude.com/docs/en/agent-view.md) |

Spotify orders the consequences from least to most serious: (1) no PR comes out, (2) the PR fails CI and (3) **the PR
passes CI but does something incorrect**, the worst because it destroys trust. Its LLM judge vetoes **one in four**
sessions, and in half the cases the agent manages to correct itself. They do not yet have evaluations of the judge
itself.

### 7.5 Cost and usage limits

| Fact | Source |
|---|---|
| An agent spends ~4 times more tokens than a chat; a multi-agent system, ~15 times | [Anthropic, June 2025](https://www.anthropic.com/engineering/multi-agent-research-system) |
| Agent teams: ~7 times more tokens than a normal session with teammates in plan mode | [Costs documentation](https://code.claude.com/docs/en/costs.md) |
| Ten background sessions burn through the quota ~10 times faster | [Agent view](https://code.claude.com/docs/en/agent-view.md) |
| Average in companies: ~$13 per developer per active day; 90% spend less than $30 | [Costs documentation](https://code.claude.com/docs/en/costs.md) |
| Anthropic's full harness cost more than 20 times what a single agent did | [Anthropic](https://www.anthropic.com/engineering/harness-design-long-running-apps) |
| Gas Town: thousands of dollars a month, according to those who tried it | [Maggie Appleton](https://maggieappleton.com/gastown), [heise](https://heise.de/-11178824) |
| Projects uses your limits faster than a session; on Pro, "expect to reach the limit sooner" | [Projects](https://code.claude.com/docs/en/claude-projects.md) |

A good detail: in Projects, resuming a thread that has been idle for more than an hour re-reads its whole
conversation, because the cache has expired. Sometimes it is cheaper to open a new thread.

### 7.6 Parallel brings collisions

- Cognition (the Devin people), June 2025: "don't build multi-agents". Every action carries implicit decisions, and
  two agents with different decisions produce pieces that do not fit together
  ([post](https://cognition.com/blog/dont-build-multi-agents)).
- Anthropic: programming has fewer truly parallelizable tasks than research
  ([post](https://www.anthropic.com/engineering/multi-agent-research-system)).
- Carlini: merge conflicts were frequent and Claude resolved them, but with the Linux kernel **all 16 agents hit the
  same bug**, fixed it and stepped on each other. He solved it by splitting the problem with an oracle.
- Agent teams does not isolate in working copies; the documentation asks you to split the files by hand.
- Claude's auto-fix does not react to conflicts with the base branch, because GitHub does not notify about it.

### 7.7 Permissions and sandbox

- Stripe grants all permissions **because** the devbox is isolated from production and from the internet.
- Willison only uses the no-questions mode locally when he knows malicious content cannot get in; for anything risky
  he prefers the cloud.
- In Claude Code, `bypassPermissions` only in containers or virtual machines without internet; `auto` reduces
  questions but does not guarantee safety; and the sandbox **does not exist on native Windows**.

### 7.8 The coordinator's context

All the serious solutions take state out of the coordinator's conversation:

- Dynamic workflows keep the plan and the results in script variables, not in Claude's context.
- `implement-spec` asks for "sparse" communication with the subagents, using pointers to the specification and the
  tickets instead of copying content.
- The Projects coordinator only sees what the threads report to it.
- Gas Town, Ralph and Anthropic's harness keep state in git and in files.

Your design already goes this way: `/run` does not read whole diffs and the state lives in the tickets.

### 7.9 How many agents in parallel people use

| Who | How many | Source |
|---|---|---|
| Simon Willison | Several, no fixed number; limited by what he can review | [blog](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/) |
| Boris Cherny | 5 local and 5-10 on the web | Secondary, unverified |
| Agent teams documentation | Start with 3 to 5 | [docs](https://code.claude.com/docs/en/agent-teams.md) |
| Projects documentation | Start with "a few at a time" and proposed ones | [docs](https://code.claude.com/docs/en/claude-projects.md) |
| Jules (product limit) | 3, 15 or 60 depending on the plan | [docs](https://jules.google/docs/usage-limits) |
| Kiro autonomous (product limit) | 10 | [blog](https://kiro.dev/blog/introducing-kiro-autonomous-agent/) |
| Carlini | 16, in a $20,000 experiment | [post](https://www.anthropic.com/engineering/building-c-compiler) |
| Gas Town | 20-30 (the project's own claim) | [README](https://github.com/gastownhall/gastown) |

Your N = 2 to start with is within the prudent range.

### 7.10 What they measure

| Metric | Who |
|---|---|
| Merged PRs per week | Stripe |
| Percentage of merged PRs made by the agent | Ramp |
| Merged PRs and time saved per migration | Spotify |
| Percentage of sessions the judge vetoes and how many are corrected | Spotify |
| CI rounds per run, with a cap | Stripe |
| Cost and duration per run | Anthropic |
| Review time and PR size | Faros |
| PR acceptance rate | AIDev studies |

### 7.11 Perception deceives

In a 2025 METR trial, experienced developers expected to go 24% faster with AI, measured themselves 19% slower and,
afterwards, still believed they had gone 20% faster
([TechCrunch](https://techcrunch.com/2025/07/11/ai-coding-tools-may-not-speed-up-every-developer-study-shows)). METR
itself says that result may not reflect current tools, and its 2026 study gave an unreliable signal
([summary](https://conffab.com/?p=10163); I did not read METR's original text). The lesson is not "AI slows you
down", but **measure instead of trusting the feeling**, which is your rule 4.

### 7.12 The tools change too fast

In less than a year: vibe-kanban lost its company, Crystal changed its name and product, GSD was archived,
claude-flow was renamed ruflo and several Claude Code pieces are still in preview with almost weekly changes.
Depending on a third-party orchestrator is risky. Depending on Claude Code's own pieces also changes, but those are
maintained by whoever makes the engine.

---

## 8. What this means for my design

### 8.1 The short answer, no beating around the bush

**A large part of what you want already exists inside Claude Code.** There is no need to build the machinery; what is
needed is to put on top of it what is missing.

- **If your account has Projects**, you already have a coordinator that launches threads in parallel in the cloud,
  with a branch and PR per thread, automatic CI fixing, a panel that tells you what needs you, and work that goes on
  with the PC off. It is your `/run` turned into a product. What I did **not** find in its documentation: the ticket
  graph with "blocked by", the integration branch and your builder-reviewer loop as a guarantee. Besides, it is in
  beta, single-user, does not load the repository's skills and by default uses Opus with high effort.
- **Locally**, `claude --bg` per ticket, or subagents with `isolation: worktree`, already give you "N workers in
  their copy that open draft PRs". `/batch` does almost the same, but without dependencies. They need the PC on.
- **Pocock's `implement-spec` is already your `/run`**, written as a single skill on top of those pieces. Having read
  it, it lacks two things your design does have: what to do about a conflict and what to do with a ticket that does
  not pass.

So your real contribution is small: **tickets with blockers, a verification gate, a cap on rounds and a report of
what is blocked**. That fits your rule of adding nothing without a real problem.

### 8.2 What to copy

| What | From whom | Why | Cost |
|---|---|---|---|
| Tickets in vertical slices, with "Blocked by", and the list approved only once | Pocock | It is the only thing Claude Code does not ship in a stable form | Low: skill text |
| Computing the frontier in waves | Kiro | It is exactly your "frontier" | Low |
| Deterministic verifiers before opening the PR, with a `Stop` hook | Spotify | Avoids PRs that fail CI | Low: one hook |
| Cap of 2 rounds and then "blocked" with a reason | Stripe | More rounds give diminishing returns | Low |
| A judge that compares the diff with the ticket (did it stray?) | Spotify | It is the most common failure of an unattended agent | Medium: one more call per ticket |
| Reviewer separate from the builder, with clean context | Anthropic, Pocock | The builder judges itself leniently | You already have it |
| State outside the conversation: tickets and git | Anthropic, Gas Town, Ralph | The coordinator does not fill up and can be resumed | You already have it |
| One ticket per session, with clean context | Anthropic, Pocock | Less drift | You already have it |
| The agent only changes code; the push and the PR are done by `/run` | Spotify | More predictable agent | Low |
| Start with low-risk, easy-to-review tasks | Willison, Projects | Gain confidence before letting go further | None |

### 8.3 What to avoid

| What | Why |
|---|---|
| Swarms and dozens of agents (ruflo, Gas Town) | Expensive, barely measured, and review is still yours |
| A panel of several reviewers on every round | The Claude Code team itself says most tasks do not need it; in Cadenza it was the most expensive task (60.5 M cache reads) |
| Heavy specification ceremony for small things | Böckeler: 16 criteria for a small bug |
| Depending on a third-party orchestrator | vibe-kanban, Crystal and GSD are gone |
| An interface of your own | You already rule it out; vibe-kanban shows how hard it is to maintain |
| `bypassPermissions` outside a container | No protection against malicious instructions |
| Agent teams for implementing | Experimental, no working copies and with states that get stuck |
| Merging into `main` without a person | Nobody does it in the sources; `auto` mode even blocks it by default |
| Resolving conflicts blindly | Carlini saw 16 agents step on each other; your rule of "mark blocked" is the right one |

### 8.4 What is proven and what is not

| Idea | Evidence | Verdict |
|---|---|---|
| An isolated task that ends in a PR, with verification and human review | Stripe, Spotify, Ramp, all the commercial products | **Proven at scale** |
| Long unattended loop with very good tests | Carlini, Anthropic, Ralph on new projects | Proven in research and new projects; expensive |
| Reviewer separate from the builder | Anthropic's experiments | Proven in their experiments |
| LLM judge of scope | Spotify | Proven in one case, with no evaluations of the judge |
| N agents in parallel with an integration branch and automatic merger | `implement-spec`, Gas Town; no public metrics | **Not proven** (I found no data) |
| Reviewers by focus (security, UX, UI, code) | I found no evidence that they improve the code; Anthropic warns about the cost | **Not proven** |
| Deciding by risk whether a person is needed, or going to `main` without a person | Nobody does it in the sources | **Not proven** |
| 20-30 agents at once | Gas Town, anecdotal | Not proven and expensive |

### 8.5 A tension in your design: one big PR at the end

Your design gathers all the tickets in an integration branch and opens **one PR**. It mitigates the problem with
small tickets and one commit per ticket. But the evidence says big PRs are reviewed worse and merged less (Faros,
AIDev studies), and companies make **one PR per task**. There are three options:

| Option | Advantage | Drawback |
|---|---|---|
| A. Integration branch and one final PR with one commit per ticket (your design, Pocock) | Dependencies resolve themselves; you review once | The final PR grows with the list |
| B. One PR per ticket against `main` (Stripe, Spotify, Copilot, Projects by default) | Small PRs | Blocked tickets wait for you to merge: **you become the bottleneck again midway** |
| C. One PR per ticket against the integration branch, merged only when the reviewer passes, and a final PR to `main` | Small units you can read one by one in the history, and nobody waits for you | More noise on GitHub |

**My suggestion** (it is opinion, not data): stay with A or C, but **limit the size of each list**, for example to 5
to 8 tickets, so the final PR remains readable. CCPM limits it to 10 tasks per epic. If the final PR is hard for you
to read, move to C.

### 8.6 Watch out for Windows

Several pieces do not work the same on native Windows:

- Claude Code's sandbox does not exist on native Windows.
- claude-squad needs tmux, Conductor only works on Mac and the split panes of agent teams do not work in Windows
  Terminal.
- "Don't ask again" approvals inside a working copy are lost when it is deleted.

To work without questions, your options are: (1) `auto` mode with a list of allowed commands and
`--permission-prompts none`; (2) WSL2 or a container, where there is a sandbox; or (3) **the cloud**, which solves
both isolation and "PC on" at once. The last one is the simplest if your account has it.

### 8.7 Does the order of the stages change?

The order stays, with three adjustments:

| Stage | Proposed change | Why |
|---|---|---|
| 0. Client | **Add:** check in your account whether you have Projects, cloud sessions and agent view. It is one hour | Answers your open question 5 before designing `/run` |
| 1. Define tasks | No changes. Consider installing Pocock's skills as they are and adapting them, instead of rewriting them | They already have the ticket-manager setup you want |
| 2. The unit | **Add** the verification gate (`Stop` hook), the cap of 2 rounds and **measuring from the first ticket** (`--output-format json` gives the cost) | Measure before changing; stage 4 is split between 2 and 3 |
| 3. The assembly line | **Before writing `/run`, try the native pieces** with N = 2: (a) Projects with the instruction "one thread per ticket on the frontier; do not start the blocked ones"; (b) `claude --bg` per ticket; (c) Pocock's `implement-spec` untouched. Write only what is missing | `/run` may end up very small or unnecessary |
| 4. Measure | Integrated into 2 and 3 | |
| 5. Improve from data | No changes | |

### 8.8 Your open questions, with what is now known

| Question | What the research says |
|---|---|
| 2. One PR per list or per ticket? | Companies make one per ticket; Pocock, one per list. See 8.5 |
| 4. How many at once? | Starting with 2 is within what is recommended; the real limit is your review and your quota |
| 5. Local or cloud? | The cloud solves "PC on" and isolation; Projects is in beta on Pro and Max. You have to check the account |
| 6. What permissions? | `auto` mode with an allowlist and `--permission-prompts none`, or a container, or the cloud. `bypassPermissions` only in a container |

---

## 9. Sources

All consulted on **2026-10-26**. In parentheses, the publication date when I know it.

### Official Claude Code documentation

- Overview: https://code.claude.com/docs/en/overview
- Running agents in parallel: https://code.claude.com/docs/en/agents.md
- Subagents: https://code.claude.com/docs/en/sub-agents.md
- Working copies: https://code.claude.com/docs/en/worktrees.md
- Agent view: https://code.claude.com/docs/en/agent-view.md
- Agent teams: https://code.claude.com/docs/en/agent-teams.md
- Dynamic workflows: https://code.claude.com/docs/en/workflows.md
- Headless mode: https://code.claude.com/docs/en/headless.md
- Agent SDK: https://code.claude.com/docs/en/agent-sdk/overview.md
- Hooks: https://code.claude.com/docs/en/hooks.md
- `/goal`: https://code.claude.com/docs/en/goal.md
- Commands (`/batch`, `/code-review`, `/autofix-pr`): https://code.claude.com/docs/en/commands.md
- Skills: https://code.claude.com/docs/en/skills.md
- Plugins: https://code.claude.com/docs/en/plugins/overview.md
- Permission modes: https://code.claude.com/docs/en/permission-modes.md
- Sandbox: https://code.claude.com/docs/en/sandboxing.md
- GitHub Actions: https://code.claude.com/docs/en/github-actions.md
- GitHub action: https://github.com/anthropics/claude-code-action
- Cloud sessions: https://code.claude.com/docs/en/claude-code-on-the-web.md
- Projects: https://code.claude.com/docs/en/claude-projects.md
- Scheduled tasks: https://code.claude.com/docs/en/routines.md
- Costs: https://code.claude.com/docs/en/costs.md
- Ultrareview: https://code.claude.com/docs/en/ultrareview.md

### Anthropic (blog and engineering)

- Dynamic workflows on the Claude Code team (2026-06-02): https://claude.dev/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code/
- Harnesses for long-running agents (2025-11-26): https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Harness design for long-running applications (2026-03-24): https://www.anthropic.com/engineering/harness-design-long-running-apps
- C compiler with parallel Claudes (2026-02-05): https://www.anthropic.com/engineering/building-c-compiler
- Multi-agent research system (2025-06-13): https://www.anthropic.com/engineering/multi-agent-research-system

### Community

- Matt Pocock's skills: https://github.com/mattpocock/skills
- `implement-spec`: https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/implement-spec/SKILL.md
- Sandcastle: https://github.com/mattpocock/sandcastle
- Superpowers: https://github.com/obra/superpowers
- CCPM: https://github.com/automazeio/ccpm
- Gas Town: https://github.com/gastownhall/gastown
- Beads: https://github.com/gastownhall/beads
- ruflo: https://github.com/ruvnet/ruflo
- BMAD: https://github.com/bmad-code-org/BMAD-METHOD
- SuperClaude: https://github.com/SuperClaude-Org/SuperClaude_Framework
- Compound Engineering: https://github.com/EveryInc/compound-engineering-plugin
- claude-squad: https://github.com/smtg-ai/claude-squad
- Conductor: https://www.conductor.build/docs/
- Crystal: https://github.com/stravu/crystal
- vibe-kanban: https://github.com/BloopAI/vibe-kanban
- vibe-kanban shutdown (2026-04-10): https://vibekanban.com/shutdown
- GSD: https://github.com/gsd-build/get-shit-done
- claude_code_agent_farm: https://github.com/Dicklesworthstone/claude_code_agent_farm
- Agent OS: https://github.com/buildermethods/agent-os
- Ralph (2025-07-14): https://ghuntley.com/ralph/
- Thoughtworks Radar on Ralph (2026-04-15): https://www.thoughtworks.com/en-de/radar/techniques/ralph-loop
- Maggie Appleton on Gas Town: https://maggieappleton.com/gastown
- heise on Gas Town: https://heise.de/-11178824

### Specification-driven development

- Spec Kit: https://github.com/github/spec-kit
- Kiro, specifications: https://kiro.dev/docs/specs/
- Kiro autonomous agent (2025-12-02): https://kiro.dev/blog/introducing-kiro-autonomous-agent/
- Böckeler on Kiro, Spec Kit and Tessl (2025-10-15): https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html

### Commercial products

- Copilot coding agent: https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent
- Claude and Codex on GitHub (2026-02-04): https://github.blog/changelog/2026-02-04-claude-and-codex-are-now-available-in-public-preview-on-github/
- Third-party agents on GitHub: https://docs.github.com/en/copilot/concepts/agents/about-third-party-coding-agents
- Codex cloud: https://learn.chatgpt.com/docs/cloud
- Cursor Cloud Agents: https://cursor.com/docs/cloud-agent
- Devin: https://docs.devin.ai/
- Factory: https://docs.factory.com/
- Jules: https://jules.google/docs and https://jules.google/docs/usage-limits

### Company cases

- Stripe, Minions part 1 (2026-02-09): https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents
- Stripe, Minions part 2 (2026-02-19): https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2
- Spotify, Honk part 1 (2025-11-06): https://engineering.atspotify.com/2025/11/spotifys-background-coding-agent-part-1
- Spotify, Honk part 3 (2025-12-09): https://engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3
- Ramp, according to InfoQ (2026-01-23): https://infoq.com/news/2026/01/ramp-coding-agent-platform/
- Ramp, original post (I did not read it): https://builders.ramp.com/post/why-we-built-our-background-agent
- Port's "Inside the Software Factory" index: https://software-factories.port.io/stripe

### Lessons and studies

- Simon Willison (2025-10-05): https://simonwillison.net/2025/Oct/5/parallel-coding-agents/
- Cognition, "Don't build multi-agents" (2025-06-12): https://cognition.com/blog/dont-build-multi-agents
- Faros, "AI Productivity Paradox" (2025-07-23): https://www.faros.ai/blog/ai-software-engineering
- METR, according to TechCrunch (2025-07-11): https://techcrunch.com/2025/07/11/ai-coding-tools-may-not-speed-up-every-developer-study-shows
- Rejected agent PRs (2026-02-04): https://arxiv.org/abs/2602.04226
- Failed agent PRs: https://arxiv.org/html/2601.15195v1
- Agent PR integration: https://arxiv.org/html/2602.19441v1
