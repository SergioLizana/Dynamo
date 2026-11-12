---
name: discover
description: Talk an idea (or a block an epic left pending) through with the human, check facts in the repository instead of asking them, and close every decision in rounds of questions; end with one of three results - one ticket (/dynamo:to-tickets), one spec or several specs (/dynamo:to-spec). Use when the human runs /dynamo:discover with an idea or an epic's issue number.
argument-hint: "[the idea, in a few words | #epic]"
disable-model-invocation: true
---

# /dynamo:discover

Turn a loose idea into closed decisions that the next skill can write down. Talk to the human in the language their
`CLAUDE.md` asks for. Every project value (repository, labels) comes from `.claude/factory.json`, with
its meaning in `${CLAUDE_PLUGIN_ROOT}/guides/factory.md`.

You do not write specs and you do not create tickets: that is `/dynamo:to-spec` and `/dynamo:to-tickets`. Write no files, no issues
and no commits; the result lives in this conversation.

## 1. Understand the start

- The start is `$ARGUMENTS`. If it is empty, ask for the idea in one line and wait.
- **An issue number** (`#n` or `n`): an epic with a block left pending. Read it with
  `gh issue view <n> -R <repo> --json number,title,state,labels,body`. If its body names the epic it came from
  (`Parent: #<n>`), read that one's title and body too.
  - What those epics decided is settled: state it as given, never ask it again. Only the pending block you are asked
    about is open: its item in «Notes» says what is left to decide and what it depends on.
  - If the issue is closed, does not carry `project.epicLabel`, or has no pending block, say what it is and ask
    whether to go on.
  - **An idea** (the issue carries `project.ideaLabel`): it is the start, not an epic. Take it as the idea without
    asking whether to go on (if it is closed, say so and ask); its title and body are the idea to restate. Keep its
    number: step 4's summary names it as «Idea: #<n> <two or three lines>», so `/dynamo:to-spec` and
    `/dynamo:to-tickets` can close it.
- Read `CLAUDE.md` and the documents it points at that the idea touches. Ideas that those documents put out of
  scope, or that `CLAUDE.md` says belong in the backlog, go there: say so and stop unless the human insists.
- Restate the idea in two or three lines: the problem, for whom, and what changes for them. Ask if that is right.

## 2. Check facts before asking

Facts are your job; decisions are the human's.

- Before every question, ask yourself whether the repository, `gh` or a command can answer it: does a file exist,
  what does the code or a skill actually do, is there an open issue that covers it (`gh issue list -R <repo> --state open --json number,title`).
  If it can, check it and state the fact with its source (`path:line`, command → output). Never ask it.
- Check in this session, reading only what you need: `grep`, a part of a file, `gh` with `--json` and only the fields
  you need. A subagent starts with its own base context and costs more than a small check: use one only for a check
  that has to read a lot of code.
- When the human says how something works, check it. If the repo disagrees, show both and ask which one is right.
- A fact you cannot check is marked as unverified, never presented as true.

## 3. Close the decisions in rounds

Think of the idea as a tree of decisions: each one opens the ones that hang from it.

- **Frontier:** the open decisions whose prerequisites are already settled. Ask the whole frontier in one round,
  and nothing that depends on a question still open in that round.
- Number each question and give your recommended answer, worded so that a «yes» accepts it. Write the labels in
  the language you talk to the human in (the examples are in English):

  ```text
  P1 · <title>: <the question, with the options if there are any>
  → Recommended: <answer>
  ```

- Keep each line under ~70 characters: longer lines get cut in the terminal.
- Wait for the answers. Then recompute the frontier and ask the next round.
- Vague or overloaded words: propose one precise term and ask the human to confirm it («is "task" the ticket or
  the checkbox?»). Use the agreed term from then on.
- Test the boundaries with a concrete scenario when a rule is unclear («if the reviewer fails twice, what does the
  human see?»).
- Keep scope tight: anything that appears on the way and is not needed for this idea goes to a "for the backlog"
  list, not to the tree.
- **When the idea holds several parts**, its shape is a decision of the frontier (step 5 says the three results).
  With blocks (several specs), close what is common to every block and what each block carries; the human approves
  the blocks, their order and which block gates which. A block that would not fit in this conversation, or waits on
  something not known yet, is left pending: say what is left to decide in it and what it depends on, and it is closed
  later with `/dynamo:discover #<its epic>` in its own session.

The tree is done when the frontier is empty: every branch visited, nothing assumed in silence.

## 4. Summarise and confirm

Show, in the language you talk to the human in:

```text
Idea: [#<n> if it started from an idea issue] <two or three lines>
Facts checked: <fact → source>
Decisions: <one per line, with its reason>
Pending: <doubt> | none
Out of scope: <what was left out> | none
For the backlog: <what was seen on the way> | none
```

With blocks, «Decisions» splits into the common ones and one group per block, in the approved order, each block with
what gates it. A block left pending goes under «Pending» as `Block <name>: <what is left to decide>; depends on <…>`.

Ask the human to confirm it is the shared understanding. Fix it until they confirm. Do not go on with anything
listed as pending, except a whole block left pending on purpose: close it or move it out of scope first.

## 5. Decide the next step

Say exactly one of the three results, with its reason in one line:

- **"One ticket"** when the whole idea is one vertical slice: it works end to end, fits one fresh context window,
  every acceptance check is a command or a file read, and it needs no decision written down for later.
  Next step: `/dynamo:to-tickets` with this conversation (no argument); the summary of step 4 is its source.
- **"One spec"** when it is several slices, has blockers between its parts, or holds decisions a later session must
  read. Next step: `/dynamo:to-spec`, in this same session.
- **"Several specs"** when it holds blocks, each one a spec of its own. Next step: `/dynamo:to-spec` in this same session,
  which writes one epic per block, and keeps each block left pending as a pending item of the epic that carries the
  common decisions.

If in doubt between one ticket and a spec, choose the spec.

## 6. Hand over

In a short summary: the result, the next step, and how full the context is. Recommend going on (the default: `/dynamo:to-spec`
writes from this conversation, not from a summary of it) or, if the context is nearly full, `/compact` with an
instruction to keep the summary of step 4. Do not run the next skill yourself: the human launches it.
