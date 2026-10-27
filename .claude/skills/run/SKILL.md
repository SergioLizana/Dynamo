---
name: run
description: Run up to two ready GitHub tickets at once - pick open tickets whose blockers are done, launch /implement for each in its own git worktree with claude -p, merge each result into the release branch, clean the worktrees and report result, rounds and cost per ticket. Use when the human runs /run.
argument-hint: [base branch] [issue numbers...]
disable-model-invocation: true
---

# /run

Two tickets at a time, each built by `/implement` in its own working copy. N = 2 and no more. You do not build
anything yourself and you do not read the implementers' transcripts: their state lives in the tickets.

Base: `$1` if it starts with `release/`, else the `release/x.y.z` named in `CLAUDE.md`. If the base is `main`, stop.
Candidates: the issue numbers given as arguments, else every open issue (`gh issue list --state open`). Repo, labels
and board commands are in `documentation/github-board.md`. Why this plumbing and not another:
`documentation/parallel-launch-trial.md`. Talk to the human and on GitHub in Spanish.

## 1. Pick

For each candidate, lowest number first, `gh issue view <n> --json state,labels` and its blockers
(`.../issues/<n>/dependencies/blocked_by --jq '.[]|{number,state}'`, plus each open blocker's labels). Leave it out,
with the reason, if:
- it is closed;
- it has `hecho-en-release` («ya hecho») or `bloqueado` («bloqueado: lo mira el humano»);
- a blocker is open and without `hecho-en-release` («espera a #m»);
- two are already picked («fuera por N = 2»).

Two ready tickets never depend on each other: a blocker that is not done makes its ticket not ready. No ticket
picked: show the list of reasons and stop.

Show the human the picked tickets and every one left out with its reason, then go on without asking.

## 2. Prepare

`<dir>` is a folder next to the repository: `<parent of the repo>/<repo name>-run`. For each picked ticket `<n>`:

```bash
git branch <base>-t<n> <base>                     # landing branch for this ticket
git worktree add --detach <dir>/t<n> <base>
```

Why the landing branch: `/implement` checks out the branch it merges into, and git lets a branch be checked out in
only one copy. Each copy merges into its own `<base>-t<n>`; step 4 brings both into `<base>`.

## 3. Launch

Both at once: one Bash call per ticket with `run_in_background`, from its copy:

```bash
cd <dir>/t<n> && MSYS_NO_PATHCONV=1 claude -p "/implement <n> <base>-t<n>" --output-format json \
  --max-budget-usd 5 --permission-mode auto --permission-prompts none > <dir>/<n>.json
```

`MSYS_NO_PATHCONV=1` keeps Git Bash from turning `/implement` into a path; elsewhere it does nothing. Wait for both
notifications. Do not poll and do not read the transcripts.

Then, per ticket:
- From `<dir>/<n>.json`: `num_turns`, `total_cost_usd`, `subtype`. Post them as `/implement` expects
  (`documentation/launch-one-ticket.md`):
  `gh issue comment <n> --body "Métricas de /implement: <num_turns> turnos · <cost, 2 decimals> USD · <subtype>"`.
- Rounds: the `Vueltas:` line of the last comment starting with `/implement ·`.
- No JSON, invalid JSON, or no `hecho-en-release` and no `bloqueado` label: the session ended without finishing.
  Add `bloqueado` and comment «/run · la sesión terminó sin informe: <subtype or error>».

## 4. Land

One ticket at a time, lowest number first, only those with `hecho-en-release`:

1. The folder for the merge is the one that has `<base>` checked out (`git worktree list`). If none has it,
   `git worktree add <dir>/base <base>`. Its tracked tree must be clean (`git status --porcelain
   --untracked-files=no`); if not, merge nothing and report it.
2. There: `git merge --no-ff <base>-t<n> -m "Fusiona <base>-t<n> en <base> (#<n>)"`.
3. On conflict: `git merge --abort`, remove `hecho-en-release`, add `bloqueado`, card to *Verify*, and
   `gh issue comment <n>` with «/run · choca al fusionar en <base>:» and the conflicting files.

## 5. Clean

For each copy, after step 4:
- If `git -C <copy> status --porcelain` is not empty: `git -C <copy> stash push -u -m "run #<n>"` (the stash is
  shared with the main folder) and name it in the report.
- `git worktree remove <copy>`.
- From the step 4 merge folder: `git -C <merge folder> branch -d <base>-t<n>` for the landing branches merged in
  step 4 (`-d` checks against that folder's branch, `<base>`). Keep the others and name them.
- `git worktree remove <dir>/base` if step 4 created it.
- Delete `<dir>/<n>.json` and the empty `<dir>`.
- `git worktree list` must not show anything under `<dir>`. If it does, say so in the report.

## 6. Report

To the human, in Spanish:

```text
/run · <base> · <n picked> tickets
| Ticket | Resultado | Vueltas | Turnos | Coste |
| #<n> | hecho-en-release, o bloqueado: <motivo> | <x>/2 | <num_turns> | <USD> |
Fuera: #<m> <motivo>, …
Copias: ninguna en git worktree list | <lo que quede>
Ramas que quedan: ticket/<n>-… | <base>-t<n> si no se fusionó | stash «run #<n>»
```

Out of this skill (stage 3b): a frontier that grows as tickets merge, tests after each merge, skipping the dependents
of a blocked ticket, the PR against `main`, stopping at usage limits, N above 2.
