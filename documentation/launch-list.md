# Launching a list of tickets with the workflow

The `run` workflow (`.claude/workflows/run.js`) builds a list of tickets without intervention: it reads the state in
GitHub, builds each ready ticket in its own copy, reviews it with the `reviewer`, merges them one at a time into the
working branch, and blocks or skips whatever gets in the way. It reads the project data (`project`), the
board columns and the phases from `.claude/factory.json`, with the script and no agent (see «The phases»). It is the design of
`documentation/workflow-trial.md`. It is launched with `/run`. To see before launching which tickets are ready, blocked,
in *Needs Human* or done, `/board` shows them (see «The start»).

## Before launching

- Workflows enabled in `/config` (on the Pro plan they come off).
- `"worktree": { "baseRef": "head" }` in `.claude/settings.json`: the copies start from the current checkout.
- The main folder, on the working branch and with no changes in tracked files (the copies in `.claude/worktrees/` do not
  count): that is where the merges happen. Otherwise the workflow stops at the start and says why.
- After merging a change to `.claude/agents/` (the `runner`, the `reviewer`), restart the session before the next run: a
  definition is loaded only when the session starts, so a run in the same session uses the old one.

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

The end of a list is a second workflow, `.claude/workflows/release-report.js`, that `run.js` calls as a child at the
end. **It never pushes and never opens or edits a PR** (plan §6.1, `CLAUDE.md`, «Limits»): it writes the report file and
returns the commands the human runs. It has two ways to run.

**Alone,** as `/release-report` (no args: the working branch of `.claude/factory.json`; or a base: `/release-report
release/0.1.0`, `args = "release/0.1.0"` or `{ base }`). It reads `factory.json` itself (one `runner` call), and is the
way to get the report of a release again at any time, with no run: it rebuilds it from state. If the command does not
appear, the session was opened before the workflow was saved: ask Claude to run it by its script path.

**As a child of `run.js`** (`workflow({ scriptPath }, args)` in Claude Code's workflows, code.claude.com/docs/en/workflows):
one level only (a child cannot call another), it shares the run's agent counter, concurrency and budget, and its agents
show under their own group in `/workflows`. A child receives its data as `args` and returns a value, nothing else:
`run.js` passes `{ base, project, columns, small, results, cleanup }`. `project`, `columns` and `small` are the blocks of
`factory.json` that `run.js` already read, so nothing reads the file twice; `results` are the tickets of the run (the
blocked and the skipped ones go in the report, and a merge the git log does not show is a note); `cleanup` is the list of
commands that remove the copies of the run, which the child runs in its own `runner` call that writes the file and
returns their output untouched (so the cleanup costs no agent of its own). `run.js` reads the copies and branches left
from that output, and returns the report next to them.

**The report is rebuilt from state, not from what a run remembers** (the first report of the release was overwritten, and
a report built from memory lost the earlier runs). It is built by a command of the repository, not by the `runner` copying
data (ticket #76, «The big reads» in «Long text and the runner»): one `runner` call runs the cleanup of the copies (if the
run passed it), the pieces of the run's results (only as a child of `run.js`), `node .claude/workflows/lib/read.js release
<base> [results <hash>]` and `node .claude/workflows/lib/read.js tidy`. The `release` command reads the merge commits of
the base since the main branch (`git log --first-parent`), the last run comment of every ticket with the done label (one
`gh api graphql` query: the first line of its last run comment, the `Rounds:` line and the «Out of the ticket» lines), the
cards in *Needs Human* (`gh project item-list`), the open PR of the base, and the remote (the tip `git ls-remote` printed
against the local one and the commits not on `origin`); it writes the report file itself and prints ONE short line with the
file, its length and hash, and a few counts and note codes. The script checks that line against the hash and length printed
with it, and turns the codes into the notes. So the end of a list launches one agent for the report (two if the line has to
be asked again), and the cleanup of the copies rides in the same call.

The tickets are the `(#n)` that ends the subject of every merge commit, whatever the language of the subject (the older
merges say `Fusiona ticket/… en … (#n)`); a `Revert "<merge subject>"` takes its ticket out. The report has: the
tickets merged with the last run comment of each (its result and its rounds, quoted: a ticket merged by hand after a
blocked run shows that blocked comment, and the git log says it is merged); what the run blocked or skipped (only with
`results`); the tickets whose card is in *Needs Human*; the «Out of the ticket» lines for the backlog; a `/cost` line;
and one `Closes #n` line for every ticket merged since the main branch. A `/cost` line the human filled in on the PR is
kept in the rebuilt report. The file is `.claude/worktrees/release-report-<base>.md` (the base with `/` as `-`, ignored by
git). The result carries the path and the file's hash and length (`reportFile`, `reportSum`) and the counts (`mergedCount`,
`needsHumanCount`), not the text of the report: read the file. If the short line does not have its own hash and length
after two calls, `reportFile` is `null` and `notes` says so (nothing is taken from that line).

