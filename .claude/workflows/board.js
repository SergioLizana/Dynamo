export const meta = {
  name: 'board',
  description: 'Read the board and the tickets: for each ticket its card, whether it is ready and why not (a blocker not done, Needs Human, done); the run workflow calls it as a child at its start',
  whenToUse: 'The human runs /board (no args: every open ticket; or ticket numbers, as /run takes them) to see what a run would find; the run workflow calls it at its start',
}

// The start of a run as a workflow of its own: data in, data out, and no decision about the run. A workflow script cannot
// read a file or run a command, and everything that crosses the `runner` is copied by hand, so nothing big crosses it: the
// command .claude/workflows/lib/read.js reads GitHub and git where the data is, stores what is big in a file, and prints ONE
// SHORT LINE per call, each followed by its own hash and length so that a character the runner changed is caught
// (documentation/launch-list.md, «The start» and «Long text and the runner»). The script reads `.claude/factory.json` as parts
// of one line each, then, in a second `runner` call, the state of the main folder and the tickets (one line for the totals),
// then one line for each ticket, eight commands to a call.
// Every list is checked against its total, so nothing is cut off silently. The rules of which tickets a run builds (done,
// Needs Human, blockers) stay in run.js; the table below only shows them (documentation/launch-list.md, «The start»).
// Alone: args is empty, ticket numbers ("38", "38 43", "38,43", 38, [38, 43]) or { tickets, base }; it returns the table.
// As a child of run.js (`workflow({ scriptPath }, args)`, same args as /run): it returns the parsed factory.json, the base,
// the tickets as GitHub gave them (their labels cut down to «has the done label»), and the problem of the main folder (null
// if it is ready for a run), which run.js decides on. Both ways return all of it. Helpers are the same as run.js: a child
// workflow cannot import.

const LIB = '.claude/workflows/lib/read.js'
const GROUP = 'Start'
const PER_CALL = 8 // commands to one `runner` call
const TRIES = 3

// ---------- Helpers ----------

const CHECKS = {
  type: 'array',
  items: {
    type: 'object',
    required: ['command', 'exitCode', 'output'],
    properties: { command: { type: 'string' }, exitCode: { type: 'integer' }, output: { type: 'string' } },
  },
}
const RUN_SCHEMA = { type: 'object', required: ['results'], properties: { results: CHECKS } }
const NO_OUTPUT = '(Bash completed with no output)'
const resultsOf = r => r && Array.isArray(r.results)
  ? r.results.map(x => x && String(x.output).trim() === NO_OUTPUT ? { ...x, output: '' } : x)
  : null
const loose = s => String(s).replace(/['"\s]/g, '')
const oneLine = (s, max = 300) => {
  const x = String(s).replace(/\s+/g, ' ').trim()
  return x.length > max ? `${x.slice(0, max - 1)}…` : x
}

// The fingerprint is `cksum`'s (POSIX): "<crc> <length in bytes>". The command prints it after every line it prints.
const CRC_TABLE = Array.from({ length: 256 }, (_, i) => {
  let c = i << 24
  for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1
  return c >>> 0
})
function cksum(bytes) {
  let crc = 0
  for (const b of bytes) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ b) & 255]) >>> 0
  for (let n = bytes.length; n > 0; n = Math.floor(n / 256)) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ (n & 255)) & 255]) >>> 0
  return `${(~crc) >>> 0} ${bytes.length}`
}
const ascii = s => Array.from(String(s), ch => ch.charCodeAt(0))

