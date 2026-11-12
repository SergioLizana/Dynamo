---
name: to-tickets
description: Split an epic (or the conversation, or a spec file) into vertical-slice tickets with their blockers - a list of one when /dynamo:discover said one ticket, 5-8 otherwise - agree the list with the human, and only after explicit approval create them on the board, as sub-issues of the epic. Use when the human runs /dynamo:to-tickets with an epic, a spec path or nothing for the conversation.
argument-hint: <#epic | spec path | nothing for the conversation>
disable-model-invocation: true
---

# /dynamo:to-tickets

Turn a spec into tickets the human approves once. Talk to the human in the language their `CLAUDE.md` asks for;
ticket text in `project.documentsLanguage`. You plan the split, not the implementation: no designs, no code, no file
layouts.

Every project value (repo, labels) comes from the block `project` of `.claude/factory.json`, and the board's ids
from its block `board`, with their meaning in `${CLAUDE_PLUGIN_ROOT}/guides/factory.md`; the columns are Dynamo's and are named here. The
GitHub and board commands are in `${CLAUDE_PLUGIN_ROOT}/guides/github-board.md`. Read them before
step 5 and use the commands from there; do not copy ids into tickets. The ticket body is `${CLAUDE_PLUGIN_ROOT}/templates/ticket.md`.

## 1. Read the source

- **An epic** (`#n`, an issue with `project.epicLabel`): `gh issue view <n> -R <repo> --json number,title,state,labels,body,subIssues`.
  - If its «Notes» hold any `Pending:` item, stop: say which, and that each is closed first (`/dynamo:discover #<n>` for a
    pending block, in its own session). Do not split it.
  - If it already has sub-issues, list them: a rerun must not duplicate them.
  - The epic is the **parent** of every ticket of this list.
- **Another issue**: `gh issue view <n> -R <repo> --comments`, read as the spec; its tickets have no parent.
- **A path**: read the whole file; no parent.
- **Nothing**: use the current conversation. If `/dynamo:discover` said «one ticket», the list is of one; no parent. If there
  is no spec in the conversation either, ask for one and stop.

## 2. Check the repository

Before drafting, check facts instead of asking them:
- what already exists in the repo that the spec mentions;
- open issues that already cover part of the work (`gh issue list -R <repo> --state open --json number,title`). Do not
  duplicate them: a new ticket can be blocked by an existing one.
- whether the spec contradicts itself. If it does, ask about it among the step-4 questions; never pick a side
  silently.

## 3. Draft the tickets

Each ticket is a **vertical slice**:
- it delivers something that works end to end and can be checked on its own;
- it fits in one fresh context window;
- every acceptance checkbox can be checked with a command or by reading a file;
- No checkbox repeats the project's checks (`project.checks`, such as «the tests pass»): Verify already proves them.
- preparation work that makes later tickets easier goes first, in its own ticket.

A ticket says only **what to build and its checkboxes**: no file paths and no code, which go stale fast. The context
(problem, decisions and their why, how it is tested) stays in the epic, and the ticket points to it; do not repeat it.

Blockers: a ticket is blocked only by tickets that really gate it. No blocker means it can start at once. Never
propose a doubtful blocker (no «?»): if you are unsure, ask it among the questions in step 4 before approval.

Size: a list of one when `/dynamo:discover` said «one ticket»; 5-8 otherwise. If the spec needs more, propose only the
**first list** (the tickets that unblock the rest) and name the remaining work in one line per item as «next list»,
without creating it.

Level: each ticket gets one level of difficulty, `low`, `medium` or `high`, which decides the model and effort its
Builder and Reviewer run with. The criterion:
- `low`: text, styles or a single file, with no new logic;
- `medium`: new logic in a few files, with tests;
- `high`: several modules, design, or something delicate (security, data, money).

When in doubt between two levels, the one above. Judge each ticket by its own size, not by the epic's.

Scope: only what the spec asks. Anything else you notice is not a ticket: mention it so the human can put it in
the backlog.

## 4. Propose and iterate

Show the list before creating anything, as a numbered list (no table: it breaks in the terminal):

```text
N1. <Title>
    Blocked by: — | N2, #3
    Level: low | medium | high
    What it delivers: <one or two lines>
    Done when:
    - [ ] <checkbox>
    - [ ] <checkbox>
```

Keep each line under ~70 characters: longer lines get cut in the terminal.

New tickets are `N1, N2…`; `#n` is only for issues that already exist. Then ask (in the language you talk to the
human in):
- Is the size right (too big or too fine)?
- Is each blocker real?
- Is each level right? The human can change any of them here; they can also edit the `Level:` line of a created
  ticket before launching it.
- Anything to merge or split?

Adjust and show the full list again after each change. **Create nothing until the human explicitly approves the
list**: an explicit yes to this list, in any language. If the answer is ambiguous, ask. Approval of an earlier
version does not cover a changed list.

## 5. Create the issues

Only after approval. First check that no open issue already has the same title (a rerun after a failure must not
duplicate). Then, in dependency order (blockers first), for each ticket:

1. `gh issue create -R <repo> --title "<title>" --body-file - --project "<board.boardName>"`, plus
   `--parent <epic>` when there is one (if the shell rewrites a title that starts with `/`, see the board commands
   file). The body is the template filled in: Problem, What it delivers, Acceptance criteria as checkboxes, Blocked
   by with real numbers (each `Nk` replaced by the `#n` it got, or «None.»), Out of scope, and the «Spec» line: the
   epic (`#<n>`), else the section of the document the spec points at, or the spec file; and the `Level:` line with the
   level the human approved in the list, as `Level: low`, `Level: medium` or `Level: high`. No labels unless the human gave one on
   approval.
2. Move the card to the column *Todo* (the issue lands on the board with no status; see the board commands
   file).
3. Add each blocker as a native «blocked by» relation (the API needs the blocker's internal id, not its number).

If a command fails, stop. Report what was created and what was not; do not retry blindly.

## 6. Verify and report

Read back from GitHub, not from memory. For each created issue: number, title, link, parent
(`gh issue view <n> -R <repo> --json parent`), blockers from `.../dependencies/blocked_by`, and board status from that
issue alone (`${CLAUDE_PLUGIN_ROOT}/guides/board-guide.md`: never list the board). Show it as a table and flag any mismatch with the
approved list.

If the list came from the conversation, `/dynamo:discover` said «one ticket» and its summary names an idea issue
(«Idea: #<n>»), close that idea once the ticket is created and read back, if it carries `project.ideaLabel` (otherwise
close nothing and say so): `gh issue close <n> -R <repo> --reason completed --comment "Turned into work: #<ticket>"`.
Read it back (`gh issue view <n> -R <repo> --json state,stateReason`).

Do not close, edit or relabel existing issues, the epic among them. The one exception is that idea.