What it returns for the human (`commandsForTheHuman`), in order:

- **The push** (`git push -u origin <base>`) first, with a PR or without one, when the remote is behind
  (`remote.state: "behind"`) or does not have the base (`"missing"`); `notes` says how many commits are missing. If the
  remote could not be read, or has a different tip with nothing to push, `notes` says that too.
- **No PR exists:** `gh pr create ... --body-file .claude/worktrees/release-report-<base>.md`.
- **A PR exists:** `gh pr edit <n> -R <repo> --body-file .claude/worktrees/release-report-<base>.md`, which replaces the
  body with the report. The release PR is reviewed by a person (not the run), who also merges into the main branch.

The human fills in the `/cost` of the session and decides about the backlog lines.

## The start

The start is a third workflow, `.claude/workflows/board.js`, that `run.js` calls as a child before anything else. No
agent interprets it: it is literal reads, each a `runner` call, and the script decides (one agent per phase, not
per command). It has two ways to run, like the end of a list.

**Alone,** as `/board`: it takes the same `args` as `/run` (no args: every open ticket; or ticket numbers in the forms
of «Launching»; `{ tickets, base }`) and returns a table, one row per ticket: its card, whether it is ready, and why not
(*done*, in *Needs Human*, or the blockers that are not done). It changes nothing, and it is the way to see what a run
would find before launching it. It also tells when the main folder is not ready for a run (see below), and still shows
the table. If the command does not appear, the session was opened before the workflow was saved: ask Claude to run it by
its script path.

**As a child of `run.js`** (`workflow({ scriptPath }, args)`, one level only): `run.js` passes its own `args` and gets
back what it used to read itself, so nothing is read twice: `factory` (the parsed and validated `.claude/factory.json`),
`base`, `wanted` (the ticket numbers asked for), `tickets` (state, labels, card `status` and blockers) and `mainFolder`
(`problem`, null if the main folder can take a run). The table comes along too. The agents are the same as before, and
they show under the group *Start* in `/workflows`.

1. `.claude/factory.json`, read by the `runner` as parts of one short line each (`read.js factory <k>`, eight commands to
   a call): the command cuts the file by the `runner.maxLine` that is in it, so there is nothing to ask first. The parts
   are joined, checked against the hash of the whole and decoded.
