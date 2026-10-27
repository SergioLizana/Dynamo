## Problem
After building #14 to #18, some things remain to be closed before continuing with stage 3:
- launching tickets with `claude -p` works, but the human does not see in the console what is happening while it runs;
- the launch and some skills depend on Windows, and Dynamo will also be used on Ubuntu or on a Mac;
- the skills and the `reviewer` have Dynamo data written into them (repository, board, labels, paths, rules), and the
  factory is meant to be installed later in other projects, for example a website;
- `/implement` produces, after the review, what a checkbox asks for outside the code (a comment on the ticket), and that
  cost an extra round in #15;
- the file names in `documentation/` are literal translations that the human does not like.

## Solution
- Replace `/run` with a workflow saved in `.claude/workflows/`: a "dumb" orchestrator that reads the state in GitHub,
  launches one agent per ticket in its own copy, reviews with the `reviewer`, merges one at a time into the release and
  blocks or skips whatever gets in the way. It is the design tested in `documentation/workflow-trial.md`, with its
  failures 1-5 fixed.
- Portable skills, agents and workflow: they work on any operating system and carry no data of one project; that data goes
  in a separate file for each project.
- Launch one ticket by hand with a portable command and without JSON.
- What a checkbox asks for outside the code exists before the review.
- File names in English in `documentation/`, with the content in English as well.

## What changes for the user
- The human launches a list of tickets from a normal session and follows it in `/workflows`: phases, agents, their calls and
  their tokens.
- A single ticket is launched with the same command on any operating system.
- To use the factory in another project it is enough to fill in its data file (repository, board, branch, check, language…);
  the skills are not touched.
- A ticket with a checkbox "the comment says…" does not need a second round just because of the order of the steps.

## Decisions
- Skills, agents and documented commands work on any operating system, with no references to PowerShell: Dynamo will also be
  used on Ubuntu or on a Mac (the human, 2026-10-26).
- One ticket is launched per command when it is launched by hand; no loop for launching several is documented (the human,
  2026-10-26).
- The by-hand launch stops using `--output-format json`, so `jq` is not needed. By hand, no turns or cost are recorded, and
  that is said in the launch document and in `CLAUDE.md` (the human, 2026-10-27).
- The stage 3 orchestrator is a workflow, not `claude -p`: the human wants to see it in the console, and the three trials of
  `documentation/workflow-trial.md` approved it (the human, 2026-10-27).
- The workflow scripts are an exception to "no own scripts" (already in `CLAUDE.md`, 2026-10-27).
- The subagents' copies start from the current checkout: `worktree.baseRef: "head"` in `.claude/settings.json` (`d4a1a26`).
- Model per phase of the workflow: Haiku with `effort: high` to read the board, build and merge; the `reviewer` on Opus, the
  one that judges (the human, 2026-10-27).
- Cost: when a list ends, the session's `/cost` is recorded in the PR report; cost per list, not per ticket. `CLAUDE.md`
  ("measured from the first ticket") is adjusted to say so (the human, 2026-10-27).
- `.claude/skills/run/SKILL.md` is deleted in the same ticket in which the workflow works with real tickets: not two pieces
  doing the same thing (the human, 2026-10-27).
- If a checkbox asks for something that the Builder writes outside the code (a comment on the ticket, a note), it is produced
  during the build, before the review, and the final report does not repeat it. It is valid for `/implement` and for the
  workflow's agents, and it is written in general, not for Dynamo. In the workflow, the Build agent publishes that comment
  during its step and the merge agent publishes only the final report (the human, 2026-10-27).
- Each project's data (repository, board and its states, labels, working branch, check commands, language, where the backlog
  and the specifications go) goes in **a separate file**, not in `CLAUDE.md`. The skills, the `reviewer` and the workflow read
  it from there and do not name any of it; the `reviewer` applies the project's `CLAUDE.md` rules, without a fixed list.
  `CLAUDE.md` sets it as a convention. It is done now, together with the operating-system work (the human, 2026-10-27).
- In `/to-tasks`, the Git Bash note becomes a neutral sentence: "(if the shell rewrites a title that starts with `/`, see the
  note)"; the Windows detail stays in the board note (the human, 2026-10-27).
