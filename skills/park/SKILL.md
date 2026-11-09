---
name: park
description: Park written tickets - move the card of each given ticket to the board's parking column with `dynamo card`, and say the result of each. Use when the human runs /dynamo:park <n...> for tickets that are written but must wait and not be built.
argument-hint: <n...> (one or more ticket numbers)
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dynamo/dynamo.ts" *)
disable-model-invocation: true
---

# /dynamo:park

A thin skill over `node "${CLAUDE_PLUGIN_ROOT}/dynamo/dynamo.ts" card`. It decides
nothing: the human gives the ticket numbers, `card` moves each card and checks it. Talk to the human in the language
their `CLAUDE.md` asks for. `card` prints one short JSON line and exits 0 (done), 1 (failed) or 2 (called wrong).

Run the command exactly as written, with nothing appended: the Bash tool already reports its exit code. A command with
something appended, such as `; echo "exit=$?"`, is no longer covered by `allowed-tools` and asks for permission.

## 1. Start

1. The parking column is *Backlog*: the board's columns are Dynamo's, fixed by the board template, so the skill names
   them. The repository, the board and its ids are read by `card` from `.claude/factory.json` (the blocks `project`
   and `board`), never written here.
2. Read the numbers from `$ARGUMENTS`: one or more ticket numbers, separated by spaces. If there is none, or something
   is not a number, **stop**, show the usage `/dynamo:park <n...>` and move nothing.

## 2. Park each ticket

For each number, one at a time, in the order given:

1. `node "${CLAUDE_PLUGIN_ROOT}/dynamo/dynamo.ts" card <n> Backlog`
   - Exit 0 with `moved: true`: the card was moved.
   - Exit 0 with `moved: false`: the card was already there; nothing was moved.
   - Exit 1 or 2: the card is not parked. Keep the literal line (its `error` says why).
2. A failure on one ticket does not stop the others: go on to the next number.

Never move a card by any other command, never edit a ticket, and never run `dynamo run`.

## 3. Report

Say the result of each ticket in one line: `#<n>` and «parked», «already parked» or «not parked» (with the `error`
of the line, word for word). Then remind the human, once, that bringing a ticket back to *Todo* is done by hand in
GitHub, by moving its card there: this skill does not do it.

## End

Finish with a short summary: how many tickets were parked, how many were already parked, how many failed,
and the reminder about *Todo*.