2. One `runner` call runs `read.js folder` (changes in tracked files and the branch of the main folder) and `read.js
   tickets [numbers]`, which asks GitHub for every ticket (the requested ones, or the first 100 open ones), its labels,
   the status of its card and its native blockers (with their state and labels), keeps them in a file and prints how many
   there are. Then one `read.js ticket <k>` per ticket, eight to a call, each printing one short line: number, state,
   card, whether it has the done label, its blockers (number, state, done) and its title (cut, with `cut=1`, only if the
   line would be longer than `maxLine`). Every list is checked against its total, so nothing is cut off silently. The
   report at the end reads its own state (see «The end of a list»).

   The query has caps (`TICKET_FIELDS` in `read.js`): 20 labels per ticket, 5 board cards per ticket, 20 blockers per
   ticket and 10 labels per blocker, and 100 open tickets when no numbers are given. A ticket with more than that
   cannot be read whole: it stops before any *Build* and names the ticket, it does not go on with a cut list. A ticket
   whose line would be longer than `maxLine` even without its title (about 20 blockers) stops the same way. The labels
   of a ticket reach the script only as «has the done label» (all that `run.js` and the table read).

`board.js` stops, and so does the run before any *Build*, if `factory.json` cannot be read or is not valid, if the base
is the main branch, if something in `args` is not a ticket number, and if a requested ticket cannot be read (it is
named in the result). With no numbers, more than 100 open tickets also stops it. The main folder (changes in tracked
files, not on the base) is data: `board.js` reports it in `mainFolder.problem` and `run.js` stops on it.

The rules for which tickets a run builds (done, in *Needs Human*, blocked, waiting) are the script's, not an agent's,
and they stay in `run.js` (`doneOnBoard`, `onNeedsHuman`, `runTicket`). The table of `/board` shows the same rules; if
they change, change both. `run.js` also checks that every phase of the JSON has its function in `PHASES`.

## The phases

`.claude/factory.json` gives the project data (`project`; the file is rejected without it), the columns *Todo*, *Needs Human* and *Done* (`columns`), the small agents (`small`, see below) and the phases, in order (`phases`). One phase = one
column = one agent. `small` is the model and effort of every `runner` call that has no phase of its own: the start's reads, the card
moves, the comments, the report and the cleanup (`SMALL` in `run.js` and `board.js`). A phase takes its own `model` and `effort`, and
`small` never overrides them. The first read, the one that gets this file, runs before `small` is known, so it uses the
`runner`'s own model.

Each phase carries:

- `name`: the name; it picks its function in `PHASES`, the table next to the phase functions in `run.js`.
- `column`: the board column where it puts the card. `moveCard`: `"start"` puts it there when the phase starts, `"end"`
  only if the phase passes (so *Merge* ends in *Done* without going back).
- `model`, `effort`, `agentType`: those of the agent; `null` leaves its own (the one in its definition). A phase
  with an `agentType` must have `model` and `effort` null: the workflow rejects the file otherwise.
- `onFail`: an earlier phase, where the ticket goes back for another round, or the *Needs Human* column, which stops it.

