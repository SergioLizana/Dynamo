# Review of the external diagnosis: who runs the loop

Date: 2026-10-28. Input: `documentation/Research/dynamo-analisis/dynamo-analisis/index.html` (diagnosis of
`release/0.1.0` at `ad7f3ed`, compared with super-board, Matt Pocock's skills and Sandcastle, and Lauren Tan's pstack).
Checked against the repository at `4f0cfcf` (after #76), the plan and the trials.

## 1. The short answer

The diagnosis is right on the main point, and the evidence is ours, not theirs:

- **The loop has to run as code, not as an LLM.** A workflow script cannot run a command or read a file, so every
  `git` and `gh` goes through the `runner` (Haiku) that copies text by hand. Almost everything we fixed in the last
  two days is a consequence of that choice, not a real problem of the factory.
- **What thinks stays as it is:** `/discover`, `/to-request`, `/to-tasks`, the `builder` rules, the `reviewer`, the cap
  of 2 rounds, Verify by exit codes, GitHub as the only state, the backlog as a barrier and `outside-writes.js`.
- **It is less of a paradigm change than it looks.** Plan §6.3 already says that underneath we use `git worktree add`
  and `claude -p --output-format json` with `--max-budget-usd`. The trial of `documentation/parallel-launch-trial.md`
  shows that option as the best in every row (right base, its own settings, it does not wait for permissions, gives the
  cost). We left it only for the live view in `/workflows` (`documentation/spec-pendientes-etapa-2.md`, line 3). The
  proposal is to go back to that line with the deterministic part in a small program of our own.
- **Part 2 of the diagnosis (multi-project harness) is a good direction and a bad plan for now.** Declarative pipeline
  with `when` expressions, review panels, knowledge adapters, stack profiles and a Bun binary are exactly the "unused
  machinery" of plan §2. They go to the backlog with a trigger each; nothing of it is built before the real project.

## 2. What the diagnosis gets right (checked)

| Claim | Checked in | Verdict |
|---|---|---|
| The script cannot run commands; the checks rely on what an agent says | `workflow-trial.md` failure 6; `run.js` header | Right |
| A ticket that passes in round 1 launches eleven agents; only two think | `launch-list.md`, «The phases» | Right |
| CRC32 and base64 written by hand, copied in three scripts because a script cannot import | `run.js`, `launch-list.md` «Long text and the runner» | Right |
| Every runner failure was fixed with more machinery around the runner | runs `wf_41e0b269-ab2`, `wf_fb8329e5-d57`, `wf_c3e19634-96a`, `wf_cec30c76-5dd` in `run.js` and `launch-list.md` | Right |
| Most of the last merges are plumbing, none is a real project | merge subjects #53-#76 | Right (my count agrees in order of magnitude) |
| `main` has 3 commits; stage 2 has not reached «main in the PR I accept» | `git log main`; plan §8 | Right |
| `claude -p` gives `total_cost_usd`, `num_turns`, structured output and never waits | `parallel-launch-trial.md`; `claude --help` (2.1.312): `--json-schema`, `--max-budget-usd`, `--agent`, `--agents`, `--permission-prompts none` | Right |
| Per-agent permissions are impossible today and trivial with one process per agent | `backlog.md`, «Different permissions per agent» | Right |
| Two implementations of the loop (`/implement` and `run.js`) that already diverge | `backlog.md`, «Minor findings»; `implement/SKILL.md` | Right |

The strongest evidence came after the diagnosis: #76 moved the big reads to a Node command of the repository
(`.claude/workflows/lib/read.js`, 469 lines). That is the right instinct (do the work where the data is), but it still
pays the transport: base64 pieces, `cksum` on every line, a maximum line length. The workflow code went from about
1,750 lines to about 1,835. **It is the Cadenza signal of plan §2: a slimming effort that makes the orchestrator
grow.** `read.js` is half of a CLI already; the other half is to stop passing through the `runner`.

## 3. Where I would correct or soften the diagnosis

1. **Not a face-off with the same tickets.** Its step 3 runs the same three tickets with `/run` and with the new
   program. That spends six builds to confirm what the trials already measured. Rule 4 asks for data and we have it:
   the failures above and the per-ticket comments of the past runs. Compare the first real runs of the program against
   those comments instead.
2. **No interfaces with a single implementation.** «Design the extension points now: Board, Runner, Knowledge, step
   types, role contract» is speculative design. What is enough: separate modules (`gh`, `claude`, `git`, `loop`) so that
   swapping one later is a refactor, not a rewrite. A formal `Runner` interface is written when there is a second backend.
3. **No pipeline DSL.** `when: "changed('**/auth/**')"` is a small language we would have to parse, test and document.
   The pipeline stays in code; the config only has data (checks, limits, columns). If two projects need different
   pipelines, a step list in config comes then, and conditions are code.
4. **TypeScript, but without a build step.** The current code is plain Node with no dependencies, and that is a virtue
   for portability (the factory runs on Linux, macOS and Windows). Recent Node runs `.ts` files directly (type stripping), so we can have
   types without a compiler. `claude --json-schema` already validates the agents' output, so `zod` is not needed at the
   start. A Bun binary only when a project without Node needs it.
5. **The usage limit is not solved yet, only planned.** In `claude -p` the agent fails at the limit (research §3.6).
   «Detect, sleep and resume» needs first a probe of how that failure shows in the JSON (`subtype`, `is_error`, the
   message). Until then the program stops cleanly and the list is relaunched by hand, which is safe because the state is
   in GitHub.
6. **The live view is a real loss.** It was the reason for the change. A log per ticket (`stream-json` to
   `logs/<ticket>.jsonl`) plus `dynamo status` plus the board covers it, with a Claude Code mod on top: a pane beside
   the chat that reads those logs (phase 2). It should be tried in the first run, not assumed.
7. **Merging `release/0.1.0` into `main`.** The diagnosis says to do it first. I agree, as a baseline (tag it
   `v0.1.0`), knowing that a good part of it will be deleted in the next release. The alternative (leaving it out of
   `main`) leaves the history of what failed and why outside the main branch. The human decides.

## 4. What I would keep, change and remove

| Keep | Change | Remove when the program works |
|---|---|---|
| `/discover`, `/to-request`, `/to-tasks` | `/run`: a thin skill that calls `dynamo run` | `.claude/agents/runner.md` |
| `builder.md` and `reviewer.md` (now loaded by `claude -p --agent`) | `/implement`: uses the same `dynamo` subcommands to move cards, verify and merge | `run.js`, `board.js`, `release-report.js` |
| Cap of 2 rounds, Verify by exit codes, merge one at a time | `factory.json`: loses the `runner` block and the phases written for the workflow | `lib/read.js` as it is (its GitHub reads move into the program) |
| GitHub issues, board, `blocked_by`, `in-release` | Tests: on pure functions (frontier, rounds, skips, report) and a fake `gh` | The `sh -c` permission rules, base64, `cksum` |
| `outside-writes.js`, the pre-push hook | `launch-list.md`: a one-page README of the program | Most of `launch-list.md` and the runner part of `factory.md` |

## 5. The phases

The definition of «complete» (plan §8.1) does not move: a list of tickets with dependencies ends in a PR without the human's
intervention. What changes is how we get there. The factory still builds itself: the program is written as tickets
with `/implement`, which works today without the runner.

### Phase 0. Close and freeze (one session)

- No more tickets about the runner or the workflow transport. Any failure there is noted, not fixed.
- The human opens and approves the PR `release/0.1.0` → `main` (or decides not to) and tags the baseline.
- The ideas of Part 2 of the diagnosis go to `documentation/backlog.md`, each with its trigger (phase 6 below).
- The plan (§6.1, §6.2, §6.3) is updated with the decision: the loop is a program; agents only where there is judgment.
- **Done when:** a new `release/0.2.0` exists and the plan says what replaces the workflow.

The tickets still open when 0.1.0 was frozen are closed as superseded; what they ask for goes into the program:

| Ticket | What it asked | Where it goes |
|---|---|---|
| #71 | The end of a list deletes the merged branches of the run (its permission, `git branch -d`, is already in) | `dynamo run`, phase 2: delete the merged ticket branches and the copies; never a blocked ticket's |
| #72 | An *In Progress* column, so the board shows which tickets a run has taken | Phase 2, only if the first runs show the need |
| #73 | The run pushes the release branch and opens or updates its PR | `dynamo report`, phase 1: the PR body with every `Closes`; the push stays with the human unless the human decides otherwise |
| #77 | A ticket relaunched from *Needs Human* resumes its branch | `dynamo run`, phases 2 and 4: the same resume as after a usage limit |
| #74 | A skill to close a release | `documentation/backlog.md`, «A skill to close a release»: 0.1.0 is closed by hand |

### Phase 1. The deterministic steps as a CLI (tickets with `/implement`)

- `dynamo board [n ...]`: reads tickets, blockers and labels with `gh` directly; the frontier as a pure function with
  tests. Port of `board.js` and `read.js`, without pieces or fingerprints.
- `dynamo card <n> <column>`, `dynamo comment <n> --body-file <f>`: write and read back.
- `dynamo verify <copy> <base>`: the checks of the config, real exit codes, short JSON.
- `dynamo merge <n>`: the main-folder lock, `--no-ff`, checks after merging, `revert` on failure, `is-ancestor`, label.
- `dynamo report`: the release report.
- `/implement` switches to these subcommands, which already closes the divergence of the two loops.
- **Done when:** a real ticket goes through `/implement` using only these subcommands for GitHub and git.

### Phase 2. `dynamo run`: the loop (tickets with `/implement`)

- `git worktree add` from the working branch; `claude -p --agent builder` with `--json-schema`, `--max-budget-usd`,
  `--permission-mode auto` and `--permission-prompts none`; then `dynamo verify`; then `claude -p --agent reviewer`
  with read-only tools by flag.
- Rounds (max. 2), Needs Human with its reason, skipping dependents, N = 2 with a merge lock.
- `total_cost_usd` and `num_turns` in each ticket's comment: the measurement CLAUDE.md asks for, for free.
- A log per ticket and `dynamo status`. A probe of the usage-limit failure; until it is understood, stop cleanly.
- **The live view: a Claude Code mod with a «Dynamo» pane.** It gives back what `/workflows` gave:
  - A pane beside the chat (`$.ui.open`) with one row per ticket: column, round, the agent's last step (the last tool
    call or message of its log), turns and cost. Below, the blocked and skipped tickets with their reason.
  - It refreshes every few seconds (`$.clock.every`) from `dynamo status --json` (`$.process.run`), or by reading
    `logs/*.jsonl` directly (`$.fs`). The command is better: only `dynamo` then knows the log format.
  - A `/dynamo-panel` command to open it by hand: in a terminal it opens by itself only from about 144 columns.
  - It only reads and does not run the loop: if it closes or fails, the list keeps running.
  - It is built once the logs and `dynamo status --json` exist, and tried on the first real list. It lives in the
    Dynamo repository and, in phase 5, travels inside the plugin.
  - It is written with the `plugin-authoring` skill; the mod API was checked on Claude Code 2.1.312.
