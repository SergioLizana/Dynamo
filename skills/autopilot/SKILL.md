---
name: autopilot
description: Launch `dynamo run` for a ticket, a list of tickets, or every ticket ready, in the background, and give its JSON line when it exits. Use when the human runs /dynamo:autopilot with ticket numbers (or none, for everything ready).
argument-hint: "[ticket number ...] (none = every ticket ready)"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dynamo/dynamo.ts" *)
disable-model-invocation: true
---

# /dynamo:autopilot

A thin skill over `node "${CLAUDE_PLUGIN_ROOT}/dynamo/dynamo.ts" run [n ...]`. It decides
nothing: which tickets are ready, in what order, how many at once and when a ticket stops are `dynamo run`'s. Talk to
the human in the language their `CLAUDE.md` asks for.

`dynamo run` builds, checks, reviews and merges the tickets into the working branch, and writes the release report at
the end of the list. It never pushes and never opens or edits a PR.

Run the command exactly as written, with nothing appended: the Bash tool already reports its exit code. A command with
something appended, such as `; echo "exit=$?"`, is no longer covered by `allowed-tools` and asks for permission.

## 1. Launch

Run `node "${CLAUDE_PLUGIN_ROOT}/dynamo/dynamo.ts" run $ARGUMENTS` with the Bash tool, `run_in_background: true` and
`timeout: 7200000` (the maximum, two hours): a background command is stopped at its `timeout` too, and the default of 10
minutes does not hold a list. Pass the numbers the human gave as they are: one, a list, or none (then `dynamo run` takes everything ready). Do not read, filter, sort or
check them; a bad number is `dynamo run`'s to refuse, with exit 2.

Tell the human the list was launched and that you will report when it exits. Then wait for the notification that
the background command ended; do not poll it, do not loop on it, and do nothing else with the tickets meanwhile.

## 2. When it exits

Read the command's output and its exit code: 0 done, 1 failed or paused, 2 called wrong. Show the human the JSON line
`dynamo run` printed, word for word, with the exit code. Do not interpret it, retry the run or move any card: a ticket
that stopped is relaunched by the human as its comment says.

If the output has no JSON line, show what it has and say so. If the notification says the command was stopped at the
`timeout` of step 1, tell the human the list was cut off by the time limit, not that a ticket failed: launching the same
command again goes on from the phase each ticket was in. Do not launch it yourself.

## End

Finish with a short summary: the numbers passed (or «everything ready»), the exit code and the JSON line.
