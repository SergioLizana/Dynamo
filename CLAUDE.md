# CLAUDE.md — Dynamo

Dynamo is a personal agent factory for Claude Code: it turns ideas into tickets and lets agents build, test and review
them until they open a PR that a person approves. Private repository.

- Design: `documentation/agent-factory-plan.md` (read it before proposing anything).
- Supporting research: `documentation/agent-factory-research.md` (consult it by section, not in full).
- Status: stage 2 (the unit). The stages are in the plan, §8.

## How we work

- The factory is built with the factory: by hand only `/to-tasks`, `/implement` and the `reviewer`; the rest, as tickets
  (plan §8).
- «Complete» is fixed in plan §8.1 and does not move. On reaching it, the factory moves to a real project.
- Nothing is added without a real problem that asks for it. Ideas that come up go to `documentation/backlog.md`, not to
  a ticket.
- Each skill, at most about 150 lines. If a skill needs more, other files are created and the skill refers to them. No
  own scripts while Claude Code can solve it with an option.
  Exception: workflow scripts (`.claude/workflows/`), which Claude Code runs.
- Measured from the first ticket: turns per ticket, and cost per list (when a list ends, the session's `/cost` goes in
  the PR report). When a ticket is launched by hand, no turns or cost are recorded.

## Conventions

- Replies to the human are in the language set in their own `~/.claude/CLAUDE.md`, outside the repository. Everything
  in the repository is in English: skills, agents, code, documents, tickets, commits, GitHub comments and verdicts.
- Files in `documentation/` are named in English and written in English.
- The project data (repository, board and its states, labels, main and working branch, automatic check, document
  language, where the backlog and the specifications go) lives in `.claude/factory.md`. Skills and agents read it from
  there and do not name any of it.
- Skills in `.claude/skills/<name>/SKILL.md`; subagents in `.claude/agents/<name>.md`.
- LF line endings (`.gitattributes`).

## Limits

- Merging into a `release/x.y.z` branch is allowed without asking (ticket and integration branches are merged there).
- Only what the human approves reaches `main`: never merge or push to `main` without their explicit authorization.
- Pushing any other branch only with the human's authorization.
- Never secrets in git (keys, tokens, `.env`).
- Cadenza (`E:\Proyectos\cadenza`) is only a reference for texts: its code and structure are not copied.
