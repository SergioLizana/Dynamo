export const meta = {
  name: 'release-report',
  description: 'Rebuild the release report from git and GitHub: the tickets merged into the working branch since the main branch, their last run comment, the tickets in Needs Human, and the commands for the human (push, then gh pr create or edit)',
  whenToUse: 'The human runs /release-report (no args: the working branch of factory.json; or a base) to rebuild the report of a release; the run workflow calls it as a child at the end of a list',
}

// The report of a release is built from state, never from what a run remembers: the merge commits of the base since the
// main branch (git log), the last run comment of every ticket on GitHub and the cards in Needs Human. It reads in one
// `runner` call, writes the file in a second, and never pushes and never opens or edits a PR: it returns the commands the
// human runs (documentation/launch-list.md, «The end of a list»).
// Alone: args is empty, a base («release/0.1.0») or { base }; it reads .claude/factory.json itself (one `runner` call).
// As a child of run.js (`workflow({ scriptPath }, args)`): args = { base, project, columns, small, results, cleanup }.
// project, columns and small are the blocks of factory.json (run.js read them already, so nothing is read twice);
// results are the tickets of the run (blocked and skipped ones are told in the report, and a merge the log does not
// show is a note); cleanup is a list of commands the run wants executed in the same `runner` call that writes the file
// (the copies it made), whose results are returned untouched.

const FACTORY_JSON = '.claude/factory.json'
const GROUP = 'Report'

// ---------- Helpers (the same as run.js: a child workflow cannot import) ----------

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
const norm = s => String(s).replace(/\r\n/g, '\n').trim()
const oneLine = (s, max = 300) => {
  const x = String(s).replace(/\s+/g, ' ').trim()
  return x.length > max ? `${x.slice(0, max - 1)}…` : x
}
const shq = s => `'${String(s).split("'").join("'\\''")}'`

// The runner takes commands, not files: a long text travels as base64 in one command, so no quote, backtick or newline
// in it reaches a shell. Done here because the script has no Buffer.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function base64(text) {
  const bytes = []
  for (const ch of String(text)) {
    const c = ch.codePointAt(0)
    if (c < 0x80) bytes.push(c)
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2]
    const n = (a << 16) | ((b || 0) << 8) | (c || 0)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (b === undefined ? '=' : B64[(n >> 6) & 63]) + (c === undefined ? '=' : B64[n & 63])
  }
  return out
}
const fromText = (text, tail) => `sh -c ${shq(`printf %s ${base64(text)} | base64 --decode | ${tail}`)}`

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

let SMALL = {}
const optsOf = step => {
  const o = {}
  if (step && step.model) o.model = step.model
  if (step && step.effort) o.effort = step.effort
  return o
}
async function runList(label, commands) {
  const off = commands.map(plainProblem).find(Boolean)
  if (off) throw new Error(`a command is not plain ASCII: ${off}`)
  const r = await agent(`Run these commands, in this order:
${commands.map((c, i) => `${i + 1}. ${c}`).join('\n')}`,
  { ...SMALL, agentType: 'runner', label, phase: GROUP, schema: RUN_SCHEMA })
  return resultsOf(r)
}
// A null read is plumbing: it is asked once more.
const runListRetry = async (label, commands) => (await runList(label, commands)) || (await runList(`${label}:retry`, commands))

// ---------- Input ----------

const isObject = args !== null && typeof args === 'object' && !Array.isArray(args)
const input = isObject ? args : args == null ? {} : { base: args }

let P = input.project, C = input.columns
if (P && C) {
  SMALL = optsOf(input.small)
} else {
  // Alone: the only read of factory.json. No model here: `small` is not known yet, so the runner's own.
  const raw = await agent(`Run these commands, in this order:
1. ${asBase64(`cat ${FACTORY_JSON}`)}`, { agentType: 'runner', label: 'factory.json', phase: GROUP, schema: RUN_SCHEMA })
  const read = (resultsOf(raw) || [])[0]
  if (!read || read.exitCode !== 0) return { stopped: `${FACTORY_JSON} is missing or cannot be read` }
  const factoryText = fromBase64(read.output)
  if (factoryText.error) return { stopped: `the output of reading ${FACTORY_JSON} is not valid base64 and UTF-8: ${factoryText.error}` }
  read.output = factoryText.text
  let F
  try { F = JSON.parse(read.output.trim()) } catch (e) { return { stopped: `${FACTORY_JSON} is not valid JSON: ${e.message}` } }
  P = F && F.project
  C = F && F.columns
  SMALL = optsOf(F && F.small)
}
const text = v => typeof v === 'string' && v.length > 0
if (!P || ![P.repo, P.mainBranch, P.workingBranch, P.boardOwner, P.doneLabel].every(text) || !Number.isInteger(P.boardNumber)) {
  return { stopped: 'the project data is incomplete: it needs repo, mainBranch, workingBranch, boardOwner, boardNumber and doneLabel' }
}
if (!C || !text(C.needsHuman)) return { stopped: 'the columns are incomplete: it needs needsHuman' }