- **Done when:** a list of 3 tickets with one dependency ends merged into the working branch with cost and turns
  recorded. That is «complete» (§8.1, stage 3b).

### Phase 3. Subtract

- Delete what §4 marks; `/run` becomes the thin skill; rewrite `launch-list.md` as a short README; update `factory.md`.
- Compare the first lists of the program with the comments of the past `/run` runs: agents per ticket, plumbing
  failures, cost, duration. Write it down as `workflow-trial.md` was.
- **Done when:** there is one implementation of the loop and the documentation describes only it.

### Phase 4. Unattended for real

- The system task scheduler launches `dynamo run` (cron, launchd or Windows' own).
- A fine-grained `GH_TOKEN` only in the agents' processes (Contents read-only; Issues and Projects writable): closes
  «Protect `main`» of the backlog without GitHub Pro.
- **Done when:** a list runs with nobody at the PC and leaves its report and the commands for the human.

**Example: how a list survives the usage limit.** `dynamo run` keeps nothing in memory that it cannot read again, so
when it stops it is launched again and goes on where it was.

| What | Where it is kept |
|---|---|
| The phase of each ticket | The board column |
| What is already in the release | The `in-release` label and the merge in git |
| The Builder's work | The ticket branch and its copy on disk |
| The round and the id of each agent's conversation | A small file per ticket, for example `.dynamo/runs/34.json` (new) |

`claude -p` takes `--session-id <uuid>` and `--resume <id>` (checked in `claude --help`, 2.1.312), so `dynamo` gives
each Builder a known id and can continue that same conversation later.

When an agent hits the limit:

1. The `claude -p` process ends with an error that `dynamo` reads as «usage limit», not as a failure of the ticket.
2. It costs no round, as plumbing does not today.
3. No more agents are launched. Each card stays in its column, with a comment on the ticket: paused by the usage
   limit, and when it should resume.
4. `dynamo` exits. The system task scheduler launches it again later (every hour, or at the reset time if the error
   gives it). Exiting is better than sleeping in the process: it survives the PC sleeping or restarting.

How each step resumes:

| Where it stopped | How it goes on |
|---|---|
| The Builder, halfway | `claude -p --resume <id>` with «go on where you left it»; if that fails, a new Builder on the same copy, which already holds the work in its branch |
| The reviewer | Launched again from the start: it only reads, so nothing is halfway |
| Verify | Run again: it is code and costs no tokens |
| Merge | First `is-ancestor`: if it is already merged, only what is missing is done (label, card, comment) |

Every step looks before it acts: a copy that exists is reused, a comment already posted is not posted again, a card
already in its column stays. Launching `dynamo run` ten times in a row gives the same result.

```text
01:00  dynamo run 34 35 36
01:40  #34 merged. #35 in Build, round 1. #36 waits for #35
02:10  #35: the Builder hits the limit -> #35 paused, no round spent; dynamo exits
03:00  the scheduler launches it again -> still paused -> exits
05:00  launched again -> --resume of #35's Builder -> Verify -> Review -> merge -> #36
06:30  report ready; in the morning, the human pushes and runs gh pr create
```

Still unknown: the exact form of the error in the JSON of `claude -p` (the probe of phase 2); whether a cut leaves
half-written files in the copy (the Builder resumes over them and Verify catches what is broken); how to wake the PC on
each OS (Windows' scheduler has «Wake the computer to run this task»). The usage limit is not `--max-budget-usd`: the
budget blocks a ticket, the usage limit only pauses it.

### Phase 5. The real project (plan stage 4)

- The skills, agents and hooks become a plugin installed at project level; the engine is installed from git.
- `factory.json` becomes the project's config (with a `version` field), written by a minimal setup that does only what
  this project needs: board from a template (`gh project copy`), the ids read back, checks that are run once before
  being written.
- **Done when:** the first real list of that project ends in a PR.

### Phase 6. Improve from data (plan stage 5)

Each item enters only when its trigger happens, as the diagnosis itself proposes:

| Capability | Trigger |
|---|---|
| A QA step (browser screenshots against the criteria) | A ticket passes checks and review but fails in the browser |
| Review panel by risk, with confidence scores and finding ids | Failures found in the release PR that the reviewer let through, counted |
| Human gate per step (schema, payments) | A project with changes that must not merge without a person |
| Stack profiles (KMP, Android, iOS in CI) | The KMM app starts |
| Knowledge from Obsidian or Confluence | A project keeps its docs there |
| Another backend (Agent SDK, Codex) | A second backend is needed, or data says another model reviews better |
| A single binary | A project where Node is not available |

## 6. Risks of the change

- **Two orchestrators during the transition.** `run.js` is frozen from phase 0 and deleted in phase 3, not kept «just
  in case».
- **The program grows like the workflow did.** The same barriers apply: a size target for the loop (a few hundred
  lines), and a ticket that changes the program needs a measured failure.
- **Things not yet tested:** the usage-limit failure in `-p`; that `--agent builder` in a copy takes the model and tools
  of `.claude/agents/builder.md`; that `outside-writes.js` loads in every `claude -p` of a copy (the trial suggests it,
  because the copy's `settings.json` applied). Each one is a short probe in phase 2, before relying on it.
- **Subscription policy.** `claude -p` with my session is the documented path; the Agent SDK with a subscription is not
  clear and is not used.
