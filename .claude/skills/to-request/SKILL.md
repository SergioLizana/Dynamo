---
name: to-request
description: Write the spec closed in the current conversation (usually right after /discover) with the request template and save it as a file in documentation/, deciding nothing new. Use when the human runs /to-request in the same session as /discover.
argument-hint: [short-slug for the file name]
disable-model-invocation: true
---

# /to-request

Turn what was already agreed in this conversation into a spec file that `/to-tasks` can split. Talk to the human
in Spanish; the spec is written in Spanish too (working documentation).

This is synthesis, not an interview: do not ask the human to decide anything. You write down decisions, you never
make them.

## 1. Gather the source

- The source is the current conversation: the idea, the facts checked in the repo and the decisions closed in
  `/discover`.
- If the conversation has no idea to write down (no `/discover`, nothing agreed), say so and stop. Do not invent one.
- If a fact the spec relies on can be checked in the repo (a file exists, a command works), check it before writing
  it. A fact you cannot check goes to «Notas» as unverified.

## 2. Fill the template

Read `.claude/templates/request.md` and fill every section, in its order, without adding or removing sections:

- **Problema**, **Solución** and **Qué cambia para quien lo usa**: from the point of view of the person who uses it,
  not of the code.
- **Decisiones**: only the ones closed in the conversation, one per line with its reason. Do not add a decision
  that was not taken, even if it looks obvious.
- **Cómo se prueba**: commands or readings that show it works, as agreed. If none was agreed, write «Sin acordar»
  and add it to «Notas» as pending.
- **Fuera de alcance**: what the conversation left out. If nothing was said, «Nada acordado».
- **Notas**: links, facts checked in the repo, and every open question.

Anything that was discussed but **not closed** goes to «Notas» as `Pendiente: <la duda>`, never into «Decisiones»
or «Solución». If two things said in the conversation contradict each other, write both under «Notas» as pending;
do not pick one.

No code, no file layouts, no ticket split: that is `/to-tasks`'s job.

## 3. Save the file

- Path: `documentation/spec-<slug>.md`. The slug is `$0` if given, else 2-4 lowercase words from the idea,
  joined with `-`.
- If the file already exists, do not overwrite it: tell the human and stop.
- Write only that file. Do not commit, create issues or touch other files.

## 4. Hand over

Tell the human, in at most 5 lines:
- the path of the file;
- how many items went to «Notas» as pending (if any, they should be closed before splitting);
- the next step, literally: `/to-tasks documentation/spec-<slug>.md`.