const base = text(input.base) ? input.base : P.workingBranch
if (base === P.mainBranch) return { stopped: `the base is the main branch (${base})` }
// These go into commands as they are: nothing that a shell could read as something else.
const SAFE = /^[A-Za-z0-9._\/-]+$/
if (![base, P.mainBranch, P.repo, P.boardOwner, P.doneLabel].every(v => SAFE.test(v))) return { stopped: 'a branch, repository, owner or label name has characters that are not safe to put in a command' }
if (/['"\\]/.test(C.needsHuman)) return { stopped: 'the Needs Human column name has quotes or backslashes' }
const [OWNER, REPO_NAME] = P.repo.split('/')
if (!OWNER || !REPO_NAME) return { stopped: `the repository «${P.repo}» is not owner/name` }

const results = Array.isArray(input.results) ? input.results : []
const cleanup = Array.isArray(input.cleanup) ? input.cleanup.filter(text) : []
const REPORT_FILE = `.claude/worktrees/release-report-${base.replace(/[^A-Za-z0-9._-]+/g, '-')}.md`

// ---------- Reads ----------

// The last run comment of each ticket with the done label, cut down by gh itself to what the report uses: the first
// line (the result), the Rounds line and the «Out of the ticket» lines. One line of JSON per ticket, after a first one
// with the totals, so nothing is cut off silently.
const QUERY = `query { repository(owner:"${OWNER}", name:"${REPO_NAME}") { issues(labels:["${P.doneLabel}"], states:[OPEN,CLOSED], first:100, orderBy:{field:UPDATED_AT,direction:DESC}) { pageInfo{hasNextPage} totalCount nodes { number title comments(last:10){nodes{body}} } } } }`
// The command is plain ASCII, so it cannot select the comments that start with «run · » (the dot is not ASCII and a model
// may rewrite an escape for it): it keeps every comment that starts with «run », cut to the same three pieces, and the
// script takes the last one whose fifth character is the dot (see `lastRun`). The line break is built from its code.
const COMMENTS_JQ = '.data.repository.issues | ({more: .pageInfo.hasNextPage, total: .totalCount} | tojson), '
  + '(.nodes[] | . as $i | ([10] | implode) as $nl | {n: $i.number, t: $i.title, cs: [$i.comments.nodes[].body | select(startswith("run ")) '
  + '| split($nl) as $l | {head: $l[0], rounds: ([$l[] | select(startswith("Rounds: "))] | first), '
  + 'out: (($l | map(startswith("Out of the ticket")) | index(true)) as $k | if $k == null then null else ($l[$k:] | join($nl)) end)}]} | tojson)'
const CARDS_LIMIT = 200
const CARDS_JQ = `{total: .totalCount, listed: (.items | length), cards: [.items[] | select(.status == ${JSON.stringify(C.needsHuman)}) | {n: .content.number, t: .title}]} | tojson`

const reads = [
  `git rev-parse --short ${base}`, // 0
  asBase64(`git log --first-parent --format=%p%x09%s ${P.mainBranch}..${base}`), // 1: subjects can hold non-ASCII text
  `git rev-list --count ${base} --not --remotes=origin`, // 2
  asBase64(`gh api graphql -f query='${QUERY}' --jq ${shq(COMMENTS_JQ)}`), // 3: titles and comments
  asBase64(`gh project item-list ${P.boardNumber} --owner ${P.boardOwner} --format json --limit ${CARDS_LIMIT} --jq ${shq(CARDS_JQ)}`), // 4: titles
  asBase64(`gh pr list -R ${P.repo} --head ${base} --base ${P.mainBranch} --state open --json number,url,body`), // 5: the body
  `git ls-remote --heads origin ${base}`, // 6: the network last, the runner stops at the first that fails
]
const rs = await runListRetry('read', reads)
if (!rs || !rs.length) return { stopped: 'the read of git and GitHub returned nothing twice' }
const got = i => (rs[i] && loose(rs[i].command) === loose(reads[i]) ? rs[i] : null)
for (let i = 0; i < rs.length; i++) if (!got(i)) return { stopped: `the read ran «${oneLine(rs[i].command, 120)}» where «${oneLine(reads[i] || 'nothing', 120)}» was expected` }
// The outputs that are base64 are text from here on; one that is not valid stops the report before anything is written.
const notB64 = decodeAt(rs, [1, 3, 4, 5])
if (notB64) return { stopped: notB64 }
const okAt = i => (got(i) && got(i).exitCode === 0 ? got(i) : null)
if (!okAt(0)) return { stopped: `${base} does not exist here: \`${rs[0].command}\` → ${rs[0].exitCode}` }
if (!okAt(1)) return { stopped: `the merges of ${base} since ${P.mainBranch} could not be read: ${rs[1] ? `\`${rs[1].command}\` → ${rs[1].exitCode} ${oneLine(rs[1].output)}` : 'the runner stopped before'}` }

const notes = []

// ---------- The tickets merged, from the merge commits ----------

// The number is the `(#n)` that ends the subject of every merge commit, whatever the language of the subject. A revert
// of a merge (`Revert "<subject>"`, and a revert of the revert) takes the ticket out (or puts it back), oldest first.
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
const merged = mergedSinceMain(rs[1].output)

// ---------- Last run comment of each ticket ----------

// The last comment of a ticket that starts with «run · » (a dot in the fifth place: the command could not ask for it),
// with the three pieces the report uses. A ticket with none has no head.
const lastRun = o => {
  const mine = (Array.isArray(o.cs) ? o.cs : []).filter(c => c && typeof c.head === 'string' && c.head.startsWith('run · '))
  const c = mine[mine.length - 1] || {}
  return { n: o.n, t: o.t, head: c.head, rounds: c.rounds, out: c.out }
}

const info = {}
let moreTickets = false
if (okAt(3)) {
  for (const line of rs[3].output.split('\n').map(l => l.trim()).filter(Boolean)) {
    let o = null
    try { o = JSON.parse(line) } catch (e) { o = null }
    if (!o) continue
    if (o.more !== undefined) { moreTickets = !!o.more; continue }
    if (Number.isInteger(o.n)) info[o.n] = lastRun(o)
  }
  if (moreTickets) notes.push(`more than 100 tickets have the label ${P.doneLabel}: only the 100 updated last were read, so older ones have no data in this report`)
} else {
  notes.push(`the tickets and their comments could not be read (${rs[3] ? `exit code ${rs[3].exitCode}` : 'the runner stopped before'}): the report lists the merged tickets without titles or results`)
}

// What the Builder noted outside the ticket, from the «Out of the ticket» block of a run comment. The block comes in
// three forms and all of them are kept: text after the colon on the first line, unfenced lines after it (up to the next
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

// ---------- Needs Human, from the board ----------

let needsHuman = null
if (okAt(4)) {
  let o = null
  try { o = JSON.parse(rs[4].output.trim()) } catch (e) { o = null }
  if (o && Array.isArray(o.cards)) {
    needsHuman = o.cards.filter(c => Number.isInteger(c.n))
    if (o.listed >= CARDS_LIMIT || o.total > o.listed) notes.push(`the board has more than ${CARDS_LIMIT} cards: only the first ${o.listed} were read, so a card in ${C.needsHuman} may be missing`)
  }
}
if (!needsHuman) notes.push(`the cards in ${C.needsHuman} could not be read: look at the board`)

// ---------- Pull request and remote ----------

let pr = null
let prKnown = false
if (okAt(5)) {
  try { const l = JSON.parse(rs[5].output.trim()); if (Array.isArray(l)) { prKnown = true; pr = l[0] || null } } catch (e) { prKnown = false }
}
if (!prKnown) notes.push(`the pull requests of ${P.repo} could not be read: if one from ${base} exists, use \`gh pr edit\` with the file instead of the create command`)

// The `/cost` line the human filled in on the PR stays: it is not state anyone can read from git.
const PLACEHOLDER = '<the human fills it in>'
const costOf = body => {
  const m = String(body || '').match(/^- `\/cost` of the session:[ \t]*(.+)$/m)
  return m && !m[1].includes(PLACEHOLDER) ? m[1].trim() : null
}
const costLine = `- \`/cost\` of the session: ${(pr && costOf(pr.body)) || PLACEHOLDER}`

const localHead = (okAt(0) || { output: '' }).output.trim()
const aheadRead = okAt(2)
const missing = aheadRead && /^\d+$/.test(aheadRead.output.trim()) ? Number(aheadRead.output.trim()) : null
const remoteRead = okAt(6)
const remoteSha = remoteRead ? remoteRead.output.trim().split(/\s+/)[0] : ''
const remoteSha7 = remoteSha.slice(0, 7)
let remote = { state: 'unknown', missing }
if (!remoteRead) {
  notes.push('the remote (origin) could not be read: check that it has the base before the push')
} else if (!remoteSha) {
  remote = { state: 'missing', missing }
  notes.push(`${base} is not on the remote (origin): the push creates it${missing === null ? '' : `; ${missing} commits are not on origin yet`}`)
} else if (localHead && remoteSha.startsWith(localHead)) {
  remote = { state: 'up to date', missing: 0 }
} else if (missing) {
  remote = { state: 'behind', missing }
  notes.push(`the remote ${base} is behind ${base} here: ${missing} commits are not on it; push first`)
} else {
  remote = { state: 'different', missing }
  notes.push(`the remote ${base} is at ${remoteSha7} and ${base} here at ${localHead}, with no commit to push: look at the difference before pushing`)
}

// ---------- The report ----------

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
  if (r && r.status === 'done' && r.mergeCommit && !merged.includes(r.number)) notes.push(`the run merged #${r.number} (${r.mergeCommit}) but ${base} has no merge commit with (#${r.number}) since ${P.mainBranch}: look at the log`)
}

const report = [
  `## release report · ${base}`, '',
  `Tickets merged into ${base} since ${P.mainBranch}: ${merged.length}, from the \`(#n)\` of its merge commits.`, '',
  '### Tickets', '', ...(merged.length ? merged.map(ticketLine) : ['- none']), '',
  ...(results.length ? ['### Blocked in this run', '', ...(blocked.length ? blocked.map(why) : ['- none']), '',
    '### Skipped in this run', '', ...(skipped.length ? skipped.map(why) : ['- none']), ''] : []),
  `### ${C.needsHuman}`, '', ...(needsHuman && needsHuman.length ? needsHuman.map(c => `- #${c.n}${c.t ? ` «${oneLine(c.t, 160)}»` : ''}`) : [needsHuman ? '- none' : '- not read']), '',
  '### Out of the ticket (for the backlog)', '', ...(seen.length ? seen : ['- nothing']), '',
  '### Cost', '', costLine, '',
  ...merged.map(n => `Closes #${n}`),
].join('\n').trim()

// ---------- Write the file (and the run's cleanup, first) ----------

const writes = [
  ...cleanup,
  fromText(report, `{ mkdir -p .claude/worktrees; cat > ${REPORT_FILE}; }`),
  asBase64(`cat ${REPORT_FILE}`), // the report holds non-ASCII text
]
const ws = await runListRetry('write', writes)
const wgot = i => (ws && ws[i] && loose(ws[i].command) === loose(writes[i]) ? ws[i] : null)
const cleanupResults = ws ? cleanup.map((c, i) => wgot(i)).filter(Boolean) : []
const wrote = wgot(cleanup.length), back = wgot(cleanup.length + 1)
const backText = back && back.exitCode === 0 ? fromBase64(back.output) : null
const fileOk = !!wrote && wrote.exitCode === 0 && !!backText && !backText.error && norm(backText.text) === norm(report)
if (!ws) notes.push('the file could not be written (no answer twice): the report is below, paste it as the body')
else if (backText && backText.error) notes.push(`${REPORT_FILE} could not be read back (the output is not valid base64 and UTF-8: ${backText.error}): the commands below need it, so paste the report as the body`)
else if (!fileOk) notes.push(`${REPORT_FILE} was not written as it should: the commands below need it, so paste the report as the body`)

// ---------- What the human runs ----------

// The push is the first command whenever the remote lacks commits, with a PR or without one. Nothing here is run.
const needsPush = remote.state === 'missing' || remote.state === 'behind'
const commandsForTheHuman = [
  ...(needsPush ? [`git push -u origin ${base}`] : []),
  ...(pr
    ? [`gh pr edit ${pr.number} -R ${P.repo} --body-file ${REPORT_FILE}`]
    : [`gh pr create -R ${P.repo} --base ${P.mainBranch} --head ${base} --title "Release ${base.replace(/^release\//, '')}" --body-file ${REPORT_FILE}`]),
]
if (pr) notes.push(`\`gh pr edit\` replaces the body of PR #${pr.number} with the report: a \`/cost\` line filled in there is kept in the report`)

return {
  base,
  report,
  reportFile: fileOk ? REPORT_FILE : null,
  merged,
  needsHuman,
  pullRequest: pr ? { number: pr.number, url: pr.url } : null,
  baseOnRemote: remote.state === 'unknown' ? null : remote.state !== 'missing',
  remote,
  commandsForTheHuman,
  cleanupResults,
  notes,
}
