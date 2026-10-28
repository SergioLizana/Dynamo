# Local plumbing for two `/implement` at once

Tested on 2026-10-26 with Claude Code 2.1.310 on Windows 11 (Git Bash), from the branch of ticket #17
(which starts from `release/0.1.0`, `7297184`), for ticket #17. Options of plan §6.3; the decision is for `/run`
(stage 3a). The probes used Haiku and minimal tasks: the costs are useful to compare, not to budget with.

Starting fact that changes everything: `main` is at `cc2dc46`, 30 commits behind `release/0.1.0`, and **it has no
`.claude/`** (no `settings.json`, no skills, no `reviewer`).

## 1. Subagent with `isolation: worktree`

Command: the `Agent` tool with `isolation: "worktree"` (the same option as `isolation: worktree` in the header of
`.claude/agents/<name>.md`; a new agent was not created because it requires restarting the session). Two at once, in the
background, from the main session in `auto` mode: one with no changes and one that creates a file.

What came out:

- Copies in `.claude/worktrees/agent-<id>/`, branch `worktree-agent-<id>`, both at `cc2dc46`: **they start from `main`**.
- The one with no changes did `git checkout release/0.1.0` and **git let it** (the main folder was on the ticket's branch).
  From that moment, neither another copy nor the main folder could check it out:
  `fatal: 'release/0.1.0' is already used by worktree at 'E:/Proyectos/Dynamo/.claude/worktrees/agent-abc7798c4809b0bdb'`
  (exit 128).
- That copy **was not deleted by itself** when it finished: it had changed branch, although it did not touch any file.
- The copy has no `.claude/` (`ls: cannot access '.claude'`), but the subagent applies the main session's permissions: its
  `git branch -D` (on the «ask» list) **surfaced as a prompt in the main session**, which `claude agents --json` showed as
  `"waitingFor": "permission prompt"`. The subagent waited until it was answered: 581 s, against 15 s for the one that did not
  ask for it. It did not notice: it reported «no permission prompt appeared».
- The copy of the one that created `probe-subagent-a.txt` **stays** on disk when it finishes, as research §3.2 says.
- Cost: the end notice gives tokens (`subagent_tokens` 34406 and 35954), duration and number of tools; **it does not give
  `total_cost_usd`**. It is included in the main session's cost.

## 2. `claude --bg`

Command, from `E:\Proyectos\Dynamo`:

```bash
claude --bg "<probe: pwd, create probe-bg.txt, ls .claude/settings.json, git branch -D <nonexistent branch>>" --model haiku
claude agents --json        # status
claude logs e1302cf7        # output
claude stop e1302cf7
```

What came out:

- Before writing, the session entered a copy by itself: `.claude/worktrees/probe-bg`, branch `worktree-probe-bg`, at
  `cc2dc46`: **it starts from `main`**, and the copy has no `.claude/settings.json`.
- Even so, it applied the project's permissions, because it read them at startup in the main folder: "Ask rule
  `Bash(git branch -D*)` overrides auto mode for this command".
- **It was left waiting**: `"status": "waiting", "waitingFor": "permission prompt", "state": "blocked"` until I stopped it.
  Nobody else finds out unless they look at `claude agents`.
- Cost: neither `claude agents --json` nor `claude logs` gives `total_cost_usd`.
- `claude stop` says `worktree retained at ...\probe-bg` and `run 'claude rm e1302cf7' to remove worktree and job state`:
  **it is not deleted by itself**; `claude rm` removes it (if it is safe).
- Its commit, push and draft PR at the end were not tested: the probe prohibited it and no push is made here without
  authorization.

## 3. `git worktree add` + `claude -p`

Commands (two at once, in the background):

```bash
git worktree add -b exp/17-a ../Dynamo-wt/t17-a release/0.1.0
git worktree add -b exp/17-b ../Dynamo-wt/t17-b release/0.1.0
cd ../Dynamo-wt/t17-a && claude -p "<probe>" --output-format json --model haiku --max-budget-usd 0.5 --permission-prompts none
```

What came out:

- Each copy on its branch and at `7297184`: **it starts from where you say**, here `release/0.1.0`, with its own `.claude/`.
- It applied `.claude/settings.json`: writing a file went through `Edit(/**)`; `git branch -D` (on the «ask» list) was denied
  instantly: "It requires approval, and this session has no approval surface … so it was denied automatically". It appears in
  `permission_denials` of the JSON. `git worktree list`, outside the list, ran (Claude Code treats read-only git commands as
  safe).
- **It does not wait**: with `--permission-prompts none` whatever would ask is denied.
- Cost: **yes**, `total_cost_usd` 0.0055 and 0.0056, `num_turns` 7, `subtype: success`.
- The copy is **not deleted by itself**: `git worktree remove` has to be run (as research §3.3 says).

## Summary

| | Subagent `isolation: worktree` | `claude --bg` | `git worktree add` + `claude -p` |
|---|---|---|---|
| Copy's branch | `main` (`fresh`) | `main` (`fresh`) | the one given (`release/x.y.z`) |
| `.claude/settings.json` | the main session's | yes, that of the launch folder; the copy does not have it | yes, the copy's own |
| Waits for a permission | yes, in the main session | yes, "Needs input" until someone answers | no: it is denied |
| `total_cost_usd` | no (tokens only) | no | yes |
| Deleted by itself | only if nothing changes, not even the branch | no (`claude rm`) | no (`git worktree remove`) |

`worktree.baseRef: "head"` would make the first two start from the current branch (research §3.3); it was not tested here.
Even so, they would still not give the cost per ticket and would still wait for permissions.

## How two copies merge into the same `release/x.y.z`

`/implement` does `git checkout <base>` to merge (step 5). Git does not let one branch be checked out in two working copies
at once, and it is enough for one of them to have it for the others, **including the main folder**, to fail with exit 128
(tested above). With two `/implement` as they are, the second one to reach step 5 would be blocked.

How it is resolved without inventing anything:

- The copies **never** check out the base. The branches live in the same repository, so each copy sees the base without
  `fetch`: before finishing, `git merge <base>` into its ticket branch and the check is run again (plan §7).
- Only one place has the base checked out and merges: the main folder, where `/run` runs. It merges **one at a time**
  (`git merge --no-ff ticket/<n>-<slug>`) and runs the check after each merge.
- If it clashes, `git merge --abort` and the ticket is blocked. Tested in `exp/17-base`: `exp/17-a` went in (exit 0);
  `exp/17-b` gave `CONFLICT (add/add): Merge conflict in probe-p.txt` (exit 1) and `git merge --abort` left the base clean.

For that, `/implement` inside a copy has to end at the commit on its branch and not merge. Changing that is work for `/run`
(#18), not for this ticket.

## Pocock's `implement-spec`

Read at `raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/implement-spec/SKILL.md` on 2026-10-26.

What it solves:

- The same split as above: each implementer in its copy and its branch; **before finishing it merges the tip of the
  integration branch into its own**; a separate *merger subagent* puts each result into the integration branch.
- That the copy starts from `main`: the implementer "confirms its worktree is based on the integration branch before
  starting, and resets onto it if not".
- The frontier: it launches new implementers when a merge changes it. It cleans up the copies at the end.

What it does not solve:

- Clashes when merging or tickets that fail: it does not say what to do (plan §4 already noted it).
- Check after each merge: there is only one `code-review` at the end.
- Cost per ticket: it uses subagents, which do not give `total_cost_usd`.
- Unattended permissions: background subagents wait in the main session.
- That the merger does not check out the base in a copy: it does not say where it runs.

## Recommendation for `/run`

**`git worktree add <copy> <base>` + `claude -p`**, one per ticket, and the merge in series in the main folder.

- It is the only one that starts from `release/x.y.z` without configuring anything and brings in that branch's `.claude/`.
- It is the only one that does not wait (`--permission-prompts none`) and gives `total_cost_usd` per ticket, which
  `documentation/launch-one-ticket.md` already uses.
- The cost: `/run` creates and deletes the copies (`git worktree add` / `git worktree remove`) and waits for two processes.
  They are two git commands, not a custom script.
- The other two: subagents start from `main`, give no cost and wait in the main session; `--bg` starts from `main`, is left
  at "Needs input", and its end asks for a push and a PR, which are not done here without authorization.
