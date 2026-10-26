---
name: to-tasks
description: Split a spec into a list of 5-8 vertical-slice tickets with their blockers, agree the list with the human, and only after explicit approval create them as GitHub issues on the board. Use when the human runs /to-tasks with a spec path, an issue or the current conversation.
argument-hint: <spec path | issue number | nothing for the conversation>
disable-model-invocation: true
---

# /to-tasks

Turn a spec into tickets the human approves once. Talk to the human in Spanish; ticket text in Spanish too
(working documentation). You plan the split, not the implementation: no designs, no code, no file layouts.

GitHub commands, project ids and board states live in `documentation/tablero-github.md`. Read it before step 5 and
use the commands from there; do not copy ids into tickets. The ticket body is `.claude/templates/ticket.md`.

## 1. Read the source

- A path: read the whole file.
- An issue number or URL: `gh issue view <n> --comments`.
- Nothing: use the current conversation. If there is no spec there either, ask for one and stop.

## 2. Check the repository

Before drafting, check facts instead of asking them:
- what already exists in the repo that the spec mentions;
- open issues that already cover part of the work (`gh issue list --state open`). Do not duplicate them: a new
  ticket can be blocked by an existing one.

## 3. Draft the tickets

Each ticket is a **vertical slice**:
- it delivers something that works end to end and can be checked on its own;
- it fits in one fresh context window;
- every acceptance checkbox can be checked with a command or by reading a file;
- preparation work that makes later tickets easier goes first, in its own ticket.

Blockers: a ticket is blocked only by tickets that really gate it. No blocker means it can start at once. Never
propose a doubtful blocker (no «?»): if you are unsure, ask it among the questions in step 4 before approval.

Size: 5-8 tickets per list. If the spec needs more, propose only the **first list** (the tickets that unblock the
rest) and name the remaining work in one line per item as «siguiente lista», without creating it.

Scope: only what the spec asks. Anything else you notice is not a ticket: mention it so the human can put it in
`documentation/despues.md`.

## 4. Propose and iterate

Show the list before creating anything, as a numbered list (no table: it breaks in the terminal):

```text
N1. <Título>
    Bloqueado por: — | N2, #3
    Qué entrega: <una o dos líneas>
    Hecho cuando:
    - [ ] <casilla>
    - [ ] <casilla>
```

New tickets are `N1, N2…`; `#n` is only for issues that already exist. Then ask:
- ¿El tamaño es el adecuado (demasiado grande o demasiado fino)?
- ¿Cada bloqueo es real?
- ¿Algo que juntar o partir?

Adjust and show the full list again after each change. **Create nothing until the human explicitly approves the
list** («apruebo», «adelante», «sí, créalos»). If the answer is ambiguous, ask. Approval of an earlier version does
not cover a changed list.

## 5. Create the issues

Only after approval. First check that no open issue already has the same title (a rerun after a failure must not
duplicate). Then, in dependency order (blockers first), for each ticket:

1. `gh issue create --title "<título>" --body-file - --project "Dynamo"` (in Git Bash, a title starting with `/`
   needs `MSYS_NO_PATHCONV=1`; see the note), with the body filled from the template:
   Problema, Qué entrega, Criterios de aceptación as checkboxes, Bloqueado por with real numbers (each `Nk`
   replaced by the `#n` it got, or «Nada.»),
   Fuera de alcance, and the spec reference. No labels unless the human gave one on approval.
2. Move the card to *Todo* (the issue lands on the board with no status; see the note).
3. Add each blocker as a native «blocked by» relation (the API needs the blocker's internal id, not its number).

If a command fails, stop. Report what was created and what was not; do not retry blindly.

## 6. Verify and report

Read back from GitHub, not from memory. For each created issue: number, title, link, blockers from
`.../dependencies/blocked_by`, and board status from `gh project item-list`. Show it as a table and flag any
mismatch with the approved list.

Do not close, edit or relabel existing issues, and do not touch a parent issue.
