# Backlog

Ideas and risks that come up along the way and do not become a ticket unless a real problem asks for them (plan §8.1).
Each entry says where it comes from and what has been verified.

## Protect `main`

- **Origin:** review of #4 (2026-10-26). The deny list in `.claude/settings.json` stops `git push` and `gh api -X/--method`,
  but `gh api <path> -f …` makes an implicit POST, and `gh api graphql` accepts mutations: an unattended run could write
  to `main` through the API.
- **Verified:** with the Free plan and a private repository, GitHub does not allow protecting branches or creating rules:
  `gh api repos/SergioLizana/Dynamo/branches/main/protection` → `403 Upgrade to GitHub Pro or make this repository
  public`; `.../rulesets` gives the same.
- **Options:** GitHub Pro; or the agents use a fine-grained token with *Contents* read-only (the agents do not need to
  write code to GitHub: they merge locally), and *Issues* and *Projects* with write access. Not checked whether a
  fine-grained token can write to a user Project.
- **Why not a separate `git-ops` agent with more permissions** (considered 2026-10-26): the `deny` rules apply to the whole
  session, subagents included, so one cannot deny something to the Builder and allow it to another agent without a
  custom hook; the rules on Bash are not a barrier (the Builder can call `git` from another program), and no agent needs
  to push: they merge locally. The real cut is in the credentials of the unattended run:
  - `gh`: the fine-grained token above, passed as `GH_TOKEN` only in the launch command;
  - `git push`: uses the system credential manager, not `GH_TOKEN`; to remove it from that run, empty `credential.helper`
    with environment variables (`GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_0`, `GIT_CONFIG_VALUE_0`).
  - Neither one is checked. It is not complete isolation either (an agent with Bash in the same user could reach the
    credential manager): only a container gives that (plan §7 and §10.4).
- **When:** before leaving unattended lists running (stage 3).
- **Different permissions per agent** (checked in `code.claude.com/docs/en/sub-agents.md` on 2026-10-27): the header of a
  subagent accepts `tools`, `disallowedTools`, `permissionMode` and `hooks`. It does not accept its own `allow` or `deny`
  rules: the ones in `settings.json` apply to the whole session, subagents included. `disallowedTools` removes the whole
  tool (`Bash(git push *)` removes all of Bash) and `permissionMode` is ignored if the session is in `auto`, like our
  `-p`. The only thing that filters commands agent by agent is a `PreToolUse` hook in its header, which only runs while
  that agent is active. It works to trim (a Builder without push), never to give an agent more than the session has. It is
  a good-faith barrier, like `deny`, and it would be a custom command that has to work on Linux, macOS and Windows. Try it
  only when a ticket needs to split permissions between agents.
- **Push to `release/x.y.z`** (considered 2026-10-26): today `git push` is in `ask` (in a normal session it asks; in `-p`
  it is denied). It is not moved to `allow` because no ticket needs it (it merges locally), and a rule such as
  `Bash(git push origin release/*)` would also let through `git push origin release/0.1.0:main`, with nothing in GitHub to
  stop it. It will be needed in stage 3b, when `/run` uploads the release to open the PR against `main`: decide it then,
  together with the credentials (a token that only pushes `release/*`) or GitHub Pro.

## A separate identity for the agents

- **Origin:** review of #4. Everything the agents do (comments, labels, ticket edits) goes out under the name
  `SergioLizana`: GitHub does not distinguish what the human did from what an agent did.
- **Options:** a machine account (conditions for this type of account on GitHub not checked) or a GitHub App. A
  fine-grained token of the own account limits what the agent can do, but does not change the author.

## Working copies that start from `main`

- **Origin:** tests of #17 (2026-10-26). `main` is at `cc2dc46` and has no `.claude/` (`git ls-tree main .claude` comes out
  empty). The copies of a subagent with `isolation: worktree` and of `claude --bg` start there: they work without skills,
  without `settings.json` in the copy and without the `reviewer`, and on old code.
- **Verified:** the three test copies of those two options were at `cc2dc46`. The permissions did apply, but those of the
  session that launched them, not those of the copy.
- **Why `main`:** it is the default of `worktree.baseRef` (`"fresh"`, the main branch of the remote), not the current
  checkout (research §3.3). The human expected them to start from the branch checked out (2026-10-27).
- **Options:** `worktree.baseRef: "head"` (not tested); or not use them and create the copies with `git worktree add`, which
  is what `documentation/parallel-launch-trial.md` recommends. The mismatch closes by itself when the release reaches
  `main`.
- **When:** only if `/run` ends up using isolated subagents or `--bg`.
- **Resolved 2026-10-27:** `worktree.baseRef: "head"` in `.claude/settings.json` (`d4a1a26`). Tested in the trials of
  `documentation/workflow-trial.md`: the copies started from the tip of the base, with `.claude/`.

## `.claude/worktrees/` outside `.gitignore`

- **Origin:** tests of #17. The copies that Claude Code creates show up as `?? .claude/worktrees/` in
  `git status --porcelain`.