Today (the `phases` of `.claude/factory.json`): *Build* with the `builder` (Sonnet, from `.claude/agents/builder.md`, the one definition of the Builder's rules that `/implement` also follows), *Verify* on Haiku, *Review* with the `reviewer` and *Merge* on Haiku. A
merged card goes *Todo* → *Build* → *Verify* → *Review* → *Done*.

Changing a model, an effort or the name of a column means editing only the JSON. **Adding a phase:**

1. An entry in `phases` of `.claude/factory.json`, in its place in the order, with the seven fields.
2. A function in `run.js` next to the others (`buildPhase` is the template) that receives the ticket and
   its state (`ctx`) and its entry in the JSON (`ph`) and returns `prompt`, `step` (the word for «Stopped at»), `schema`,
   `isolation` or `serial` if it needs them (or `exec()` instead of the prompt, as *Verify* does), and `read(result)` → `{ pass: true }` or `{ pass: false, failure }` (the comment that opens the «Phases» section of `run.js` describes the shape).
3. Add it to `PHASES` with the same name. The loop (`runPhases`) is not touched.

If the function is missing, or the JSON is missing, cannot be read or is not valid, the workflow stops at the start and
says why (`checkFactory` and the read of the JSON in `board.js`, and the `PHASES` check at the start of `run.js`).

## How it decides

- **Models and efforts:** from `.claude/factory.json`, never written in `run.js` (`optsOf`); the
  `reviewer` with `agentType: 'reviewer'` and no model, so it uses the one in its definition, Opus (the *Review* entry
  of `phases`). Only the reading of the JSON itself runs with the `runner`'s own model (Haiku, from its definition), because the `small` key is not known yet.
- ***Build* does not check:** it changes and commits (`buildPhase`). It ends with one read in the copy,
  `git merge-base HEAD <base>`, and the script keeps that sha. ***Verify*** is decided by the script, not by an agent:
  one `runner` call moves the card and reads it back, prints the folder the checks run in, reads the state of the *Build*
  copy and its commit and runs the commands of the check, with `<base>` replaced by that sha (the branch name moves while
  other tickets merge). The folder does not carry over between Bash calls, so each check is one command,
  `sh -c 'cd <copy> && <check>'`, and the script requires the printed folder to be the copy. The
  script decides from the exit codes and from which commands ran: if the check fails, the ticket goes where its
  `onFail` says, with the literal output for *Build*. The same call ends with the card move of the next phase (*Review*),
  which the runner only reaches if every check passed, so it costs no agent of its own.
- ***Merge* is decided by the script too**, in the serial slot (one at a time in the main folder), with `runner` calls:
  1. status and branch of the main folder, a gate that stops the runner if they are wrong, `git merge --no-ff`, the
     commands of the check with `<base>` = `HEAD~1` (the base before the merge) and the proof, `git merge-base
     --is-ancestor <branch> HEAD` and `git rev-parse --short HEAD`. The runner stops at the first command that fails.
  2. Only if needed: on a conflict, the files and `git merge --abort`; on a failed check, `git revert -m 1 --no-edit HEAD`.
  3. The done label, the card to *Done* read back, and the ticket's comment, read back.
  A merge is *merged* because `is-ancestor` said so, not because an agent did: if call 1 returns nothing after a real
  merge, one more call reads `is-ancestor` and runs the checks again, and the ticket still ends *done* with its label.
  On success that is two `runner` calls. A ticket that passes in round 1 launches eleven agents in the whole run: the two
  reads of the start, the card to *Build*, the Builder, the base read, *Verify*, the reviewer, the two of *Merge* and the
  one of the end (the report, with the cleanup of the copies); plus one `runner` call for every eight short lines of the
  start (the parts of `factory.json`, one line per ticket).
- **Plumbing does not cost a round:** a call that returns nothing, or that did not run what it should, is repeated once;
  a second time the ticket stops as «infrastructure» (that is its «Stopped at») and uses no round. The fields of a round
  (build, base sha, checks, verdict) are reset when the next round starts, so a block in round 2 quotes only round 2.
- **Cap of 2 rounds:** `MAX_ROUNDS`; each failure that sends the ticket back to an earlier phase counts one round,
  whether from *Verify* or from the reviewer (`runPhases`). When they run out, blocked (`block`).
- **The script moves the board:** each phase puts the card in its column, by the issue URL, and checks it with
  `gh issue view` (`moveCard`, called from `runPhases`). The phase agents do not move cards (rule 8 of
  `.claude/agents/builder.md`).
- **Blockers, from GitHub:** they come in the same read as the tickets (see «The start»), as GitHub printed them, and
  the script parses them before starting any ticket. A list cut short is a ticket that cannot be read, which stops the
  run.
- **Waiting for blockers:** each ticket waits for the ones in the list (`runTicket`). A blocker outside the list has to
  be already closed or done; if not, the ticket is skipped.
- **Skipping the dependents of a blocked ticket:** "skipped: depends on #n, which did not reach the release" (`runTicket`),
  with no label and the card where it was.
- **A stopped ticket always shows as stuck:** the script moves it to the *Needs Human* column of the JSON and checks it,
  in the same `runner` call that posts its comment (a read of what is left, then the comment). If a phase returns
  nothing, it is blocked anyway. If after two attempts the card is still not moved, the result says `marked: false`
  and warns about it.
- **The ticket's comment is written by the script**, for a merged ticket and for a blocked or skipped one (every ad-hoc
  agent is a `runner` now: the read of `factory.json`, the start, the reports and the cleanup). What an agent wrote (the
  reviewer's checkboxes, the Builder's no-trace and out-of-ticket lines, the reason) goes in the comment only inside a
  fenced block, as quoted data; the Builder's `published` text is not repeated, and none of those texts is in the
  prompt of an agent in the *Merge* phase. The comment travels as base64 in short pieces, so no character of it reaches
  a shell, and is posted once and confirmed by its fingerprint (see «Long text and the runner»). The prompts do not ask
  any agent to read the `project` block: the script passes the values (the documents language to the Builder and the
  reviewer).
