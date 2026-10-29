import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'dynamo-panel',
  component: 'Pane',
  requestId: 'dynamo',
  props: { title: 'Dynamo', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

const status = {
  ok: true,
  rows: [{ ticket: 91, column: 'Review', round: 2, running: true, step: 'Grep needle', turns: 12, cost: 1.5 }],
  blocked: [{ ticket: 5, reason: 'Needs a decision' }],
  skipped: [{ ticket: 6, why: 'blocked by #5' }],
}

// Nothing sits beneath the plugin: each hook here stands for the engine.
test('the pane lists the tickets of `dynamo status --json`, the blocked and the skipped', async ($, on) => {
  const argvs: unknown[] = []
  on('command.register', () => ({ value: { command: 'dynamo-panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', (_, e) => {
    argvs.push(e.argv)
    return { value: { exitCode: 0, stdout: JSON.stringify(status), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  expect(argvs[0]).toEqual(['node', 'dynamo/dynamo.ts', 'status', '--json'])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /#91/ }))?.text).toBe('#91  Review  r2  (running) Grep needle  12 turns  $1.50')
  expect((await ui.find({ type: 'Text', text: /Needs a decision/ }))?.text).toBe('#5: Needs a decision')
  expect((await ui.find({ type: 'Text', text: /blocked by/ }))?.text).toBe('#6: blocked by #5')
  await ui.unmount()
})

test('a failing `dynamo status` is a line in the pane', async ($, on) => {
  on('command.register', () => ({ value: { command: 'dynamo-panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '{"ok":false,"error":"no log folder"}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /no log folder/ }))?.text).toMatch(/dynamo status failed/)
  await ui.unmount()
})