- **Risk:** a `git add -A` would put them in a commit. `/implement` already forbids `-A`, and a dirty `git status` blocks
  it in step 0.
- **When:** if a copy ends up in a commit or blocks a launch.

## `git worktree` permissions for `/run`

- **Origin:** tests of #17. `git worktree add` and `git worktree remove` are not in `.claude/settings.json`; in a normal
  session the `auto` mode decided them. With `claude -p --permission-prompts none` they would be denied if the mode does
  not approve them.
- **When:** when writing `/run` (#18), which needs them to create and delete the copies.

## Automatic deletion of subagent copies, unseen

- **Origin:** review of #17. The table in `documentation/parallel-launch-trial.md` says that a subagent's copy is deleted by
  itself "if nothing changes, not even the branch". It comes from the documentation (research §3.2): in the tests no copy
  was deleted by itself, because both had changes or had changed branch.
- **When:** if `/run` ends up depending on that cleanup.

## Label with the version instead of `hecho-en-release`

- **Origin:** the human, 2026-10-27. `hecho-en-release` does not say which version the ticket is in.
- **Options:**
  - a) Rename it to `in-release`.
  - b) One label per version, `release-x.y.z` (GitHub allows dots in the name). `/implement` and the `/run` frontier would
    have to search for a pattern (`release-*`) and not a fixed name, and the label has to be created when each version
    opens.
  - c) A *milestone* `0.1.0`, which GitHub provides for this: one per issue, with a progress bar and a filter on the
    board. But "is in the version" is not "already merged": the card in *Done* or a label would still be needed for the
    latter.
- **Where it is used today:** `.claude/skills/implement/SKILL.md` (steps 0 and 5), `.claude/skills/run/SKILL.md`, plan §6.5
  and `documentation/github-board.md`.
- **Not checked:** how the board filters by milestone.

## *Blocked* and *Closed* columns on the board

- **Origin:** the human, 2026-10-27, on finding #21 (test ticket of #18) closed but with its card in *Todo*. He wants to
  see on the board, without opening each ticket, when he has to step in.
- **Resolved (the *Blocked* part):** #36 adds the *Needs Human* column: a stuck ticket ends there, and `/implement` and the
  `run` workflow move the card. The *Closed* column stays open; it is not part of this ticket.
- **What clashed (already resolved):** plan §6.5 said that a stuck ticket carries the `bloqueado` label, and `/implement`
  (step 7) left the card at the step where it stopped.
- **Not checked:** whether the project's built-in flow ("Item closed") can move the card to *Closed* by itself when the
  issue is closed. In the history of #21 there is a `Todo -> Closed` and a `Closed -> Todo` on 2026-10-26 at 23:46 that
  nobody has explained, with no *Closed* option existing.

## Splitting `/implement` into several agents

- **Origin:** the human, 2026-10-27: it is often read that each phase of a factory has its own agent, and there are
  orchestrators that are a skill launching subagents (like Pocock's `implement-spec`).
- **How it is now:** the Builder is the `/implement` session itself (with `-p`, a new session per ticket); *Verify* is the
  commands of "Automatic check", with no model, so that it does not depend on what one answers; *Review* is the `reviewer`
  subagent, with its own context and read-only. `/run` is the orchestrator and launches one `claude -p` per ticket
  (recommendation of #17: it gives cost per ticket and does not wait for permissions).
- **Verified:** a subagent can launch its own up to three levels below the main session (subagent documentation,
  2026-10-27).
- **Data:** from #14 to #16, 13-17 turns and 0.49-0.86 USD per ticket. The only extra round (#15) came from the order of
  the steps, not from mixing phases.
- **Signal to do it:** the Builder runs out of context on large tickets, or there are rounds because the Builder judges
  itself. Before that, read research §3 and §7 on separating phases.

## File references in this repository when it becomes a plugin

- **Origin:** conversation of 2026-10-26. The skills name files that exist only here:
  `documentation/launch-one-ticket.md` (`/implement`, only as a reference), `CLAUDE.md` (automatic check) and
  `documentation/github-board.md` (board ids and commands).
- **When:** in stage 4, when the skills are taken out into a plugin for another project.
- **Resolved 2026-10-27:** the project data is in `.claude/factory.md`, and the skills and the `reviewer` read it from there
  (#30 and #31).

## `/to-request` takes free text as the file name

- **Origin:** use on 2026-10-27. `/to-request` expects a short name as an argument (`$0`). A list of pending items was
  passed to it and `$0` became "Sigue": the file would have been called `spec-Sigue.md`. The name was taken from the idea
  by hand.
- **When:** the next time `/to-request` is touched.

## Notes from tickets #15 and #16

- **Origin:** final comments of #15 and #16 (2026-10-26).
- `/to-tasks` without an argument accepts the `/discover` summary as the specification: not tested in real use.
- `/to-request` writes "Nothing agreed" in an empty section, and the `request.md` template uses "None".
- #16 added two things that no checkbox asked for (sending ideas to `backlog.md` and the limit of ~70 characters per
  line), and the reviewer said PASS: watch whether the reviewer lets through what goes beyond the ticket.
