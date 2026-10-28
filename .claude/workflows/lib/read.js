#!/usr/bin/env node
'use strict'
// The big reads of the workflow scripts, done where the data is (ticket #76). A workflow script cannot run a command or
// read a file, so everything it needs crosses the `runner` agent, which copies each command and each output by hand and
// does not keep a long text exact. So the scripts do not read anything big: they run this command, which reads git and
// GitHub itself, builds what is big into a file (the release report, the tickets) and prints ONE SHORT ASCII LINE per call.
//
// Plain Node, no dependencies; runs the same on Linux, macOS and Windows (Git Bash): no shell, no PowerShell, no pipes.
// It runs from the main folder, and reads `.claude/factory.json` itself (project data and the limits in `runner`).
//
//   node .claude/workflows/lib/read.js factory <k>             part k of factory.json (base64 chunks that fit one line)
//   node .claude/workflows/lib/read.js folder                  the state of the main folder (changes in tracked files, branch)
//   node .claude/workflows/lib/read.js tickets [n ...]         read the open tickets (or the numbers given) into a file
//   node .claude/workflows/lib/read.js ticket <k>              the k-th ticket of that file (1-based)
//   node .claude/workflows/lib/read.js put <name> <k> <chunk> <crc> <len>   store one piece of a text the script sends
//   node .claude/workflows/lib/read.js release <base|-> [<name> <crc.len>]  build the release report file
//   node .claude/workflows/lib/read.js tidy                    remove the files this command and the scripts left (tmp-*)
//
// The line is `<kind> key=value ... <crc> <length>`: the values use only A-Za-z0-9 . _ - % : , + / = (anything else is
// percent-encoded), and the last two numbers are the POSIX `cksum` of the text before them, so the script catches a
// character the runner changed. It is never longer than `runner.maxLine` in factory.json (the one place the limit is
// stated); a line that would be longer fails (exit 1) with an `error` line instead. A failure prints
// `error reason=<text>` the same way.

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const FACTORY_JSON = '.claude/factory.json'
const WORK = '.claude/worktrees'
const TMP = 'tmp-' // ignored by git; `tidy` and the end of a list remove them
const TICKETS_FILE = `${WORK}/${TMP}tickets.json`
const MIN_LINE = 240
let MAX_LINE = 300 // until factory.json says otherwise

