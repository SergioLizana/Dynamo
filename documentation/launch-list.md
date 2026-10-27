# Launching a list of tickets with the workflow

The `run` workflow (`.claude/workflows/run.js`) builds a list of tickets without intervention: it reads the state in
GitHub, builds each ready ticket in its own copy, reviews it with the `reviewer`, merges them one at a time into the
working branch, and blocks or skips whatever gets in the way. It reads the project data (`project`), the
board columns and the phases from `.claude/factory.json`, with the script and no agent (see «The phases»). It is the design of
`documentation/workflow-trial.md`. It is launched with `/run`.

## Before launching

- Workflows enabled in `/config` (on the Pro plan they come off).
- `"worktree": { "baseRef": "head" }` in `.claude/settings.json`: the copies start from the current checkout.
- The main folder, on the working branch and with no changes in tracked files (the copies in `.claude/worktrees/` do not
  count): that is where the merges happen. Otherwise the workflow stops at the start and says why.

## Launching

In a normal Claude Code session, opened at the root of the repository:

```text
/run 34 35
```

Or, in other words, "Launch /run with tickets 34 and 35". Claude passes the numbers as `args`. Without numbers, it takes
all open issues that have neither the done label nor a card in *Needs Human*. For another base: "Launch /run with tickets 34 and 35 and
base `release/0.0.0-prueba`" (`args = { tickets, base }`).

`args` can be a number (`34`), text (`"34"`, `"34 35"`, `"34,35"`: numbers separated by spaces or commas), an array
(`["34", "35"]`, `[34, 35]` or `[34]`) or `{ tickets, base }`, where `tickets` is a number, text or an array
(`{ tickets: 34 }`, `{ tickets: "34 35" }`). Anything that is not an object is the list of tickets, and a single value
is a list of one. No `args`, or empty text, means every ticket.
If something is not a ticket number (`"34 abc"`, `"#34"`), the run stops before reading anything and says which part it could
not read.

If `/run` does not appear as a command, the session was opened before the workflow was saved (a workflow created or
renamed after the session opened is not listed as `/run` until the session loads it). Then ask Claude to run it by its
script path, with the same tickets: "Run the workflow `.claude/workflows/run.js` with tickets 34 and 35".

The first time, Claude Code asks for permission to launch the workflow (in `auto` mode, only the first time). A command
that needs permission in the middle of the run is asked of the human, and that agent waits.

## Following it

`/workflows` opens the view of the run: the two reads of the start and the phases of `.claude/factory.json` (today *Build*, *Verify*,
*Review* and *Merge*), each agent with its calls, its result and its tokens. `p` pauses or resumes, `x` stops one agent or the whole run. A progress line also appears in
the task panel, below the entry.

At the end, the workflow returns, per ticket: done (with the merge commit), blocked (with the reason) or skipped. It also
returns the copies removed, the ones kept and the branches the human has to delete. The source of truth is GitHub: the
label, the card and the comment of each ticket. It also leaves the report of the list (see «The end of a list»).

## The end of a list

After the cleanup the script builds the report of the list from the results (not from what an agent remembers) and
looks for an open pull request from the working branch to the main branch (`gh pr list`). **The run never pushes and
never opens a PR** (plan §6.1, `CLAUDE.md`, «Limits»).

The report has: per ticket the result, the rounds and the merge commit; the blocked tickets and the skipped ones, each
with its reason; the «Out of the ticket» lines the Builders noted; a `/cost` line for the human to fill in; and a
`Closes #n` line for each merged ticket.

- **A PR exists:** the report is added to the end of its body (what the body had stays), without repeating a
  `Closes #n` line it already has. The script reads the body back from GitHub and says in `pullRequest.updated` whether
  it matches. The human fills in the cost line in the PR, reads it, and decides when to merge it.
- **No PR exists:** the run changes nothing on GitHub. It returns the report, written also to
  `.claude/worktrees/run-report.md` (ignored by git), and `commandsForTheHuman`: the push (`git push -u origin <base>`)
  and `gh pr create ... --body-file .claude/worktrees/run-report.md`, to run in that order from the main folder. If the
  base is not on the remote, `notes` says so and the push creates it; if the PRs or the remote could not be read, `notes`
  says that too and the commands are still returned. After the push, a person (not the run) approves and merges into
  the main branch.

The human fills in the `/cost` of the session and decides about the backlog lines.

## The start

No agent interprets the start: it is two literal reads and the script decides (one agent per phase, not per command).