- **Text through the `runner` stays exact:** an agent that copies text by hand loses escapes and non-ASCII characters
  (`·` came back as `�`). So every command the three workflows send is plain ASCII with no escape sequence (a filter
  that needs another character is done in the script), and a read whose output can hold other text (comments, bodies,
  titles, the PR body, commit subjects, `factory.json`) is stored as base64 and decoded by the script. An
  output that is not valid base64 and UTF-8 is a plumbing failure with its reason: the report is not written. A command
  that is not plain ASCII is refused before it is sent.
- **What a checkbox asks for outside the code:** *Build* publishes it during its step; *Merge* publishes only the
  final report and does not repeat it.

## Long text and the runner

The `runner` (Haiku) copies every command it runs and every output it returns by hand, and long text does not survive
that. In run `wf_cec30c76-5dd` a typo got into a 4.5 KB comment command and the comment was posted twice, a code fence
was dropped when the last comment was copied back, and a 30 KB read came back cut to its first 2 KB. So nothing long
crosses the `runner` in one piece, in either direction (ticket #75), and a big read is not done by the `runner` at all
but by a command of the repository (ticket #76, «The big reads»). The rule has the parts below; a script cannot import,
so the helpers are copied between scripts, each copy with the same comment.

**The limits** are in one place, the `runner` block of `.claude/factory.json`: `maxCommand`, the longest command a script
hands the `runner` (default 1500 characters), `maxOutput`, the longest output a script accepts from one command (default
1500, under the 2 KB the Bash tool shows), and `maxLine`, the longest line `read.js` prints (default 400). Each is an
integer: `maxCommand` at least 1100 (the longest fixed command is about 1050), `maxOutput` at least 400, `maxLine` at
least 240 and not more than `maxOutput`. `run.js` refuses to send a command longer than `maxCommand` (it throws, naming
the command), the helper that cuts text into pieces takes its size from it, and `read.js` fails with an `error` line
rather than print a line longer than `maxLine`.

**The big reads** (the tickets of the start, `factory.json`, the whole of the release report) are done by
`.claude/workflows/lib/read.js`, plain Node with no dependencies, the same on Linux, macOS and Windows (Git Bash): it runs
`git` and `gh` itself with no shell, reads `.claude/factory.json` for the project data and the limits, builds what is big
into a file under `.claude/worktrees/` (ignored by git) and prints **one short ASCII line**: `<kind> key=value ... <crc>
<length>`, where the values are percent-encoded and the last two numbers are the `cksum` of the text before them. The
script accepts a line only if that hash and length are the line's own, so a character the `runner` changed is caught, and
asks again (the start: three tries; the report: one more call) or builds nothing from it. Commands, all `node
.claude/workflows/lib/read.js <command>`, so that the one allow rule `Bash(node .claude/workflows/lib/*)` in
`.claude/settings.json` covers every call the start and the report make:

- `factory <k>`: part k of `factory.json` (base64, as many characters as fit `maxLine`; the line has the number of parts
  and the hash of the whole). `folder`: changes in tracked files and the current branch of the main folder.
- `tickets [n ...]`: reads the open tickets (or the numbers given) into `tmp-tickets.json` and prints their count and
  hash; `ticket <k>`: the k-th one, as a line.
- `release <base|-> [results <hash>]`: builds `release-report-<base>.md` and prints its path, hash and length, the counts
  (tickets merged, cards in *Needs Human*, the PR number), the state of the remote and the notes as codes
  (`remote-behind:3`, `no-prs`...) that `release-report.js` turns into text.
- `put <name> <k> <piece> <crc> <len>`: stores one piece of a text the script sends (the results of the run); it fails
  unless the piece arrived with that hash and length. `release` uses the pieces only if together they have the hash the
  script sent, and removes them. `tidy`: removes the `tmp-*` files.

`FACTORY_GH` and `FACTORY_GIT` (a JSON list) replace `gh` and `git` for the command, which is how the tests put a fake
in their place.

**Text that goes out** (a comment on a ticket; the results of a run to the report go the same way, through `read.js put`) is sent as base64 in pieces:

1. One command per piece, `sh -c 'mkdir -p .claude/worktrees && printf %s <piece> > <file>.NNN && test "$(cksum <
   <file>.NNN)" = "<crc> <length>"'`. The script computed the `cksum` (POSIX: the CRC and the byte count, the same on
   Linux, macOS and Git Bash) of the piece, so a piece the `runner` copied wrong fails its own command and the `runner`
   stops there: each piece is checked before the next one is sent. A piece fits `maxCommand`; a 4.5 KB comment is four or
   five pieces.
2. One command joins them: `sh -c 'test "$(cat <file>.[0-9]* | cksum)" = "<crc> <length>" && cat <file>.[0-9]* | base64
   --decode | <gh issue comment … --body-file - | the file> && rm -f <file>.[0-9]*'`. It runs only if the pieces together
   have the fingerprint of the whole, and it removes them: running it a second time finds no pieces and does nothing, so
   a text is posted at most once. The pieces are `.claude/worktrees/tmp-*` (ignored by git); what is left of a failed
   attempt is removed by `read.js tidy` in the report's call.
3. A text is **confirmed by its fingerprint, not by copying it back**: a command prints the `cksum` of the ticket's last
   comment (`gh issue view … --jq '.comments[-1].body'`, without carriage returns) or of the file
   (`cksum < <file>`), and the script compares those two numbers with its own. A mismatch is a note that says the hash and
   length it found and the ones it expected.

A comment is never posted twice. The call that posts also reads back; if its answer does not say whether the post ran
(nothing came back, or the runner stopped without a failed command), the script reads the last comment before sending
anything again, and if it cannot read it either it sends nothing and the note says the comment may not have been posted.
A piece that fails twice stops the post: the comment is not posted, and the note says which piece failed and how (it
failed its check, or the `runner` ran another command than the one it was given).

**Tests.** `node --test tests/workflows/` (needs `sh`, as the factory does: Git Bash on Windows). `read.test.js` runs the
command as a process in a scratch copy of the repository with a fake `gh` and `git` (`tests/workflows/fake-gh.js`), and
checks every line (short, ASCII, its own hash and length), the factory in parts, the tickets (also with titles cut to fit
and a line that cannot fit), the pieces and the report. `dry-run.test.js` runs the three scripts with a `runner` played by
a real shell in the same scratch copy. The `runner` there cuts every output at 2000 characters, as the Bash tool does, and
can alter one character of a command or of an output, or lose an answer. It checks that no command exceeds `maxCommand`,
no output `maxOutput` and no line of `read.js` `maxLine`, that the scripts send nothing to the `runner` for the big reads
but `node .claude/workflows/lib/read.js ...`, that a line altered once is asked again and altered every time builds
nothing, that a long comment is posted once and whole, that an altered character posts it at most once with a note that
says what failed, that a lost answer does not post it twice, that `release-report` builds the report of 55 tickets and
that `board` reads 100 open tickets, also with the smallest limits. It also lists the command shapes of `run.js` with no
rule in `.claude/settings.json` (see «Not tested yet»).

## Failures from the trial, fixed

Failures 1-5 of `documentation/workflow-trial.md`:

1. **It did not clean up everything:** at the end, the `runner` removes the copies of the run, from every round, whose
   ticket is done or whose Builder committed (the copy of a blocked ticket with no commit stays: it holds the only copy
   of the work), and the script lists from `git branch --list` the branches left for the human to delete, because
   deleting branches asks for permission.
2. **Dirty history in the second round:** round 2 brings round 1's work with `git cherry-pick`, and only if
   `git log <base>..<branch>` lists commits (`buildPhase`, and step 3 of «In a copy» in `.claude/agents/builder.md`).
3. **A second round that does no good:** if *Build* says the ticket needs the human, it is blocked without a second round
   (`buildPhase`).
4. **Unchecked claims:** everything done comes from a command run in that step, never "HEAD of …" (rule 8 of `.claude/agents/builder.md`), and a commit has to be a sha (`SHA` in `run.js`).
5. **Compound commands:** one command per call and cards moved by the issue URL, without `move_card` (`cardCommands` and
   `moveCard`).

## Execution `wf_41e0b269-ab2`

The first one with real tickets: 2026-10-27, tickets #35-#38. #35 was merged (`49829bd`). Two failures, both from failure
6 of the trial (the script trusted what its agents said), fixed in #39:

- The agent that read the tickets returned #38 with `"blockers": []`, but in GitHub #38 is blocked by #37. #38 was built with #37 skipped; only
  the reviewer stopped it.
- After a merge conflict, the *Merge* agent said that `.claude/factory.md` "no longer defines" the blocked label (false:
  it was still there) and left #36 with no label and its card in *In Review*: nothing showed that it was stuck.

## Not tested yet

Still untested:

- what the trial left pending: a check that fails after merging, a permission asked in the middle of the run, a pause at
  the usage limit;
- the changes of #56-#58 (*Verify* decided by the script against a pinned base, the Builder's one definition, the *Merge*
  sequence proved by literal reads, the comments sent as base64, the report that accumulates) with real tickets: they
  were tried in a dry run with simulated agents. A real run still has to show that the `runner` copies the short pieces of
  «Long text and the runner» (the comments) and the short lines of `read.js` without a change (the script checks a
  fingerprint of every one and says when it differs) and that the `sh -c` shapes of the comments are allowed without a
  prompt: their allow rules are not in `.claude/settings.json` yet (the dry-run test lists them as «todo»); the rule for
  `read.js` is `Bash(node .claude/workflows/lib/*)`;
- `release-report.js` launched for real (`/release-report`, or the workflow by its script path): the Builder never
  launches a workflow (a subagent has no Workflow tool, and `claude -p` stops at «Review dynamic workflow before
  running»), so the human launches it once. It was tried with a script that answers each `agent()` call the way the
  `runner` does, running the commands in a real shell (real `git log`, real `gh`), not with a Haiku agent copying the
  long `printf %s <base64> | …` command (the read-back says when the file differs); the `workflow({ scriptPath })` call
  of `run.js` was tried with simulated agents only;
- `board.js` launched for real (`/board`, or the workflow by its script path), and the `workflow({ scriptPath })` call
  of `run.js` that runs it: same reason, the Builder never launches a workflow. It was tried with a script that answers
  each `agent()` call the way the `runner` does, running the commands in a real shell (real `git`, real `gh`); the next
  `/run` tests the call from `run.js`;
- the closing of the issues by the `Closes #n` lines when the release PR reaches the main branch;
- a list with more tickets than the machine or the plan's usage limit can take at once: the workflow has no cap on
  parallel builds (`documentation/backlog.md`).
