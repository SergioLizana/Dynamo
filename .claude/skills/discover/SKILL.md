---
name: discover
description: Talk a new idea through with the human, check facts in the repository instead of asking them, and close every decision in rounds of questions; end by saying whether it fits in one ticket (/to-tasks) or needs a spec (/to-request). Use when the human runs /discover with an idea.
argument-hint: [the idea, in a few words]
disable-model-invocation: true
---

# /discover

Turn a loose idea into closed decisions that the next skill can write down. Talk to the human in Spanish.

You do not write the spec and you do not create tickets: that is `/to-request` and `/to-tasks`. Write no files,
no issues and no commits; the result lives in this conversation.

## 1. Understand the idea

- The idea is `$ARGUMENTS`. If it is empty, ask for it in one line and wait.
- Read `CLAUDE.md` and the parts of `documentation/plan-factoria-de-agentes.md` the idea touches. Ideas that the
  plan puts out of scope, or that only fix how tickets are made without a measured failure (plan §8.1), belong in
  `documentation/backlog.md`: say so and stop unless the human insists.
- Restate the idea in two or three lines: the problem, for whom, and what changes for them. Ask if that is right.

## 2. Check facts before asking

Facts are your job; decisions are the human's.

- Before every question, ask yourself whether the repository, `gh` or a command can answer it: does a file exist,
  what does the code or a skill actually do, is there an open issue that covers it (`gh issue list --state open`).
  If it can, check it and state the fact with its source (`path:line`, command → output). Never ask it.
- When the human says how something works, check it. If the repo disagrees, show both and ask which one is right.
- A fact you cannot check is marked as unverified, never presented as true.

## 3. Close the decisions in rounds

Think of the idea as a tree of decisions: each one opens the ones that hang from it.

- **Frontier:** the open decisions whose prerequisites are already settled. Ask the whole frontier in one round,
  and nothing that depends on a question still open in that round.
- Number each question and give your recommended answer, worded so that «sí» accepts it:

  ```text
  P1 · <título>: <la pregunta, con las opciones si las hay>
  → Recomiendo: <respuesta>
  ```

- Keep each line under ~70 characters: longer lines get cut in the terminal.
- Wait for the answers. Then recompute the frontier and ask the next round.
- Vague or overloaded words: propose one precise term and ask the human to confirm it («¿"tarea" es el ticket
  o la casilla?»). Use the agreed term from then on.
- Test the boundaries with a concrete scenario when a rule is unclear («si el revisor falla dos veces, ¿qué ve
  el humano?»).
- Keep scope tight: anything that appears on the way and is not needed for this idea goes to a «para backlog.md»
  list, not to the tree.

The tree is done when the frontier is empty: every branch visited, nothing assumed in silence.

## 4. Summarise and confirm

Show, in Spanish:

```text
Idea: <dos o tres líneas>
Hechos comprobados: <hecho → fuente>
Decisiones: <una por línea, con su motivo>
Pendiente: <duda> | nada
Fuera de alcance: <lo que se dejó fuera> | nada
Para backlog.md: <lo visto por el camino> | nada
```

Ask the human to confirm it is the shared understanding. Fix it until they confirm. Do not go on with anything
listed as pending: close it or move it out of scope first.

## 5. Decide the next step

Say exactly one of the two results, with its reason in one line:

- **«Cabe en un ticket»** when the whole idea is one vertical slice: it works end to end, fits one fresh context
  window, every acceptance check is a command or a file read, and it needs no decision written down for later.
  Next step: `/to-tasks` with this conversation (no argument); the summary of step 4 is its source.
- **«Necesita especificación»** in any other case: several slices, blockers between parts, or decisions that a
  later session must read. Next step: `/to-request`, in this same session.

If in doubt, choose «necesita especificación». Do not run the next skill yourself: the human launches it.
