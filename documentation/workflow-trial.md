# Trial: a workflow instead of `/run`

Tested on 2026-10-27 with Claude Code 2.1.311 on Windows 11 (Git Bash), from `release/0.1.0` (`d4a1a26`). Reason:
launching each ticket with `claude -p` works, but it cannot be seen in the console while it runs. A dynamic workflow was
tried (plan §6.3; research §3.6) as the orchestrator of stage 3a, in three trials on test branches and tickets, since deleted.

## What was configured

- `"worktree": { "baseRef": "head" }` in `.claude/settings.json`: the subagents' copies start from the current checkout, not
  from `main` (`d4a1a26`).
- Workflows enabled in `/config`. On the Pro plan they come off and they advise fewer than 5 agents per run.
- Exception in `CLAUDE.md` to "no own scripts" for the workflow scripts.

## How the script worked

A "dumb" orchestrator: the script only decides what is due and launches agents. The state comes from GitHub and from what
the agents return.

1. **Frontier:** an agent reads in GitHub the state, the labels and the native blockers of the tickets.
2. **Build:** for each ready ticket, an agent in its own copy (`isolation: 'worktree'`). It creates `ticket/<n>-…`, moves the
   card, does the ticket, passes the automatic check and commits. It never checks out the base and never merges.
3. **Review:** our subagent (`agentType: 'reviewer'`) reviews the ticket's branch against the base, without checking it out.
4. **Merge:** an agent in the main folder, **one at a time** (a queue in the script): `git merge --no-ff`, check again (if it
   fails, `git revert`), label, card and comment. If the ticket did not pass, the label `bloqueado`.
5. The cap of 2 rounds, the wait for blockers and the skipping of the dependents of a blocked ticket are in the script's code,
   not in a skill.

## Results

| Trial | Tickets | Model | Agents | Subagent tokens | Calls | Duration | Result |
|---|---|---|---|---|---|---|---|
| 1 | #22 | the session's | 3 | ~92,000 | 26 | 1 min 54 s | merged in 1 round |
| 2 | #23-#26 (#24 ← #23, #26 ← #25) | Opus, `effort: low` | 17 | ~470,000 | 133 | 5 min 53 s | all 4 merged; #24 and #25 in 2 rounds |
| 3 | #27 (impossible), #28 ← #27 | Haiku, `effort: high` | 6 | ~196,000 | 48 | 2 min 50 s | #27 blocked, #28 skipped |

No run asked for a permission or pushed. `main` and `release/0.1.0` were not touched.

## Verified

- **The copy starts from the base, with `.claude/`:** in the three trials `startHead` matched the tip of the base and
  `hasSkills: true`. In trial 2, the second round of #24 started at `23fcbd3`, which already had the merge of #25.
- **Our `reviewer` inside the workflow:** with `agentType: 'reviewer'` it returned its exact format («VERDICT: PASS», as
  «VEREDICTO: PASA» in Spanish at the time; checkboxes with evidence; «Out of the ticket: none»). In trial 2 it detected the
  typo placed on purpose.
- **Two at once:** #23 and #25 moved to *In Progress* at 11:14:14 and 11:14:15.
- **Blockers respected:** #24 started at 11:16:10, after the *Done* of #23 (11:15:29); #26 at 11:17:28, after #25 (11:16:41).
- **Second round:** the history of #24 says `In Review -> In Progress -> Verify -> In Review -> Verify -> Done`.
- **Serial merge:** four `--no-ff` merges in a row in the main folder, each with its check.
- **Block and skip:** #27 ended with `blocked` and its card in *Verify*, where it stopped, and a comment with the literal reason.
  #28 received "skipped: depends on #27, which did not reach the release" and stayed in *Todo* with no label.
- **Visible in the console:** `/workflows` shows phases, agents, their calls, their result and each one's tokens.

## Script failures, to fix when it is really written

1. **It did not clean up everything.** The merge agent only removed the copy of the last round. Copies of earlier rounds
   were left, and about 17 branches (`ticket/…-prueba-*`, `worktree-wf_*`). Deleting branches is on `ask`, so inside the
   workflow it would ask the human.
2. **Dirty history in the second round.** Bringing in round 1's work with `git merge` leaves commits "Merge branch … into
   worktree-wf_…". With `git cherry-pick <base>..<round 1 branch>` the history is linear, but only if round 1 made a commit:
   with the empty range it fails (`error: empty commit set passed`, trial 3).
3. **A second round that does no good.** When the Builder says the ticket contradicts itself and needs the human, repeating
   fixes nothing. That case should block directly.
4. **Unchecked claims.** The comment on #27 said its copy was still on disk; Claude Code had deleted it by itself when it
   finished without changes. With `effort: low`, an agent gave the merge commit as "HEAD of …" instead of the sha.
5. **Compound commands.** In an isolated copy, Claude Code rejects chained commands ("too complex to verify that it stays
   inside the worktree"). The agents split them and went on, but the `move_card` function of `documentation/github-board.md`
   does not work there: the commands have to be given in single-command form with `--url`.
6. **The script does not run commands.** Reading the board, checking and merging are done by agents that report the exit code.
   The checks stop being commands that nobody can falsify: they rely on what the agent says.

## Compared with `claude -p` (trial of #17)

- **Advantages:** it is visible in `/workflows`; the loop and the cap are in code; the orchestrator does not spend context; in
  an interactive session it waits for the usage limit instead of failing (research §3.6).
- **Disadvantages:** it gives no cost in USD, only tokens; the permissions are the session's, with no separation per agent; a
  permission that is needed is asked of the human and the run waits.

## Not tested yet

- A clash when merging (`git merge --abort` and blocked) and a check that fails after merging (revert).
- A permission requested in the middle of the run.
- A pause at the usage limit and resumption after closing the session.
- Real tickets, longer than creating a one-line file.

## Recommendation

Replace `/run` with a workflow saved in `.claude/workflows/`, with the design above and failures 1-5 fixed. `/implement` stays
for launching one ticket by hand in a normal session.