// Exact text through the `runner` (run wf_c3e19634-96a): every command is plain ASCII with no escape sequence in it.
const plainProblem = c => {
  const bad = String(c).match(/[^\x20-\x7e]|\\u[0-9a-fA-F{]|\\x[0-9a-fA-F]{2}/)
  return bad ? `«${oneLine(c, 120)}» has «${bad[0]}»` : null
}

// The line the command printed, if it is exactly the text it fingerprinted: { kind, ...fields } with the values decoded
// (they are percent-encoded), or null. An `error` line has the reason in `reason`.
function lineOf(output) {
  const t = String(output).replace(/\r/g, '').trim()
  const m = /^([\x20-\x7e]+) (\d+ \d+)$/.exec(t)
  if (!m || cksum(ascii(m[1])) !== m[2]) return null
  const [kind, ...rest] = m[1].split(' ')
  const fields = { kind }
  for (const tok of rest) {
    const at = tok.indexOf('=')
    if (at < 1) return null
    try { fields[tok.slice(0, at)] = decodeURIComponent(tok.slice(at + 1)) } catch (e) { return null }
  }
  return fields
}

// Base64 back to text: { text } or { error }. The line breaks are ignored; the rest must be exact.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function fromBase64(encoded) {
  const s = String(encoded).replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return { error: 'it has characters that are not base64' }
  if (s.length % 4 !== 0) return { error: `its length (${s.length}) is not a multiple of 4: characters were lost or added` }
  const bytes = []
  for (let i = 0; i < s.length; i += 4) {
    const v = [0, 1, 2, 3].map(k => (s[i + k] === '=' ? 0 : B64.indexOf(s[i + k])))
    const n = (v[0] << 18) | (v[1] << 12) | (v[2] << 6) | v[3]
    bytes.push((n >> 16) & 255)
    if (s[i + 2] !== '=') bytes.push((n >> 8) & 255)
    if (s[i + 3] !== '=') bytes.push(n & 255)
  }
  let text = ''
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i]
    if (b < 0x80) { text += String.fromCharCode(b); i++; continue }
    const need = b >= 0xc2 && b <= 0xdf ? 1 : b >= 0xe0 && b <= 0xef ? 2 : b >= 0xf0 && b <= 0xf4 ? 3 : 0
    if (!need) return { error: `byte ${i} is not valid UTF-8` }
    let cp = b & (0x3f >> need)
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k]
      if (c === undefined || (c & 0xc0) !== 0x80) return { error: `the UTF-8 sequence at byte ${i} is cut or broken` }
      cp = (cp << 6) | (c & 63)
    }
    if (cp < [0, 0x80, 0x800, 0x10000][need] || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return { error: `the UTF-8 sequence at byte ${i} is not a valid character` }
    text += String.fromCodePoint(cp)
    i += need + 1
  }
  return { text }
}

const optsOf = step => {
  const o = {}
  if (step && step.model) o.model = step.model
  if (step && step.effort) o.effort = step.effort
  return o
}
let LIM = null // { maxCommand, maxOutput, maxLine }: known after the read of factory.json
let SMALL = {} // the model and effort of the script's small agents (factory.json, `small`): known after the same read
async function runList(label, commands) {
  const off = commands.map(plainProblem).find(Boolean)
  if (off) throw new Error(`a command is not plain ASCII: ${off}`)
  const long = LIM && commands.find(c => c.length > LIM.maxCommand)
  if (long) throw new Error(`a command is longer than ${LIM.maxCommand} characters (${long.length}): ${oneLine(long, 120)}`)
  const r = await agent(`Run these commands, in this order:
${commands.map((c, i) => `${i + 1}. ${c}`).join('\n')}`,
  { ...SMALL, agentType: 'runner', label, phase: GROUP, schema: RUN_SCHEMA })
  return resultsOf(r)
}
// A null read is plumbing: it is asked once more.
const runListRetry = async (label, commands) => (await runList(label, commands)) || (await runList(`${label}:retry`, commands))

// The line the command printed as the result at `i` of a call, or null: the runner ran the command it was given, and the
// line is exactly what the command fingerprinted. An `error` line explains why a command failed; it is a line too.
const lineAt = (rs, i, command) => (rs && rs[i] && loose(rs[i].command) === loose(command) ? lineOf(rs[i].output) : null)

