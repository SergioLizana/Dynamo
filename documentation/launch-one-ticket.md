# Launching /implement without intervention

`/implement` runs unattended with `claude -p`: nobody answers the permission prompts, so whatever is not allowed is
denied. The permissions are in `.claude/settings.json` (allow list and deny list; the deny wins). What is in neither list
is decided by the `auto` mode; with `--permission-prompts none`, whatever would ask is denied.

One ticket per command, from the repository root and with a clean tree (`12` is the ticket number):

```bash
printf '/implement 12' | claude -p --max-budget-usd 5 --permission-mode auto --permission-prompts none
```

- The prompt goes through standard input: this way the `/` reaches `claude` unchanged and the skill is launched as a
  skill. Passed as an argument, some consoles rewrite it as a path.
- Cost cap per ticket: 5 USD to start; adjusted after the first 3 tickets (plan §10.6).
- Several tickets are launched one at a time, with one command each.

## Measurement

By hand, no turns or cost are recorded: the command does not ask for JSON output and the session does not know its own
cost. `/implement` leaves the rounds on the ticket. The cost is measured per list: when one ends, the session's `/cost`
goes in the PR report.

## Where it was tested

Tested on 2026-10-27 with Claude Code 2.1.311 on Windows 11 (Git Bash), with the same options:
`printf '/zz-no-existe hola' | claude -p --max-budget-usd 0.2 --permission-mode auto --permission-prompts none` →
"The command `/zz-no-existe` is not installed in this session": the `/` reaches `claude`. On Linux and macOS it is not
tested yet.
