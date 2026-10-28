---
name: implement
description: Build one GitHub ticket end to end without the human - branch from the release branch, implement, run the automatic check, get the reviewer's verdict, retry at most once, then merge into the release branch or send the ticket to *Needs Human*. Use when the human, or the /run workflow, launches /implement with a ticket number.
argument-hint: <ticket number> [base branch]
disable-model-invocation: true
---

# /implement

One ticket in, one checked and reviewed change out, merged into the release branch. Nobody is watching: never
ask the human anything. When something is missing or unclear, stop as blocked (step 7) with the reason.

Ticket: `$0`. Project data is in `.claude/factory.md`: repo, main and working branch, board,
labels, automatic check, documents language and where the backlog goes. The board commands (`move_card`, labels,
history) are in the file it names: use them from there. Base branch: `$1` if given, else the working branch.
Write GitHub comments in the documents language; code, commits and files follow `CLAUDE.md`.
Column names and option ids come only from `.claude/factory.json`: the `column` of the phases *Build*, *Verify*,
*Review* and *Merge*, and `columns.needsHuman` and `columns.done`. Below, «the Build column» is the `column` of the
phase *Build*, and so on; the option id of a column is in `options`.

## Hard limits

- Never touch the main branch: no checkout, merge or commit on it. Never push. If the base is the main branch,
  stop as blocked.
- Change only what the ticket asks. Anything else you notice goes in the final comment, not in the change.
- Do not delete evidence of a test (a temporary issue, branch or file) before the reviewer passes.
- The board always shows the real step: move the card at every step below, and never skip one.

## Moving the card

Every «move the card to X» below means two things, in this order:

1. Move it with `move_card` (the board commands file).
2. Check it: `gh issue view $0 --json projectItems` and read the status of the card. If it is not the column X, run the
   move once more and check again. If it is still not X, stop as blocked (step 7) with «card did not move to X» and
   the literal output of the check. In step 7 itself the move to *Needs Human* is checked the same way, but a second
   failure there only goes in the comment and in the final summary.

## 0. Start

A stop in this step (every «stop as blocked» below, and the hard limit on the main branch) is a stop at `start`: step 7
only comments, because nothing is built yet and the tree may hold the human's own work.

1. `git status --porcelain` must be empty. If not, stop as blocked («working tree not clean»).
2. Read `.claude/factory.md` and `CLAUDE.md`. No automatic check defined: stop as blocked. Never treat a missing
   check as passed.
3. `gh issue view $0 --json projectItems`: stop as blocked if its status on the board is *Needs Human*. Then
   `.../dependencies/blocked_by`: stop as blocked if any blocker is neither closed nor has the done label.
4. Set `round = 1`. The limit is 2 rounds in total, counting failures of both the check and the reviewer.
5. Move the card to the Build column. This is the last action of step 0: no branch and no code before the card is
   there and checked.

## 1. Branch

`git checkout -b ticket/$0-<short-slug> <base>`.

## 2. Build (you are the Builder)

Follow `.claude/agents/builder.md`: its *Rules* and *In the current tree*. Its input is the ticket `$0`, the repo, the
base, the round and, from round 2, what failed (the check output or the reviewer's «For the Builder»). Keep what it
asks you to keep (what you published, the no-trace notes, what you saw outside the ticket) for step 6.

## 3. Automatic check

Move the card to the Verify column. First `git add -N <paths of the new files>` (intent to add, nothing else is
staged): `git diff --check <base>` ignores files git does not know. Run every command of the automatic check with
`<base>` replaced.
- All exit 0: go to step 4.
- Any fails: no commit and no reviewer. If `round = 1`: `round = 2`, card to the Build column, back to step 2 with the
  failing output. If `round = 2`: blocked (step 7) with the failing command and its output.

## 4. Review

Move the card to the Review column. Launch the `reviewer` subagent with: ticket `$0`, the repo, base `<base>`, the
uncommitted change in the current directory, and from round 2 its previous verdict word for word.
- `VERDICT: PASS`: go to step 5.
- `VERDICT: FAIL`: if `round = 1`: `round = 2`, card to the Build column, back to step 2 with «For the Builder».
  If `round = 2`: blocked (step 7) with the verdict.

## 5. Commit and merge

1. Stage only the files of the change (`git add <paths>`, never `-A`). Commit on the ticket branch: subject in
   the documents language, ending in `(#$0)`, plus the attribution line Claude Code gives you.
2. `git checkout <base>`, `git merge --no-ff ticket/$0-<slug> -m "Merge ticket/$0-<slug> into <base> (#$0)"`.
3. Move the card to the Verify column and run the automatic check again on the base, with `<base>` replaced by
   `HEAD~1` (the base before the merge: `<base>` itself would compare the branch with itself). If it fails:
   `git revert -m 1 --no-edit HEAD` and blocked (step 7).
4. Add the done label and move the card to the Done column.

## 6. Report on the ticket

One `gh issue comment $0`, in the documents language, with this shape. It does not repeat what step 2 already
published for a checkbox:

```text
/implement · <PASS and merged into <base> | not merged>
Rounds: <round>/2
Checks: <each command → result>
Reviewer: <final verdict, one line per checkbox>
No trace: <command → output> | none
Out of the ticket (for the backlog): <what was seen> | nothing
```

## 7. Blocked

- Stopped at `start` (step 0): post only the comment, with `Stopped at: start` and `Left: nothing`. No card move (a
  card already in *Needs Human* stays there; the `run` workflow skips a ticket whose blocker is not done), no stash, no
  checkout. Skip the rest of this step.
- Move the card to the Needs Human column (option id in `.claude/factory.json`, by URL as the board commands file says).
- Post the step 6 comment with the reason (the literal failing output or verdict), and these three lines after
  `Reviewer:`:

  ```text
  Stopped at: <start | build | check | review | merge>
  Left: <branch and stash, by name | nothing>
  To relaunch: take the card out of *Needs Human* (documentation/github-board.md) and launch `/implement $0` by hand
  (documentation/launch-one-ticket.md). First, the human deletes the branch in «Left» or renames it.
  ```

- No commit, no merge.
- Keep the change for the human and leave the tree clean for the next launch:
  `git stash push -u -m "blocked #$0"`, then `git checkout <base>`. Name the stash in the comment.

## End

Finish with a summary of at most 5 lines: ticket, result, rounds, branch and merge commit if any.