// ---------- The fingerprint: POSIX `cksum`, the same as the scripts compute ----------

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
const sumOf = data => cksum(Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8'))
const dotted = sum => sum.replace(' ', '.')

// ---------- The line ----------

class Fail extends Error {}
const enc = s => {
  const text = String(s)
  let safe
  try { safe = encodeURIComponent(text) } catch (e) { safe = encodeURIComponent(text.replace(/[\ud800-\udfff]/g, '?')) }
  return safe.replace(/[!'()*~]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}
const SAFE_VALUE = /^[A-Za-z0-9._%:,+/=-]*$/
function say(kind, fields, maxLine = MAX_LINE) {
  const payload = [kind, ...Object.entries(fields).map(([k, v]) => {
    const value = String(v)
    if (!SAFE_VALUE.test(value)) throw new Error(`internal: the value of ${k} is not safe to print`)
    return `${k}=${value}`
  })].join(' ')
  const text = `${payload} ${sumOf(payload)}`
  if (text.length > maxLine) throw new Fail(`its line is ${text.length} characters, over runner.maxLine (${maxLine})`)
  return text
}
// The reason, cut so that the error line fits.
function errorLine(reason) {
  let r = String(reason).replace(/\s+/g, ' ').trim()
  for (;;) {
    try { return say('error', { reason: enc(r) }) } catch (e) {
      if (!(e instanceof Fail) || r.length < 8) return `error reason=failed ${sumOf('error reason=failed')}`
      r = `${r.slice(0, Math.max(4, r.length - 12))}...`
    }
  }
}

// ---------- git and gh ----------

// FACTORY_GIT and FACTORY_GH, if set, are the command to run in their place, as a JSON list (the tests put a fake there).
function exec(name, args, input) {
  const own = process.env[`FACTORY_${name.toUpperCase()}`]
  const [cmd, ...pre] = own ? JSON.parse(own) : [name]
  const p = spawnSync(cmd, [...pre, ...args], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, input })
  return { code: p.status === null ? 1 : p.status, out: p.stdout || '', err: p.error ? String(p.error.message) : p.stderr || '' }
}
const parseJson = text => {
  for (const t of [String(text).trim(), String(text).slice(String(text).indexOf('{'), String(text).lastIndexOf('}') + 1)]) {
    try { return JSON.parse(t) } catch (e) { /* the next text */ }
  }
  return null
}

// ---------- factory.json ----------

let FACTORY_TEXT = null
function loadFactory() {
  let buf
  try { buf = fs.readFileSync(FACTORY_JSON) } catch (e) { throw new Fail(`${FACTORY_JSON} is missing or cannot be read`) }
  FACTORY_TEXT = buf
  let F
  try { F = JSON.parse(buf.toString('utf8')) } catch (e) { throw new Fail(`${FACTORY_JSON} is not valid JSON: ${e.message}`) }
  const r = F && F.runner
  if (!r || !Number.isInteger(r.maxLine) || r.maxLine < MIN_LINE) throw new Fail(`${FACTORY_JSON} must give runner.maxLine (an integer, at least ${MIN_LINE}): the longest line this command prints`)
  MAX_LINE = r.maxLine
  return F
}
const text = v => typeof v === 'string' && v.length > 0
function project(F, keys) {
  const P = F && F.project
  if (!P) throw new Fail(`${FACTORY_JSON} has no project block`)
  for (const k of keys) if (!text(P[k]) && !(k === 'boardNumber' && Number.isInteger(P[k]))) throw new Fail(`project.${k} of ${FACTORY_JSON} is missing`)
  return P
}
// These go into a GraphQL query and into file names as they are.
const SAFE_NAME = /^[A-Za-z0-9._/-]+$/
const safeNames = (what, ...values) => { if (!values.every(v => SAFE_NAME.test(String(v)))) throw new Fail(`${what} has characters that are not safe to use`) }

// ---------- factory ----------

function cmdFactory(args) {
  loadFactory()
  const k = args[0] === undefined ? 1 : Number(args[0])
  if (!Number.isInteger(k) || k < 1) throw new Fail('factory needs a part number from 1')
  const b64 = FACTORY_TEXT.toString('base64')
  const room = say('factory', { part: '999', of: '999', whole: '4294967295.9999999', data: '' }, Infinity).length
  const size = Math.floor((MAX_LINE - room) / 4) * 4
  if (size < 40) throw new Fail(`runner.maxLine (${MAX_LINE}) is too short to carry a part of ${FACTORY_JSON}`)
  const n = Math.max(1, Math.ceil(b64.length / size))
  return say('factory', { part: k, of: n, whole: dotted(sumOf(b64)), data: b64.slice((k - 1) * size, k * size) })
}

// ---------- folder ----------

function cmdFolder() {
  loadFactory()
  const status = exec('git', ['status', '--porcelain', '--untracked-files=no'])
  const branch = exec('git', ['branch', '--show-current'])
  return say('folder', {
    status: status.code === 0 ? 'ok' : 'failed',
    changes: status.code === 0 ? status.out.split('\n').filter(l => l.trim()).length : 0,
    branch: branch.code === 0 ? enc(branch.out.trim()) : '-',
  })
}

// ---------- tickets ----------

const TICKET_FIELDS = 'number title state labels(first:20){totalCount nodes{name}} '
  + 'projectItems(first:5){totalCount nodes{fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}} '
  + 'blockedBy(first:20){totalCount nodes{number state labels(first:10){totalCount nodes{name}}}}'
const whole = c => (c && Array.isArray(c.nodes) && c.nodes.length === c.totalCount ? c.nodes : null)
// A ticket as the run uses it, cut down to what it needs (its labels are only «has the done label»), or null if what
// GitHub returned is incomplete or malformed.
function toTicket(n, doneLabel) {
  if (!n || !Number.isInteger(n.number) || typeof n.title !== 'string' || typeof n.state !== 'string') return null
  const labels = whole(n.labels), items = whole(n.projectItems), blocked = whole(n.blockedBy)
  if (!labels || !items || !blocked) return null
  const blockers = []
  for (const b of blocked) {
    const bl = b && whole(b.labels)
    if (!bl || !Number.isInteger(b.number) || typeof b.state !== 'string') return null
    blockers.push({ number: b.number, state: b.state, done: bl.some(l => l.name === doneLabel) })
  }
  const status = items.map(i => i && i.fieldValueByName && i.fieldValueByName.name).find(x => typeof x === 'string')
  return { number: n.number, title: n.title, state: n.state, done: labels.some(l => l.name === doneLabel), card: status || '', blockers }
}

function cmdTickets(args) {
  const F = loadFactory()
  const P = project(F, ['repo', 'doneLabel'])
  const wanted = [...new Set(args.map(a => { if (!/^\d+$/.test(a)) throw new Fail(`${a} is not a ticket number`); return Number(a) }))]
  const [owner, name] = P.repo.split('/')
  if (!owner || !name) throw new Fail(`the repository «${P.repo}» is not owner/name`)
  safeNames('the repository', owner, name)
  const body = wanted.length
    ? wanted.map(n => `t${n}: issue(number:${n}) { ...F }`).join(' ')
    : 'issues(states:OPEN, first:100) { pageInfo{hasNextPage} nodes { ...F } }'
  const query = `query { repository(owner:"${owner}", name:"${name}") { ${body} } } fragment F on Issue { ${TICKET_FIELDS} }`
  const r = exec('gh', ['api', 'graphql', '-f', `query=${query}`])
  // GitHub prints the data and the errors together (a missing ticket is null with an error), then exits non-zero: the output
  // is parsed whatever the code.
  const answer = parseJson(r.out)
  const repository = answer && answer.data && answer.data.repository
  if (!repository) throw new Fail(`the tickets could not be read: GitHub's answer is not usable (exit code ${r.code})`)
  if (r.code !== 0 && !(answer.errors || []).length) throw new Fail(`the tickets query failed (exit code ${r.code}) with no error to show`)
  let tickets
  if (wanted.length) {
    tickets = wanted.map(n => toTicket(repository[`t${n}`], P.doneLabel))
    const bad = wanted.filter((n, i) => !tickets[i] || tickets[i].number !== n)
    if (bad.length) throw new Fail(`these tickets cannot be read on GitHub: ${bad.map(n => `#${n}`).join(', ')}`)
  } else {
    const open = repository.issues
    if (!open || !Array.isArray(open.nodes) || !open.pageInfo) throw new Fail('the list of open tickets could not be read')
    if (open.pageInfo.hasNextPage) throw new Fail('there are more than 100 open tickets: name the ones to run')
    tickets = open.nodes.map(n => toTicket(n, P.doneLabel))
    const bad = open.nodes.map((n, i) => (tickets[i] ? null : n && Number.isInteger(n.number) ? `#${n.number}` : 'one of them')).filter(Boolean)
    if (bad.length) throw new Fail(`these tickets cannot be read on GitHub: ${bad.join(', ')}`)
  }
  tickets.sort((a, b) => a.number - b.number)
  const file = JSON.stringify(tickets)
  fs.mkdirSync(WORK, { recursive: true })
  fs.writeFileSync(TICKETS_FILE, file)
  return say('tickets', { count: tickets.length, wanted: wanted.length, file: dotted(sumOf(file)) })
}

// One ticket of the file, as a line: the title is cut (never anything else) to make the line fit.
function cmdTicket(args) {
  loadFactory()
  const k = Number(args[0])
  if (!Number.isInteger(k) || k < 1) throw new Fail('ticket needs a position from 1')
  let raw
  try { raw = fs.readFileSync(TICKETS_FILE) } catch (e) { throw new Fail('there is no tickets file: run `tickets` first') }
  const tickets = JSON.parse(raw.toString('utf8'))
  const t = tickets[k - 1]
  if (!t) throw new Fail(`there is no ticket ${k}: the file has ${tickets.length}`)
  const fields = title => ({
    k, of: tickets.length, file: dotted(sumOf(raw)), n: t.number, s: enc(t.state), c: enc(t.card), d: t.done ? 1 : 0,
    b: t.blockers.map(b => `${b.number}:${enc(b.state)}:${b.done ? 1 : 0}`).join(','),
    cut: title.length < [...t.title].length ? 1 : 0, t: enc(title.join('')),
  })
  const title = [...t.title]
  for (;;) {
    try { return say('ticket', fields(title)) } catch (e) {
      if (!(e instanceof Fail) || !title.length) throw e
      title.pop()
    }
  }
}

// ---------- put: the pieces of a text the script sends ----------

const piecePath = (name, k) => `${WORK}/${TMP}${name}-${String(k).padStart(3, '0')}`
const pieceFiles = name => (fs.existsSync(WORK) ? fs.readdirSync(WORK).filter(f => f.startsWith(`${TMP}${name}-`)).sort() : [])
function cmdPut(args) {
  loadFactory()
  const [name, kk, chunk, crc, len] = args
  const k = Number(kk)
  if (!/^[a-z]+$/.test(name || '') || !Number.isInteger(k) || k < 1 || k > 999 || !/^[A-Za-z0-9+/=]+$/.test(chunk || '')) throw new Fail('put needs a name, a piece number and a base64 piece')
  if (sumOf(chunk) !== `${crc} ${len}`) throw new Fail(`piece ${k} did not arrive as it was sent (its hash and length are ${sumOf(chunk)}, not ${crc} ${len})`)
  fs.mkdirSync(WORK, { recursive: true })
  if (k === 1) for (const f of pieceFiles(name)) fs.rmSync(path.join(WORK, f), { force: true })
  fs.writeFileSync(piecePath(name, k), chunk)
  return say('put', { name, k })
}
// The text of the pieces of `name`, if together they have the fingerprint the script computed; the pieces are removed.
function takePieces(name, total) {
  const files = pieceFiles(name)
  const b64 = files.map(f => fs.readFileSync(path.join(WORK, f), 'utf8')).join('')
  if (!files.length || dotted(sumOf(b64)) !== total) throw new Fail(`the ${files.length} pieces of ${name} do not add up to the hash and length the script computed (${total})`)
  for (const f of files) fs.rmSync(path.join(WORK, f), { force: true })
  return Buffer.from(b64, 'base64').toString('utf8')
}

function cmdTidy() {
  loadFactory()
  const files = fs.existsSync(WORK) ? fs.readdirSync(WORK).filter(f => f.startsWith(TMP)) : []
  for (const f of files) fs.rmSync(path.join(WORK, f), { force: true })
  return say('tidy', { removed: files.length })
}

// ---------- release ----------

// The merged tickets are the `(#n)` that ends the subject of every merge commit, whatever the language of the subject. A
// revert of a merge (`Revert "<subject>"`, and a revert of the revert) takes the ticket out (or puts it back), oldest first.
function mergedSinceMain(output) {
  const commits = output.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim()).map(l => {
    const tab = l.indexOf('\t')
    return { merge: l.slice(0, tab).trim().includes(' '), subject: l.slice(tab + 1).trim() }
  }).reverse()
  const mergeSubjects = new Set(commits.filter(c => c.merge).map(c => c.subject))
  const numberOf = s => { const m = s.match(/\(#(\d+)\)\s*$/); return m ? Number(m[1]) : null }
  const set = new Set()
  for (const c of commits) {
    if (c.merge) { const n = numberOf(c.subject); if (n !== null) set.add(n); continue }
    let s = c.subject, depth = 0
    while (/^Revert "[\s\S]*"$/.test(s)) { s = s.slice(8, -1); depth++ }
    if (!depth || !mergeSubjects.has(s)) continue
    const n = numberOf(s)
    if (n === null) continue
    if (depth % 2) set.delete(n); else set.add(n)
  }
  return [...set].sort((a, b) => a - b)
}

const oneLine = (s, max = 300) => {
  const x = String(s).replace(/\s+/g, ' ').trim()
  return x.length > max ? `${x.slice(0, max - 1)}…` : x
}

// What the Builder noted outside the ticket, from the «Out of the ticket» block of a run comment. The block comes in three
// forms and all of them are kept: text after the colon on the first line, unfenced lines after it (up to the next
// `Stopped at` / `Left` / `To relaunch` / `Reason` line), and fenced blocks (their lines count whatever they say, but the
// fences themselves do not). The result is dropped only when all of that is just «nothing» or «none».
function outOfTicket(block) {
  if (!block) return null
  const lines = String(block).split('\n').map(l => l.replace(/\r$/, ''))
  const colon = lines[0].indexOf(':')
  const body = colon === -1 ? [] : [lines[0].slice(colon + 1)]
  let inside = false
  for (const l of lines.slice(1)) {
    if (/^`{3,}/.test(l.trim())) { inside = !inside; continue }
    if (!inside && /^(Stopped at|Left|To relaunch|Reason)\b/.test(l.trim())) break
    body.push(l)
  }
  const t = oneLine(body.join(' '), 600)
  return !t || /^(nothing|none)\.?$/i.test(t) ? null : t
}

// The last comment of a ticket that starts with «run · » (the dot is U+00B7), with the three pieces the report uses.
function lastRun(node) {
  const bodies = ((node.comments && node.comments.nodes) || []).map(c => c && c.body)
    .filter(b => typeof b === 'string' && b.startsWith('run ') && b.charCodeAt(4) === 183)
  const b = bodies[bodies.length - 1]
  const info = { n: node.number, t: node.title }
  if (b === undefined) return info
  const lines = b.split('\n')
  const k = lines.findIndex(l => l.startsWith('Out of the ticket'))
  return { ...info, head: lines[0], rounds: lines.find(l => l.startsWith('Rounds: ')), out: k < 0 ? null : lines.slice(k).join('\n') }
}

const PLACEHOLDER = '<the human fills it in>'
// The `/cost` line the human filled in on the PR stays: it is not state anyone can read from git.
const costOf = body => {
  const m = String(body || '').match(/^- `\/cost` of the session:[ \t]*(.+)$/m)
  return m && !m[1].includes(PLACEHOLDER) ? m[1].trim() : null
}
const CARDS_LIMIT = 200

function cmdRelease(args) {
  const F = loadFactory()
  const P = project(F, ['repo', 'mainBranch', 'workingBranch', 'boardOwner', 'boardNumber', 'doneLabel'])
  const needsHumanColumn = F.columns && F.columns.needsHuman
  if (!text(needsHumanColumn)) throw new Fail('columns.needsHuman of factory.json is missing')
  const base = args[0] && args[0] !== '-' ? args[0] : P.workingBranch
  if (base === P.mainBranch) throw new Fail(`the base is the main branch (${base})`)
  const [owner, repoName] = P.repo.split('/')
  if (!owner || !repoName) throw new Fail(`the repository «${P.repo}» is not owner/name`)
  safeNames('a branch, repository, owner or label name', base, P.mainBranch, owner, repoName, P.boardOwner, P.doneLabel)
  const results = args[1] ? JSON.parse(takePieces(args[1], args[2])) : []
  if (!Array.isArray(results)) throw new Fail('the results of the run are not a list')
  const reportFile = `${WORK}/release-report-${base.replace(/[^A-Za-z0-9._-]+/g, '-')}.md`

  // ----- Reads (every one that fails costs its part of the report and adds a note, never the whole report) -----
  const head = exec('git', ['rev-parse', '--short', base])
  if (head.code !== 0) throw new Fail(`${base} does not exist here: git rev-parse ${base} exited ${head.code}`)
  const log = exec('git', ['log', '--first-parent', '--format=%p%x09%s', `${P.mainBranch}..${base}`])
  if (log.code !== 0) throw new Fail(`the merges of ${base} since ${P.mainBranch} could not be read (exit code ${log.code})`)
  const ahead = exec('git', ['rev-list', '--count', base, '--not', '--remotes=origin'])
  const query = `query { repository(owner:"${owner}", name:"${repoName}") { issues(labels:["${P.doneLabel}"], states:[OPEN,CLOSED], first:100, orderBy:{field:UPDATED_AT,direction:DESC}) { pageInfo{hasNextPage} totalCount nodes { number title comments(last:10){nodes{body}} } } } }`
  const comments = exec('gh', ['api', 'graphql', '-f', `query=${query}`])
  const cards = exec('gh', ['project', 'item-list', String(P.boardNumber), '--owner', P.boardOwner, '--format', 'json', '--limit', String(CARDS_LIMIT)])
  const prs = exec('gh', ['pr', 'list', '-R', P.repo, '--head', base, '--base', P.mainBranch, '--state', 'open', '--json', 'number,url,body'])
  const remoteRead = exec('git', ['ls-remote', '--heads', 'origin', base])

  const notes = [] // codes: the script has the text of each one
  const merged = mergedSinceMain(log.out)

  const info = {}
  const answer = comments.code === 0 ? parseJson(comments.out) : null
  const issues = answer && answer.data && answer.data.repository && answer.data.repository.issues
  if (issues && Array.isArray(issues.nodes)) {
    for (const node of issues.nodes) if (node && Number.isInteger(node.number)) info[node.number] = lastRun(node)
    if (issues.pageInfo && issues.pageInfo.hasNextPage) notes.push('more-tickets')
  } else {
    notes.push(`no-tickets:${comments.code}`)
  }

  let needsHuman = null
  const board = cards.code === 0 ? parseJson(cards.out) : null
  if (board && Array.isArray(board.items)) {
    needsHuman = board.items.filter(i => i && i.status === needsHumanColumn && i.content && Number.isInteger(i.content.number)).map(i => ({ n: i.content.number, t: i.title }))
    if (board.items.length >= CARDS_LIMIT || board.totalCount > board.items.length) notes.push(`cards-more:${board.items.length}`)
  }
  if (!needsHuman) notes.push('no-cards')

  let pr = null, prKnown = false
  if (prs.code === 0) {
    try { const l = JSON.parse(prs.out.trim()); if (Array.isArray(l)) { prKnown = true; pr = l[0] || null } } catch (e) { prKnown = false }
  }
  if (!prKnown) notes.push('no-prs')

  const localHead = head.out.trim()
  const missing = ahead.code === 0 && /^\d+$/.test(ahead.out.trim()) ? Number(ahead.out.trim()) : null
  const remoteSha = remoteRead.code === 0 ? remoteRead.out.trim().split(/\s+/)[0] : ''
  let remote = { state: 'unknown', missing }
  if (remoteRead.code !== 0) {
    notes.push('no-remote')
  } else if (!remoteSha) {
    remote = { state: 'missing', missing }
    notes.push(`remote-missing:${missing === null ? '-' : missing}`)
  } else if (localHead && remoteSha.startsWith(localHead)) {
    remote = { state: 'up-to-date', missing: 0 }
  } else if (missing) {
    remote = { state: 'behind', missing }
    notes.push(`remote-behind:${missing}`)
  } else {
    remote = { state: 'different', missing }
    notes.push(`remote-different:${enc(remoteSha.slice(0, 7))}:${enc(localHead)}`)
  }

  // ----- The report -----
  const costLine = `- \`/cost\` of the session: ${(pr && costOf(pr.body)) || PLACEHOLDER}`
  const title = n => (info[n] && info[n].t ? ` «${info[n].t}»` : '')
  const ticketLine = n => {
    const i = info[n]
    if (!i) return `- #${n}: merged; no ticket data on GitHub`
    if (!i.head) return `- #${n}${title(n)}: merged; no run comment on the ticket`
    const result = oneLine(String(i.head).replace(/^run\s+\S+\s+/, ''), 200)
    const rounds = i.rounds ? String(i.rounds).replace(/^Rounds:\s*/, '').trim() : ''
    return `- #${n}${title(n)}: last run comment «${result}»${rounds ? `, rounds ${rounds}` : ''}`
  }
  const seen = merged.flatMap(n => { const t = outOfTicket(info[n] && info[n].out); return t ? [`- #${n}: ${t}`] : [] })
  const blocked = results.filter(r => r && r.status === 'blocked')
  const skipped = results.filter(r => r && r.status === 'skipped')
  const why = r => `- #${r.number}: ${oneLine(r.reason || r.note || 'no reason given')}`
  // A merge the run reports that the log does not show: the report would be wrong, so it says so.
  for (const r of results) {
    if (r && r.status === 'done' && r.mergeCommit && !merged.includes(r.number)) notes.push(`unmerged:${r.number}:${enc(r.mergeCommit)}`)
  }
  const report = [
    `## release report · ${base}`, '',
    `Tickets merged into ${base} since ${P.mainBranch}: ${merged.length}, from the \`(#n)\` of its merge commits.`, '',
    '### Tickets', '', ...(merged.length ? merged.map(ticketLine) : ['- none']), '',
    ...(results.length ? ['### Blocked in this run', '', ...(blocked.length ? blocked.map(why) : ['- none']), '',
      '### Skipped in this run', '', ...(skipped.length ? skipped.map(why) : ['- none']), ''] : []),
    `### ${needsHumanColumn}`, '', ...(needsHuman && needsHuman.length ? needsHuman.map(c => `- #${c.n}${c.t ? ` «${oneLine(c.t, 160)}»` : ''}`) : [needsHuman ? '- none' : '- not read']), '',
    '### Out of the ticket (for the backlog)', '', ...(seen.length ? seen : ['- nothing']), '',
    '### Cost', '', costLine, '',
    ...merged.map(n => `Closes #${n}`),
  ].join('\n').trim()

  fs.mkdirSync(WORK, { recursive: true })
  fs.writeFileSync(reportFile, report)
  const written = fs.readFileSync(reportFile)
  if (sumOf(written) !== sumOf(report)) throw new Fail(`${reportFile} was not written as it should`)

  return say('release', {
    base: enc(base), main: enc(P.mainBranch), repo: enc(P.repo), file: enc(reportFile), sum: dotted(sumOf(written)),
    merged: merged.length, needs: needsHuman ? needsHuman.length : 'unknown', pr: !prKnown ? 'unknown' : pr ? pr.number : '-',
    remote: remote.state, missing: remote.missing === null ? '-' : remote.missing, notes: notes.join(','),
  })
}

// ---------- Main ----------

const COMMANDS = { factory: cmdFactory, folder: cmdFolder, tickets: cmdTickets, ticket: cmdTicket, put: cmdPut, release: cmdRelease, tidy: cmdTidy }
// { code, line } for the arguments after `read.js`; nothing else is printed.
function run(argv) {
  try {
    const f = COMMANDS[argv[0]]
    if (!f) throw new Fail(`unknown command «${argv[0] || ''}»: ${Object.keys(COMMANDS).join(', ')}`)
    return { code: 0, line: f(argv.slice(1)) }
  } catch (e) {
    return { code: 1, line: errorLine(e instanceof Fail ? e.message : `internal error: ${e && e.message}`) }
  }
}

if (require.main === module) {
  const r = run(process.argv.slice(2))
  process.stdout.write(`${r.line}\n`)
  process.exitCode = r.code
}

module.exports = { run, cksum, sumOf, mergedSinceMain, outOfTicket, toTicket, say, enc }