// One line for each of `wanted` (a list of keys), PER_CALL commands to a call, the calls in parallel; a line that is not
// right (the hash does not match, another command ran, the line is not the one asked for) is asked again, three tries in all.
// `command(key)` is the command, `accept(key, line)` says whether the line is the answer to it. Returns { lines, error }:
// lines by key, and the first `error` line the command printed (a failure the command explains), or null.
async function readLines(label, wanted, command, accept) {
  const lines = {}
  let error = null
  for (let attempt = 1; attempt <= TRIES && !error; attempt++) {
    const todo = wanted.filter(k => !lines[k])
    if (!todo.length) break
    const calls = []
    for (let i = 0; i < todo.length; i += PER_CALL) calls.push(todo.slice(i, i + PER_CALL))
    await Promise.all(calls.map(async (call, c) => {
      const commands = call.map(command)
      const rs = await runList(`${label}${attempt > 1 ? `:again${attempt}` : ''}:${c + 1}`, commands)
      call.forEach((k, j) => {
        const line = lineAt(rs, j, commands[j])
        if (!line) return
        if (line.kind === 'error') { error = error || line.reason; return }
        if (accept(k, line)) lines[k] = line
      })
    }))
  }
  return { lines, error }
}

// ---------- factory.json ----------

// What a run needs from factory.json; the reason it is invalid, or null. That every phase has a function is run.js's to check.
function checkFactory(f) {
  const str = v => typeof v === 'string' && v.length > 0
  const opt = v => v === null || str(v)
  if (!f || typeof f !== 'object') return 'it is not a JSON object'
  const pr = f.project
  if (!pr || typeof pr !== 'object') return 'project is missing: it holds the project data (repo, branches, board, check, documents)'
  for (const k of ['repo', 'mainBranch', 'workingBranch', 'boardOwner', 'boardId', 'boardName', 'statusFieldId',
    'boardCommands', 'doneLabel', 'documentsLanguage', 'plan', 'backlog', 'specifications', 'launchOneTicket']) {
    if (!str(pr[k])) return `project.${k} must be a non-empty string`
  }
  if (!Number.isInteger(pr.boardNumber)) return 'project.boardNumber must be an integer'
  if (!Array.isArray(pr.checks) || !pr.checks.length || !pr.checks.every(str)) return 'project.checks must be a list of commands with at least one'
  const c = f.columns
  if (!c || !str(c.todo) || !str(c.needsHuman) || !str(c.done)) return 'columns needs todo, needsHuman and done'
  const s = f.small
  if (!s || !opt(s.model) || !opt(s.effort)) return 'small needs a model and an effort (a string or null)'
  const r = f.runner
  if (!r || !Number.isInteger(r.maxCommand) || r.maxCommand < 1100 || !Number.isInteger(r.maxOutput) || r.maxOutput < 400 || !Number.isInteger(r.maxLine) || r.maxLine < 240 || r.maxLine > r.maxOutput) return 'runner needs maxCommand (an integer, at least 1100), maxOutput (an integer, at least 400) and maxLine (an integer, at least 240 and not more than maxOutput)'
  if (!Array.isArray(f.phases) || !f.phases.length) return 'phases must be a list with at least one phase'
  const seen = []
  for (const p of f.phases) {
    if (!p || !str(p.name)) return 'every phase needs a name'
    const at = `phase «${p.name}»`
    if (seen.includes(p.name)) return `${at} is named twice`
    if (!str(p.column)) return `${at} needs a column`
    if (p.moveCard !== 'start' && p.moveCard !== 'end') return `${at}: moveCard is "start" or "end"`
    if (!opt(p.model) || !opt(p.effort) || !opt(p.agentType)) return `${at}: model, effort and agentType are a string or null`
    // An agent type brings its own model and effort (its definition): setting them here would silently override it.
    if (p.agentType && (p.model || p.effort)) return `${at}: agentType «${p.agentType}» takes its model and effort from its definition; model and effort must be null`
    if (p.onFail !== c.needsHuman && !seen.includes(p.onFail)) return `${at}: onFail is an earlier phase or «${c.needsHuman}»`
    seen.push(p.name)
  }
  return null
}

