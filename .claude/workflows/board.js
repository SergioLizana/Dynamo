export const meta = {
  name: 'board',
  description: 'Read the board and the tickets: for each ticket its card, whether it is ready and why not (a blocker not done, Needs Human, done); the run workflow calls it as a child at its start',
  whenToUse: 'The human runs /board (no args: every open ticket; or ticket numbers, as /run takes them) to see what a run would find; the run workflow calls it at its start',
}

// The start of a run as a workflow of its own: data in, data out, and no decision about the run. It reads
// .claude/factory.json (one `runner` call, parsed and validated here) and, in a second `runner` call, the state of the
// main folder and one GraphQL query with the tickets, their labels, the status of their card and their native blockers.
// Every list is checked against its total, so nothing is cut off silently. The rules of which tickets a run builds
// (done, Needs Human, blockers) stay in run.js; the table below only shows them (documentation/launch-list.md, «The start»).
// Alone: args is empty, ticket numbers ("38", "38 43", "38,43", 38, [38, 43]) or { tickets, base }; it returns the table.
// As a child of run.js (`workflow({ scriptPath }, args)`, same args as /run): it returns the parsed factory.json, the base,
// the tickets as GitHub gave them, and the problem of the main folder (null if it is ready for a run), which run.js
// decides on. Both ways return all of it. Helpers are the same as run.js: a child workflow cannot import.

const FACTORY_JSON = '.claude/factory.json'
const GROUP = 'Start'

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
const shq = s => `'${String(s).split("'").join("'\\''")}'`
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// Exact text through the `runner` (run wf_c3e19634-96a): an agent that copies text by hand does not keep an escape
// (an escape sequence for the middle dot came back as `·`) or a non-ASCII character (`·` came back as `�`). So every command is plain ASCII with no
// escape sequence in it (a filter that needs another character is done here, in the script), and a read whose output can
// hold other text (comments, bodies, titles) is asked as base64 and decoded here. An output that is not valid base64 and
// UTF-8 is a plumbing failure with its reason, never text with `�`.
const plainProblem = c => {
  const bad = String(c).match(/[^\x20-\x7e]|\\u[0-9a-fA-F{]|\\x[0-9a-fA-F]{2}/)
  return bad ? `«${oneLine(c, 120)}» has «${bad[0]}»` : null
}
// `<command>` with its output as base64 (`… | base64`, on Linux, macOS and Git Bash); the exit code stays the command's.
const asBase64 = command => `sh -c ${shq(`out=$(${command} 2>&1); code=$?; printf %s "$out" | base64; exit $code`)}`
// Base64 back to text: { text } or { error }. The line breaks `base64` adds are ignored; the rest must be exact.
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
// The commands in `results` that are base64, decoded in place; the reason of the first that is not, or null.
function decodeAt(results, indexes) {
  for (const i of indexes) {
    if (!results[i]) continue
    const d = fromBase64(results[i].output)
    if (d.error) return `the output of \`${oneLine(results[i].command, 100)}\` is not valid base64 and UTF-8: ${d.error}`
    results[i] = { ...results[i], output: d.text }
  }
  return null
}

const optsOf = step => {
  const o = {}
  if (step && step.model) o.model = step.model
  if (step && step.effort) o.effort = step.effort
  return o
}
async function runList(label, commands, own = {}) {
  const off = commands.map(plainProblem).find(Boolean)
  if (off) throw new Error(`a command is not plain ASCII: ${off}`)
  const r = await agent(`Run these commands, in this order:
${commands.map((c, i) => `${i + 1}. ${c}`).join('\n')}`,
  { ...own, agentType: 'runner', label, phase: GROUP, schema: RUN_SCHEMA })
  return resultsOf(r)
}
// A null read is plumbing: it is asked once more.
const runListRetry = async (label, commands, own) => (await runList(label, commands, own)) || (await runList(`${label}:retry`, commands, own))

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
const rawFactory = await agent(`Run these commands, in this order:
1. ${asBase64(`cat ${FACTORY_JSON}`)}`, { agentType: 'runner', label: 'factory.json', phase: GROUP, schema: RUN_SCHEMA })
const factoryRead = (resultsOf(rawFactory) || [])[0] || null
if (!factoryRead || factoryRead.exitCode !== 0) return { stopped: `${FACTORY_JSON} is missing or cannot be read` }
const factoryText = fromBase64(factoryRead.output)
if (factoryText.error) return { stopped: `the output of reading ${FACTORY_JSON} is not valid base64 and UTF-8: ${factoryText.error}` }
factoryRead.output = factoryText.text
let F
try { F = JSON.parse(factoryRead.output.trim()) } catch (e) { return { stopped: `${FACTORY_JSON} is not valid JSON: ${e.message}` } }
const invalid = checkFactory(F)
if (invalid) return { stopped: `${FACTORY_JSON} is invalid: ${invalid}` }
const C = F.columns
const P = F.project
const SMALL = optsOf(F.small) // the script's small agents: every `runner` call that has no phase of its own

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

// One `runner` call with each command's literal output: the state of the main folder, the branch, and the tickets (the
// requested ones, or the first 100 open ones). The query exits non-zero when a ticket is missing; the script parses
// and decides.
const [OWNER, REPO_NAME] = P.repo.split('/')
const TICKET_FIELDS = 'number title state labels(first:20){totalCount nodes{name}} '
  + 'projectItems(first:5){totalCount nodes{fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}} '
  + 'blockedBy(first:20){totalCount nodes{number state labels(first:10){totalCount nodes{name}}}}'
const query = `query { repository(owner:"${OWNER}", name:"${REPO_NAME}") { ${wanted.length
  ? wanted.map(n => `t${n}: issue(number:${n}) { ${TICKET_FIELDS} }`).join(' ')
  : `issues(states:OPEN, first:100) { pageInfo{hasNextPage} nodes { ${TICKET_FIELDS} } }`} } }`

const startCommands = [
  'git status --porcelain --untracked-files=no', // 0
  'git branch --show-current', // 1
  asBase64(`gh api graphql -f query='${query}'`), // 2: titles can hold non-ASCII text
]
const startRs = await runListRetry('start', startCommands, SMALL)
if (!startRs || !startRs.length) return { stopped: 'the read of the tickets and of the main folder returned nothing' }
for (let i = 0; i < startRs.length; i++) {
  if (i >= startCommands.length || loose(startRs[i].command) !== loose(startCommands[i])) return { stopped: `the start read ran «${oneLine(startRs[i].command, 120)}» where «${oneLine(startCommands[i] || 'nothing', 120)}» was expected` }
}
const notB64 = decodeAt(startRs, [2])
if (notB64) return { stopped: `the tickets could not be read: ${notB64}` }
const [rStatus, rBranch, rTickets] = startRs

// Why the main folder cannot take a run (the merges happen there), or null.
let problem = null
if (rStatus.exitCode !== 0) problem = 'the state of the main folder could not be read'
else if (rStatus.output.trim()) problem = `the main folder has changes in tracked files:\n${rStatus.output.trimEnd()}`
else if (!rBranch || rBranch.exitCode !== 0) problem = 'the current branch of the main folder could not be read'
else if (rBranch.output.trim() !== base) problem = `the main folder is on «${rBranch.output.trim()}», not on the base (${base})`
if (!rTickets) return { stopped: problem || 'the tickets could not be read: the runner stopped before the query' }
const mainFolder = { problem, branch: rBranch && rBranch.exitCode === 0 ? rBranch.output.trim() : null, changes: rStatus.exitCode === 0 ? rStatus.output.trimEnd() : null }

// GitHub prints the data and the errors together (a missing ticket is null with an error), then exits non-zero: the
// output is parsed whatever the code, and a stray line before or after the JSON is ignored.
let answer = null
const out = rTickets.output
for (const text of [out.trim(), out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)]) {
  try { answer = JSON.parse(text); break } catch (e) { /* the next text */ }
}
const repository = answer && answer.data && answer.data.repository
if (!repository) return { stopped: `the tickets could not be read: GitHub's answer is not usable (exit code ${rTickets.exitCode})` }

