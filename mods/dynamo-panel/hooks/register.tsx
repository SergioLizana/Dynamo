// The «Dynamo» pane (documentation/orchestrator-review.md §5, phase 2): a pane beside the chat with one row per ticket of
// the run, and below it the blocked and the skipped tickets with their reason. It reads one command, `dynamo status
// --json`, every few seconds; it runs nothing else and writes nothing, so closing it leaves the run as it was.
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { PanelView } from '../types'
import { REFRESH_MS, STATUS_COMMAND, rowText, viewOf } from './view.ts'

const PANE = 'dynamo'
// Change the tag when the view's fields change: it declines what an earlier version stored, which outlives a reload.
const view = atom({ plugin: 'dynamo-panel', key: 'view' } as const, null, { shape: 'view-1' })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'dynamo-panel', description: 'Open the «Dynamo» pane: the tickets of the run' })

    const refresh = async () => {
      let latest: PanelView
      try {
        latest = viewOf(await $.process.run(STATUS_COMMAND))
      } catch (error) {
        latest = viewOf(error instanceof Error ? error : new Error(String(error)))
      }
      await update($, view, () => latest)
    }
    void refresh()
    $.clock.every(REFRESH_MS, () => void refresh())
    void $.ui.open({ id: PANE, title: 'Dynamo' })

    return next(e)
  })

  on('command.run', { command: 'dynamo-panel' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Dynamo' })

    return { text: 'Dynamo pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const current = await read($, view)

    if (current === null) return <Text dimColor>Reading the run…</Text>
    if (current.error !== null) return <Text color="red">{current.error}</Text>

    return (
      <Box flexDirection="column">
        {current.rows.length === 0 && <Text dimColor>No tickets in the run.</Text>}
        {current.rows.map(row => (
          <Text bold={row.running}>{rowText(row)}</Text>
        ))}
        {current.blocked.length > 0 && <Text bold>Blocked</Text>}
        {current.blocked.map(one => (
          <Text>{`#${one.ticket}: ${one.reason}`}</Text>
        ))}
        {current.skipped.length > 0 && <Text bold>Skipped</Text>}
        {current.skipped.map(one => (
          <Text dimColor>{`#${one.ticket}: ${one.why}`}</Text>
        ))}
      </Box>
    )
  })
}