// Without a valid factory.json nothing is read. No model here: it is not read yet, so the runner's own (its definition's).
// The file comes as parts of one line each (the command cuts it by the `maxLine` that is in the file itself); the first call
// asks for the first PER_CALL parts, which tell how many there are, and the next calls for the rest.
async function readFactory() {
  let total = null, whole = null
  const parts = {}
  const want = () => (total === null ? Array.from({ length: PER_CALL }, (_, i) => i + 1) : Array.from({ length: total }, (_, i) => i + 1).filter(k => parts[k] === undefined))
  for (let round = 1; round <= TRIES + 2; round++) {
    const todo = want()
    if (!todo.length) break
    const calls = []
    for (let i = 0; i < todo.length; i += PER_CALL) calls.push(todo.slice(i, i + PER_CALL))
    let refused = null
    await Promise.all(calls.map(async (call, c) => {
      const commands = call.map(k => `node ${LIB} factory ${k}`)
      const rs = await runList(`factory.json${round > 1 ? `:again${round}` : ''}:${c + 1}`, commands)
      call.forEach((k, j) => {
        const line = lineAt(rs, j, commands[j])
        if (!line) return
        if (line.kind === 'error') { refused = refused || line.reason; return }
        if (line.kind !== 'factory' || Number(line.part) !== k || !/^\d+$/.test(line.of) || !/^\d+\.\d+$/.test(line.whole)) return
        if (total !== null && (Number(line.of) !== total || line.whole !== whole)) return
        if (total === null) { total = Number(line.of); whole = line.whole }
        if (k <= total) parts[k] = line.data
      })
    }))
    if (refused) return { error: refused }
  }
  const missing = total === null ? [1] : want()
  if (missing.length) return { error: `part ${missing.join(', ')}${total === null ? '' : ` of ${total}`} of the file could not be read right in ${TRIES + 2} rounds` }
  const b64 = Array.from({ length: total }, (_, i) => parts[i + 1]).join('')
  if (cksum(ascii(b64)).replace(' ', '.') !== whole) return { error: 'the parts do not add up to the file (hash and length differ)' }
  const d = fromBase64(b64)
  return d.error ? { error: `it is not valid base64 and UTF-8: ${d.error}` } : { text: d.text }
}
const factoryRead = await readFactory()
if (factoryRead.error) return { stopped: `.claude/factory.json cannot be read: ${factoryRead.error}` }
let F
try { F = JSON.parse(factoryRead.text) } catch (e) { return { stopped: `.claude/factory.json is not valid JSON: ${e.message}` } }
const invalid = checkFactory(F)
if (invalid) return { stopped: `.claude/factory.json is invalid: ${invalid}` }
LIM = F.runner
SMALL = optsOf(F.small) // the script's small agents: every `runner` call that has no phase of its own
const C = F.columns
const P = F.project

// ---------- Input ----------

// /run and /board pass the tickets as text («38», «38 43», «38,43»); a call by script path, as a number, an array or
// { tickets, base }. Any args that is not an object is the ticket list, and a single value is a list of one.
// Something that is not a ticket number stops everything: an empty list would take every ticket.
const isObject = args !== null && typeof args === 'object' && !Array.isArray(args)
const input = isObject ? args : args == null ? {} : { tickets: args }
const given = input.tickets == null ? [] : [].concat(input.tickets)
const tokens = given.flatMap(t => String(t).split(/[\s,]+/)).filter(t => t !== '')
const unreadable = tokens.filter(t => !/^\d+$/.test(t))
if (unreadable.length) return { stopped: `these are not ticket numbers: ${unreadable.join(', ')}` }
const wanted = [...new Set(tokens.map(Number))]

// The base is known from factory.json and the call: the main branch stops everything before any other agent.
const base = input.base ? String(input.base) : P.workingBranch
if (base === P.mainBranch) return { stopped: `the base is the main branch (${base})` }

// ---------- The read ----------

// One `runner` call with the state of the main folder and the tickets (the requested ones, or the first 100 open ones): the
// command reads GitHub, keeps the tickets in a file and prints how many there are; then one line for each ticket. The
// command exits non-zero, with an `error` line, when a ticket is missing or incomplete; the script decides what to do.
const start = await runListRetry('start', [`node ${LIB} folder`, `node ${LIB} tickets${wanted.map(n => ` ${n}`).join('')}`])
if (!start || !start.length) return { stopped: 'the read of the tickets and of the main folder returned nothing' }
const folder = lineAt(start, 0, `node ${LIB} folder`)
const summary = lineAt(start, 1, `node ${LIB} tickets${wanted.map(n => ` ${n}`).join('')}`)
if (!folder || folder.kind !== 'folder') return { stopped: 'the start read could not be trusted: the state of the main folder did not come back as a line with its own hash and length' }
if (!summary) return { stopped: 'the start read could not be trusted: the tickets did not come back as a line with its own hash and length' }
if (summary.kind === 'error') return { stopped: summary.reason }
if (summary.kind !== 'tickets' || !/^\d+$/.test(summary.count) || !/^\d+\.\d+$/.test(summary.file)) return { stopped: 'the start read could not be trusted: the line of the tickets is not the one expected' }

