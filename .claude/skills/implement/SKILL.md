---
name: implement
description: Build one GitHub ticket end to end without the human - branch from the release branch, implement, run the automatic check, get the reviewer's verdict, retry at most once, then merge into the release branch or send the ticket to *Needs Human*. Use when the human, or the /run workflow, launches /implement with a ticket number.
argument-hint: <ticket number> [base branch]
disable-model-invocation: true
---

# /implement

One ticket in, one checked and reviewed change out, merged into the release branch. Nobody is watching: never
ask the human anything. When something is missing or unclear, stop as blocked (step 7) with the reason.

Ticket: `$0`. Project data is in `.claude/factory.md`: repo, main and working branch, board and its states,
labels, automatic check, documents language and where the backlog goes. The board commands (`move_card`, labels,
history) are in the file it names: use them from there. Base branch: `$1` if given, else the working branch.
Write GitHub comments in the documents language; code, commits and files follow `CLAUDE.md`.

## Hard limits

- Never touch the main branch: no checkout, merge or commit on it. Never push. If the base is the main branch,
  stop as blocked.
- Change only what the ticket asks. Anything else you notice goes in the final comment, not in the change.
- Do not delete evidence of a test (a temporary issue, branch or file) before the reviewer passes.
- The board always shows the real step: move the card at every step below, and never skip one.

## 0. Start

1. `git status --porcelain` must be empty. If not, stop as blocked («working tree not clean»).
2. Read `.claude/factory.md` and `CLAUDE.md`. No automatic check defined: stop as blocked. Never treat a missing
   check as passed.
3. `gh issue view $0 --json projectItems`: stop as blocked if its status on the board is *Needs Human*. Then
   `.../dependencies/blocked_by`: stop as blocked if any blocker is neither closed nor has the done label.
4. Set `round = 1`. The limit is 2 rounds in total, counting failures of both the check and the reviewer.

## 1. Branch

`git checkout -b ticket/$0-<short-slug> <base>`. Move the card to *In Progress*.

## 2. Build (you are the Builder)

- Read the ticket and the plan sections it cites. Nothing else is in scope.
- If the project has tests, write the failing test first for each checkbox it can cover, then make it pass.
- For a checkbox that leaves no trace in git or GitHub, note `command → output` for the final comment.
- If a checkbox asks for something written outside the code (a comment on the ticket, a note), produce it now,
  during the build, so the reviewer can find it.
- From round 2: fix exactly what failed (the check output or the reviewer's «Para el Builder»), nothing more.

## 3. Automatic check

Move the card to *Verify*. Run every command of the automatic check with `<base>` replaced.
- All exit 0: go to step 4.
- Any fails: no commit and no reviewer. If `round = 1`: `round = 2`, card to *In Progress*, back to step 2 with the
  failing output. If `round = 2`: blocked (step 7) with the failing command and its output.

## 4. Review

Move the card to *In Review*. Launch the `reviewer` subagent with: ticket `$0`, the repo, base `<base>`, the
uncommitted change in the current directory, and from round 2 its previous verdict word for word.
- `VEREDICTO: PASA`: go to step 5.
- `VEREDICTO: FALLA`: if `round = 1`: `round = 2`, card to *In Progress*, back to step 2 with «Para el Builder».
  If `round = 2`: blocked (step 7) with the verdict.

## 5. Commit and merge

1. Stage only the files of the change (`git add <paths>`, never `-A`). Commit on the ticket branch: subject in
   the documents language ending in `(#$0)`, plus the attribution line Claude Code gives you.
2. `git checkout <base>`, `git merge --no-ff ticket/$0-<slug> -m "Fusiona ticket/$0-<slug> en <base> (#$0)"`.
3. Move the card to *Verify* and run the automatic check again on the base. If it fails:
   `git revert -m 1 --no-edit HEAD` and blocked (step 7).
4. Add the done label and move the card to *Done*.

## 6. Report on the ticket

One `gh issue comment $0`, in the documents language, with this shape. It does not repeat what step 2 already
published for a checkbox:

```text
/implement · <PASA y fusionado en <base> | no fusionado>
Vueltas: <round>/2
Comprobación: <cada comando → resultado>
Revisor: <veredicto final, una línea por casilla>
Pruebas sin rastro en GitHub: <command → output> | ninguna
Fuera del ticket (para el backlog): <lo visto> | nada
```

## 7. Blocked

- Move the card to *Needs Human* (state id in `.claude/factory.md`, by URL as the board commands file says).
- Post the step 6 comment with the reason (the literal failing output or verdict), and these three lines after
  `Revisor:`:

  ```text
  Parado en: <construcción | comprobación | revisor | fusión>
  Queda: <rama y stash, por nombre | nada>
  Para relanzar: sacar la tarjeta de *Needs Human* (documentation/github-board.md) y lanzar `/implement $0` a mano
  (documentation/launch-one-ticket.md). Antes, el humano borra la rama de «Queda» o le pone otro nombre.
  ```

- No commit, no merge.
- Keep the change for the human and leave the tree clean for the next launch:
  `git stash push -u -m "blocked #$0"`, then `git checkout <base>`. Name the stash in the comment.

## End

Finish with a summary of at most 5 lines: ticket, result, rounds, branch and merge commit if any.
