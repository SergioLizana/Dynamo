---
name: to-request
description: Write the spec closed in the current conversation (usually right after /discover) with the request template and save it as a file where `.claude/factory.md` puts specifications, deciding nothing new. Use when the human runs /to-request in the same session as /discover.
argument-hint: [short-slug for the file name]
disable-model-invocation: true
---

# /to-request

Turn what was already agreed in this conversation into a spec file that `/to-tasks` can split. Talk to the human
in the language their `CLAUDE.md` asks for; write the spec in the documents language of `.claude/factory.md`.

This is synthesis, not an interview: do not ask the human to decide anything. You write down decisions, you never
make them.

## 1. Gather the source

- The source is the current conversation: the idea, the facts checked in the repo and the decisions closed in
  `/discover`.
- If the conversation has no idea to write down (no `/discover`, nothing agreed), say so and stop. Do not invent one.
- If a fact the spec relies on can be checked in the repo (a file exists, a command works), check it before writing
  it. A fact you cannot check goes to "Notes" as unverified.

## 2. Fill the template

Read `.claude/templates/request.md` and fill every section, in its order, without adding or removing sections:

- **Problem**, **Solution** and **What changes for the user**: from the point of view of the person who uses it,
  not of the code.
- **Decisions**: only the ones closed in the conversation, one per line with its reason. Do not add a decision
  that was not taken, even if it looks obvious.
- **How it is tested**: commands or readings that show it works, as agreed. If none was agreed, write "Not agreed"
  and add it to "Notes" as pending.
- **Out of scope**: what the conversation left out. If nothing was said, "Nothing agreed".
- **Notes**: links, facts checked in the repo, and every open question.

Anything that was discussed but **not closed** goes to "Notes" as `Pending: <the doubt>`, never into "Decisions"
or "Solution". If two things said in the conversation contradict each other, write both under "Notes" as pending;
do not pick one.

No code, no file layouts, no ticket split: that is `/to-tasks`'s job.

## 3. Save the file

- Path: the specifications path of `.claude/factory.md`, with `<slug>` filled in. The slug is `$0` if given, else
  2-4 lowercase words from the idea, joined with `-`.
- If the file already exists, do not overwrite it: tell the human and stop.
- Write only that file. Do not commit, create issues or touch other files.

## 4. Hand over

Tell the human, in at most 5 lines:
- the path of the file;
- how many items went to "Notes" as pending (if any, they should be closed before splitting);
- the next step, literally: `/to-tasks <the path of the file>`.