// Why the main folder cannot take a run (the merges happen there), or null.
let problem = null
if (folder.status !== 'ok') problem = 'the state of the main folder could not be read'
else if (Number(folder.changes) > 0) problem = `the main folder has ${folder.changes} changes in tracked files: look at git status`
else if (folder.branch === '-') problem = 'the current branch of the main folder could not be read'
else if (folder.branch !== base) problem = `the main folder is on «${folder.branch}», not on the base (${base})`
const mainFolder = { problem, branch: folder.status === 'ok' && folder.branch !== '-' ? folder.branch : null, changes: folder.status === 'ok' ? Number(folder.changes) : null }

const count = Number(summary.count)
const positions = Array.from({ length: count }, (_, i) => i + 1)
const read = await readLines('tickets', positions, k => `node ${LIB} ticket ${k}`,
  (k, l) => l.kind === 'ticket' && Number(l.k) === k && Number(l.of) === count && l.file === summary.file && /^\d+$/.test(l.n))
if (read.error) return { stopped: `the tickets could not be read: ${read.error}` }
const lost = positions.filter(k => !read.lines[k])
if (lost.length) return { stopped: `the tickets could not be read: ${lost.length > 6 ? `${lost.length} of ${count}` : `number ${lost.join(', ')} of ${count}`} did not come back right in ${TRIES} tries` }

// A ticket as the run uses it. Its labels are only «has the done label» (all that run.js and the table read); its blockers
// have the state and the same.
const tickets = positions.map(k => {
  const l = read.lines[k]
  const blockers = l.b ? l.b.split(',').map(x => { const [n, s, d] = x.split(':'); return { number: Number(n), state: s, labels: d === '1' ? [P.doneLabel] : [] } }) : []
  return { number: Number(l.n), title: l.t + (l.cut === '1' ? '…' : ''), state: l.s, labels: l.d === '1' ? [P.doneLabel] : [], status: l.c, blockers }
})
if (wanted.length) {
  const bad = wanted.filter(n => !tickets.some(t => t.number === n))
  if (bad.length || tickets.length !== wanted.length) return { stopped: `these tickets cannot be read on GitHub: ${bad.map(n => `#${n}`).join(', ') || 'the list does not match the one asked for'}` }
}
tickets.sort((a, b) => a.number - b.number)

// ---------- The table ----------

// Ready = not done, not in Needs Human and every blocker done. The same rules as run.js, shown; run.js decides by its own.
const isDone = t => t.state.toLowerCase() === 'closed' || t.labels.includes(P.doneLabel)
const rows = tickets.map(t => {
  const open = t.blockers.filter(b => !isDone(b))
  const why = isDone(t) ? `done (${t.state.toLowerCase() === 'closed' ? 'closed' : P.doneLabel})`
    : t.status === C.needsHuman ? `in ${C.needsHuman}`
      : open.length ? `blocker not done: ${open.map(b => `#${b.number}`).join(', ')}` : ''
  return { number: t.number, title: t.title, card: t.status || null, ready: !why, why: why || null }
})
const cell = s => String(s).replace(/\|/g, '\\|')
const table = [
  `Ready on ${base}: ${rows.filter(r => r.ready).length} of ${rows.length} tickets`,
  ...(problem ? [`Main folder, not ready for a run: ${oneLine(problem, 200)}`] : []),
  '| Ticket | Card | Ready | Why not |',
  '| --- | --- | --- | --- |',
  ...rows.map(r => `| #${r.number} ${cell(r.title)} | ${r.card || 'no card'} | ${r.ready ? 'ready' : 'no'} | ${r.why ? cell(r.why) : ''} |`),
].join('\n')

return { factory: F, base, wanted, tickets, mainFolder, rows, table }