const whole = c => (c && Array.isArray(c.nodes) && c.nodes.length === c.totalCount ? c.nodes : null)
// A ticket as the run uses it, or null if what GitHub returned is incomplete or malformed.
function toTicket(n) {
  if (!n || !Number.isInteger(n.number) || typeof n.title !== 'string' || typeof n.state !== 'string') return null
  const labels = whole(n.labels), items = whole(n.projectItems), blocked = whole(n.blockedBy)
  if (!labels || !items || !blocked) return null
  const blockers = []
  for (const b of blocked) {
    const bl = b && whole(b.labels)
    if (!bl || !Number.isInteger(b.number) || typeof b.state !== 'string') return null
    blockers.push({ number: b.number, state: b.state, labels: bl.map(l => l.name) })
  }
  const status = items.map(i => i && i.fieldValueByName && i.fieldValueByName.name).find(x => typeof x === 'string')
  return { number: n.number, title: n.title, state: n.state, labels: labels.map(l => l.name), status: status || '', blockers }
}

// A requested ticket that cannot be read stops everything and is named.
let tickets
if (wanted.length) {
  tickets = wanted.map(n => toTicket(repository[`t${n}`]))
  const bad = wanted.filter((n, i) => !tickets[i] || tickets[i].number !== n)
  if (bad.length) return { stopped: `these tickets cannot be read on GitHub: ${bad.map(n => `#${n}`).join(', ')}` }
} else {
  const open = repository.issues
  if (!open || !Array.isArray(open.nodes) || !open.pageInfo) return { stopped: 'the list of open tickets could not be read' }
  if (open.pageInfo.hasNextPage) return { stopped: 'there are more than 100 open tickets: name the ones to run' }
  tickets = open.nodes.map(toTicket)
  const bad = open.nodes.map((n, i) => (tickets[i] ? null : n && Number.isInteger(n.number) ? `#${n.number}` : 'one of them')).filter(Boolean)
  if (bad.length) return { stopped: `these tickets cannot be read on GitHub: ${bad.join(', ')}` }
}
if (rTickets.exitCode !== 0 && !(answer.errors || []).length) return { stopped: `the tickets query failed (exit code ${rTickets.exitCode}) with no error to show` }
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
