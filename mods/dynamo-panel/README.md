# dynamo-panel

A Claude Code mod: a «Dynamo» pane beside the chat that shows the run. One row per ticket (column, round, the agent's last
step, turns, cost) and, below, the blocked and the skipped tickets with their reason. It refreshes every few seconds from
`node dynamo/dynamo.ts status --json` and reads nothing else; a failing `dynamo status` shows as a line in the pane.
`/dynamo-panel` opens it by hand. It only reads: closing it leaves the run untouched.

Try it from the repository: `claude --plugin-dir mods/dynamo-panel`. Packaging it in the plugin is phase 5.