1. `.claude/factory.json`, read by an agent that returns the file as it is.
2. One agent runs three commands and returns each one's exit code and output as they are: `git status --porcelain
   --untracked-files=no`, `git branch --show-current` and one `gh api graphql` query with every ticket (the requested
   ones, or the first 100 open ones), its labels, the status of its card and its native blockers (with their state and
   labels). Every list is checked against its total, so nothing is cut off silently.

The script then stops the run, before any *Build*, if the main folder has changes in tracked files, is not on the base,
or the base is the main branch, and if a requested ticket cannot be read (it is named in the result). With no numbers,
more than 100 open tickets also stops it. The rules for which tickets are ready (done, in *Needs Human*, blocked)
are the script's, not an agent's.

## The phases

`.claude/factory.json` gives the project data (`project`; the file is rejected without it), the columns *Todo*, *Needs Human* and *Done* (`columns`), the small agents (`small`:
model and effort of the script's small agents: raw reads, cards, reports, cleanup) and the phases, in order (`phases`). One phase = one
column = one agent. Each phase carries:

- `name`: the name; it picks its function in `PHASES` (`run.js:249`).
- `column`: the board column where it puts the card. `moveCard`: `"start"` puts it there when the phase starts, `"end"`
  only if the phase passes (so *Merge* ends in *Done* without going back).
- `model`, `effort`, `agentType`: those of the agent; `null` leaves its own (the `reviewer`, the one in its
  definition).
- `onFail`: an earlier phase, where the ticket goes back for another round, or the *Needs Human* column, which stops it.

Today (`factory.json:13-16`): *Build* on Sonnet, *Verify* on Haiku, *Review* with the `reviewer` and *Merge* on Haiku. A
merged card goes *Todo* → *Build* → *Verify* → *Review* → *Done*.

Changing a model, an effort or the name of a column means editing only the JSON. **Adding a phase:**

1. An entry in `phases` of `.claude/factory.json`, in its place in the order, with the seven fields.
2. A function in `run.js` next to the others (`buildPhase`, `run.js:127`, is the template) that receives the ticket and
   its state (`ctx`) and returns `prompt`, `step` (the word for «Stopped at»), `schema`, `isolation` or `serial` if it
   needs them, and `read(result)` → `{ pass: true }` or `{ pass: false, failure }` (`run.js:120-124`).
3. Add it to `PHASES` with the same name (`run.js:249`). The loop (`run.js:450-479`) is not touched.

If the function is missing, or the JSON is missing, cannot be read or is not valid, the workflow stops at the start and
says why (`run.js:288-295`, check at `:254-276`).

## How it decides

- **Models and efforts:** from `.claude/factory.json`, never written in `run.js` (`optsOf`, `run.js:279-285`); the
  `reviewer` with `agentType: 'reviewer'` and no model, so it uses the one in its definition, Opus (`factory.json:15`).
  Only the reading of the JSON itself runs without a model, because it is not known yet (`run.js:287-290`).
- ***Build* does not check:** it changes and commits (`run.js:149-151`). ***Verify*** runs the check in the *Build* copy
  and on its commit, and the script reads the literal result (`run.js:166-192`): if it fails, the ticket goes where its
  `onFail` says, with the literal output for *Build*.
- **Cap of 2 rounds:** `run.js:15`; each failure that sends the ticket back to an earlier phase counts one round,
  whether from *Verify* or from the reviewer (`run.js:465-472`). When they run out, blocked (`:474-478`).
- **The script moves the board:** each phase puts the card in its column, by the issue URL, and checks it with
  `gh issue view` (`run.js:351-365`, calls at `:453` and `:461`). The phase agents do not move cards (`run.js:21`).
- **Blockers, from GitHub:** they come in the same read as the tickets (see «The start»), as GitHub printed them, and
  the script parses them before starting any ticket. A list cut short is a ticket that cannot be read, which stops the
  run.
- **Waiting for blockers:** each ticket waits for the ones in the list (`run.js:440`). A blocker outside the list has to
  be already closed or done; if not, the ticket is skipped (`:436`).
- **Skipping the dependents of a blocked ticket:** "skipped: depends on #n, which did not reach the release" (`:443`),
  with no label and the card where it was.
- **A stopped ticket always shows as stuck:** the script moves it to the *Needs Human* column of the JSON and checks it
  (`run.js:368-371`). If *Merge* stops, it has already published its report and the script only moves the card
  (`:474-477`); if a phase returns nothing, it is blocked anyway (`:459`). If after two attempts it is still not moved,
  the result says `marked: false` and warns about it (`:363`).
- **What a checkbox asks for outside the code:** *Build* publishes it during its step (`run.js:147`); *Merge* publishes
  only the final report and does not repeat it (`:237`).

## Failures from the trial, fixed

Failures 1-5 of `documentation/workflow-trial.md`:

1. **It did not clean up everything:** at the end, an agent removes all the copies of the run, from every round (except
   the copy of a blocked ticket with no commit, which keeps the only copy of the work), and lists the branches left for
   the human to delete, because deleting branches asks for permission (`run.js:155` and `:504-515`).
2. **Dirty history in the second round:** round 2 brings round 1's work with `git cherry-pick`, and only if
   `git log <base>..<branch>` lists commits (`run.js:126` and `:131-132`).
3. **A second round that does no good:** if *Build* says the ticket needs the human, it is blocked without a second round
   (`run.js:157-158`).
4. **Unchecked claims:** everything done comes from a command run in that step, never "HEAD of …" (`run.js:18` and
   `:22-24`), and a commit has to be a sha (`:27-28`).
5. **Compound commands:** one command per call and cards moved by the issue URL, without `move_card` (`run.js:17` and
   `:21`, `:351-358`).

## Execution `wf_41e0b269-ab2`

The first one with real tickets: 2026-10-27, tickets #35-#38. #35 was merged (`49829bd`). Two failures, both from failure
6 of the trial (the script trusted what its agents said), fixed in #39:

- The agent that read the tickets returned #38 with `"blockers": []`, but in GitHub #38 is blocked by #37. #38 was built with #37 skipped; only
  the reviewer stopped it.
- After a merge conflict, the *Merge* agent said that `.claude/factory.md` "no longer defines" the blocked label (false:
  it was still there) and left #36 with no label and its card in *In Review*: nothing showed that it was stuck.

## Not tested yet

Still untested: what the trial left pending (a check that fails after merging, a permission asked in the middle of the
run, a pause at the usage limit); that the script receives `args` correctly from `/run`; and the #39 changes with real
tickets (only dry-run, with simulated agents).