- The plan and the backlog stop naming Windows where it is not needed: "the system task scheduler (cron, launchd or Windows')"
  and "the system credential manager". The "Windows" risk of plan §7 stays (the human, 2026-10-27).
- The `E:\Proyectos\…` paths in `CLAUDE.md` and in the plan stay: they belong to this PC and no skill uses them (the human,
  2026-10-27).
- File names in `documentation/` in English, content in English, and `CLAUDE.md` says so (the human, 2026-10-27):
  - `plan-factoria-de-agentes.md` → `agent-factory-plan.md`;
  - `investigacion-factorias-de-agentes.md` → `agent-factory-research.md`;
  - `tablero-github.md` → `github-board.md`;
  - `lanzar-implement.md` → `launch-one-ticket.md`;
  - `fontaneria-paralelo.md` → `parallel-launch-trial.md`;
  - `ensayo-workflow.md` → `workflow-trial.md`;
  - `peticion-*.md` → `spec-*.md`, also the prefix that `/to-request` uses;
  - `backlog.md` does not change.
- The project data file is `.claude/factory.md`, next to the skills, so that it travels with the plugin when it is taken out
  (the human, 2026-10-27).
- The language with the human is a preference of the person, not a project datum: it goes in their `~/.claude/CLAUDE.md` (the
  human, 2026-10-27).
- #17 and #18 are not reviewed separately: they are valid with the PASS of their reviewer (the human, 2026-10-27).
- The batch of #14 to #16 counts toward "3 tickets in a row without intervention" of stage 2, with the launch failure noted
  (the skill was not launched as a skill because of the `/` in Git Bash). The stage closes when the `release/0.1.0` PR is
  approved (the human, 2026-10-27).

## How it is tested
- The tickets of this specification are built with the new workflow, as soon as it exists: it is its first test with real
  tickets.
- Each ticket, in addition, with its checkboxes checkable with a command or by reading a file.

## Out of scope
Nothing agreed.

## Notes
- Facts checked in the repository (2026-10-27):
  - The trials and their failures are in `documentation/workflow-trial.md`. Not tested yet: a clash when merging, a check that
    fails after merging, a permission asked in the middle of the run, a pause at the usage limit, and real tickets.
  - Dynamo data written into the pieces: `reviewer.md:8` («Dynamo agent factory») and `:42-43` (fixed rules: "each skill at
    most ~150 lines", "working docs in Spanish"); `to-tasks/SKILL.md:77` (`--project "Dynamo"`); paths
    `documentation/github-board.md`, `documentation/backlog.md` and `documentation/launch-one-ticket.md` in `implement`,
    `to-tasks`, `run` and `discover`; labels `in-release` and `bloqueado` in `implement` and `run`; "in Spanish" in all of
    them.
  - References to an operating system:
    - `.claude/skills/to-tasks/SKILL.md:77-78` (Git Bash and `MSYS_NO_PATHCONV=1`);
    - `.claude/skills/run/SKILL.md:50,54` (`MSYS_NO_PATHCONV=1` and Git Bash);
    - `documentation/launch-one-ticket.md:8-12` (PowerShell, `ConvertFrom-Json`, `E:\Proyectos\Dynamo`);
    - plan §6.3, §7 and §10.3 (`documentation/agent-factory-plan.md:208,274,282,374`);
    - `documentation/backlog.md` («Protect `main`»: Windows credential manager);
    - `documentation/github-board.md:46-47` (Git Bash note);
    - `documentation/parallel-launch-trial.md` and `documentation/workflow-trial.md` say they were tested on Windows: they are
      the record of a test.
  - Passing the prompt through standard input keeps the `/` (tested on Windows with Git Bash:
    `printf '/zz-no-existe hola' | claude -p` → "The command `/zz-no-existe` is not installed"). Not tested yet on Linux or
    macOS.
  - #15 took 2 rounds because step 6 of `/implement` publishes the comment that a checkbox asked for after the verdict. History:
    `Verify -> In Review -> In Progress -> Verify -> In Review`.
  - The plan (§6.4) foresaw taking the skills out into a plugin in stage 4; the entry "File references in this repository when it
    becomes a plugin" in `documentation/backlog.md` is covered by this specification.
  - A workflow gives tokens per agent, not cost in USD.
  - `~/.claude/CLAUDE.md` is outside the repository: a checkbox about it cannot be checked with `git diff`.
