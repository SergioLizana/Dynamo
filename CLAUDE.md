# CLAUDE.md — Dynamo

Dynamo is a personal agent factory for Claude Code: it turns ideas into tickets and lets agents build, test and review
them until they open a PR that a person approves. Private repository.

- Design: `documentation/agent-factory-plan.md` (read it before proposing anything).
- Supporting research: `documentation/agent-factory-research.md` (consult it by section, not in full).
- Status: stage 2 (the unit); release 0.1.0 is frozen (tag `v0.1.0`) and 0.2.0 moves the loop from the workflow to a
  program of our own, `dynamo/`, in the phases of `documentation/orchestrator-review.md` (now phase 1, tickets
  #78-#84). The stages are in the plan, §8.

## How we work

- The factory is built with the factory: by hand only `/to-tasks`, `/implement` and the `reviewer`; the rest, as tickets
  (plan §8).
- «Complete» is fixed in plan §8.1 and does not move. On reaching it, the factory moves to a real project.
- Nothing is added without a real problem that asks for it. Ideas that come up go to `documentation/backlog.md`, not to
  a ticket.
- Measured from the first ticket: turns per ticket, and cost per list (when a list ends, the session's `/cost` goes in
  the PR report). When a ticket is launched by hand, no turns or cost are recorded.
- `.claude/workflows/` (`run.js`, `board.js`, `release-report.js`, `lib/read.js`) is frozen until phase 3: it is not
  changed, and `dynamo/` does not import it. What is needed from it is rewritten.

## Conventions

- Replies to the human are in the language set in their own `~/.claude/CLAUDE.md`, outside the repository. Everything
  in the repository is in English: skills, agents, code, documents, tickets, commits, GitHub comments and verdicts.
- Files in `documentation/` are named in English and written in English.
- The project data (repository, board and its states, labels, main and working branch, automatic check, document
  language, where the backlog and the specifications go) has its values in the `project` block of
  `.claude/factory.json`; `.claude/factory.md` keeps what each value means and how to change it and points to the JSON.
  Skills, agents and code read it from there and do not name any of it.
- Everything runs the same on Linux, macOS and Windows: no PowerShell, no command of a single system, paths with
  `node:path`, and no shell where a program can be run directly.
- LF line endings (`.gitattributes`).

## TypeScript code (`dynamo/`)

The program is plain Node with TypeScript run by type stripping: no build step, no dependencies, no `node_modules`.
It is built to grow over time without a rewrite, but nothing is written before a ticket needs it.

- **Erasable syntax only**, which plain `node` can run: no `enum`, `namespace` or constructor parameter properties;
  imports name the file with its `.ts` extension; types are imported with `import type`.
- **One responsibility per module.** The entry point `dynamo/dynamo.ts` only parses the subcommand, calls it and prints
  its result. Each subcommand is its own module; adding one changes only its files and the line that registers it.
- **Pure logic apart from the edges.** Decisions (the frontier, the report, the rounds) are pure functions: data in,
  data out, no gh, git or file system. The subcommand reads, calls the logic and writes.
- **Edges in one place each.** Only `dynamo/exec.ts` imports `child_process`; gh, git and `factory.json` have their own
  module (`gh.ts`, `git.ts`, `factory.ts`). A subcommand gets them as parameters, so a test can pass fakes.
- **No boilerplate per subcommand.** The JSON line, the exit codes (0 done, 1 failed, 2 called wrong) and argument
  errors live in shared helpers; a subcommand returns its result and never calls `process.exit` or `stdout.write`. A
  helper that is missing is added to the shared module, not copied into a subcommand.
- **Typed edges.** Inputs and outputs are typed; no `any`. What comes from outside (gh JSON, files) is `unknown` until a
  function checks its shape.
- **Small files.** At most 200 lines per file (tests aside); split by responsibility, not by size alone.
- **No speculative design.** No interface, abstract class or extension point with a single implementation
  (`documentation/orchestrator-review.md` §3.2): a TypeScript type of what is passed in is enough. Swapping a module
  later is a refactor, not a rewrite.
- **Comments** as in the existing files: one header per file saying what it is, and the why of anything not obvious.
- **Output stays short.** A subcommand prints one short JSON line; anything big goes to a file and the line names it.
  It never reads the whole board (see «The board»).

## Tests

- `node --test dynamo/tests/` runs every `*.test.ts` of the folder; it is part of the automatic check
  (`project.checks`).
- Tests first, one per checkbox they can cover. Pure functions are tested directly, with no process.
- Never the network or the real gh: the fake gh (`dynamo/tests/fake-gh.ts`, through `DYNAMO_GH`) answers, and the tests
  run with no gh on the PATH. git is tested on a temporary repository.
- Test files go only in the temp folder through `scratch()` (`dynamo/tests/helpers.ts`), which the hook allows.

## Skills and agents

- Skills in `.claude/skills/<name>/SKILL.md`; subagents in `.claude/agents/<name>.md`.
- Front matter of a skill: `name`, `description` (what it does, then «Use when …»), `argument-hint`, and
  `disable-model-invocation: true` when only the human launches it. Of an agent: `name`, `description`, `model`, and
  `tools` or `effort` when they matter.
- Each skill, at most about 150 lines. If a skill needs more, other files are created and the skill refers to them.
- Written as numbered steps the agent can follow alone: every stop says where it goes and what it reports. An
  unattended skill never asks the human.
- A skill or agent names no project value: it reads them from `.claude/factory.json`, and takes the board commands
  from the file `project.boardCommands` names.
- Editing an agent needs a new session before it is tried: Claude Code does not reload it.

## The board

How to read and move tickets on the board, cheaply and without listing it: `documentation/board-guide.md`. Read it when
a task touches the board; the raw commands are in `documentation/github-board.md`.

## Limits

- Merging into a `release/x.y.z` branch is allowed without asking (ticket and integration branches are merged there).
- Only what the human approves reaches `main`: never merge or push to `main` without their explicit authorization.
- Pushing any other branch only with the human's authorization.
- Never secrets in git (keys, tokens, `.env`).
- Cadenza (`E:\Proyectos\cadenza`) is only a reference for texts: its code and structure are not copied.
