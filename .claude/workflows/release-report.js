export const meta = {
  name: 'release-report',
  description: 'Rebuild the release report from git and GitHub: the tickets merged into the working branch since the main branch, their last run comment, the tickets in Needs Human, and the commands for the human (push, then gh pr create or edit)',
  whenToUse: 'The human runs /release-report (no args: the working branch of factory.json; or a base) to rebuild the report of a release; the run workflow calls it as a child at the end of a list',
}

// The report of a release is built from state, never from what a run remembers: the merge commits of the base since the
// main branch (git log), the last run comment of every ticket on GitHub and the cards in Needs Human. It reads in one
// `runner` call (and the pages of what is long), writes the file in another, and never pushes and never opens or edits a PR:
// it returns the commands the human runs (documentation/launch-list.md, «The end of a list»). Nothing long crosses the
// `runner` in one piece: the reads come back in pages and the report goes out in pieces, each one checked by a fingerprint
// (documentation/launch-list.md, «Long text and the runner»).
// Alone: args is empty, a base («release/0.1.0») or { base }; it reads .claude/factory.json itself (one `runner` call).
// As a child of run.js (`workflow({ scriptPath }, args)`): args = { base, project, columns, small, runner, results, cleanup }.
// project, columns, small and runner are the blocks of factory.json (run.js read them already, so nothing is read twice);
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

// ---------- Long text from the runner ----------

// The `runner` copies every command and every output by hand, and a long one does not survive that (run wf_cec30c76-5dd:
// a read of about 30 KB came back cut to its first 2 KB). So a read whose output can be long, or can hold other text
// (comments, bodies, titles), is stored by its own command as base64 in a file, and read back in pages that fit
// `maxOutput`; each page comes with a fingerprint that a command computed over it, and the script checks it before it
// accepts the page, asks again for the pages that do not match, and checks the whole against the fingerprint the file had.
// The limits are in factory.json (`runner`): `maxCommand` is the longest command the script hands over; `maxOutput` the
// longest output it accepts. The fingerprint is `cksum`'s (POSIX: the same on Linux, macOS and Git Bash): "<crc> <length in bytes>".
// Scripts cannot import, so these helpers are the same in board.js and release-report.js.
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
const TMP = '.claude/worktrees/tmp-' // ignored by git; the end of a list removes what is left
const PAGES_PER_CALL = 8
let LIM = null // { maxCommand, maxOutput }: known after the first read of factory.json

// Exact text through the `runner` (run wf_c3e19634-96a): an agent that copies text by hand does not keep an escape
// (an escape sequence for the middle dot came back as `·`) or a non-ASCII character (`·` came back as `�`). So every command is plain ASCII with no
// escape sequence in it (a filter that needs another character is done here, in the script), and text with other
// characters comes back only as base64. An output that is not valid base64 and UTF-8 is a plumbing failure with its
// reason, never text with `�`.
const plainProblem = c => {
  const bad = String(c).match(/[^\x20-\x7e]|\\u[0-9a-fA-F{]|\\x[0-9a-fA-F]{2}/)
  return bad ? `«${oneLine(c, 120)}» has «${bad[0]}»` : null
}
// `command` with its output stored as base64, on one line, in a file; it prints "<exit code> <crc> <length>" of the file and
// exits 0 (the command's code travels in what it prints, so a command that fails does not stop the ones after it).
const stored = (name, command) => {
  const file = `${TMP}rd-${name}`
  return `sh -c ${shq(`mkdir -p .claude/worktrees; out=$(${command} 2>&1); code=$?; printf %s "$out" | base64 | tr -d "[:space:]" > ${file}; echo "$code $(cksum < ${file})"`)}`
}
// One page of a stored file: its characters from the (k * size + 1)th, then the fingerprint of those characters.
const pageCommand = (name, k, size) => `sh -c ${shq(`p=$(cut -c ${k * size + 1}-${(k + 1) * size} ${TMP}rd-${name}); echo "$p"; printf %s "$p" | cksum`)}`
// The page a command printed if it is exactly the characters it fingerprinted (and as many as the file has there), or null.
function pageOf(output, length) {
  const m = /^([\s\S]*)\n(\d+) (\d+)$/.exec(String(output).replace(/\r/g, '').trimEnd())
  if (!m) return null
  const page = m[1].replace(/\s+/g, '')
  return page.length === length && cksum(ascii(page)) === `${m[2]} ${m[3]}` ? page : null
}
// Base64 back to text: { text } or { error }. The line breaks `base64` adds are ignored; the rest must be exact.
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

// ---------- Long text to the runner ----------

// A text goes out in short pieces, each one a command that checks itself with a fingerprint the script computed, so the
// runner stops at the first piece that came out wrong. The text travels as base64 so that no quote, backtick or newline of
// it reaches a shell. The script has no Buffer.
function utf8(text) {
  const bytes = []
  for (const ch of String(text)) {
    const c = ch.codePointAt(0)
    if (c < 0x80) bytes.push(c)
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return bytes
}
function base64(text) {
  const bytes = utf8(text)
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2]
    const n = (a << 16) | ((b || 0) << 8) | (c || 0)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (b === undefined ? '=' : B64[(n >> 6) & 63]) + (c === undefined ? '=' : B64[n & 63])
  }
  return out
}
// The fingerprint of a file's text: what `cksum < file` prints for the bytes the script means to write.
const fingerprint = text => cksum(utf8(text))

// A text to send: { puts, unpack(tail) }. `puts` are the commands that write the pieces, in order; each writes its piece to
// its own file and fails (exit 1) unless the file has the fingerprint the script computed for that piece. `unpack(tail)` is
// the command that, only if all the pieces together have the fingerprint of the whole, decodes them into `tail`'s standard
// input and removes them: once it ran, a second run finds no pieces and does nothing, so a text goes out at most once.
function pieces(name, text) {
  const b64 = base64(text)
  const total = cksum(ascii(b64))
  const prefix = `${TMP}${name}-${total.split(' ')[0]}.`
  const put = (k, chunk) => {
    const file = `${prefix}${String(k).padStart(3, '0')}`
    return `sh -c ${shq(`mkdir -p .claude/worktrees && printf %s ${chunk} > ${file} && test "$(cksum < ${file})" = "${cksum(ascii(chunk))}"`)}`
  }
  const size = Math.floor((LIM.maxCommand - put(1, '').length - 20) / 4) * 4
  if (size < 4) throw new Error(`maxCommand (${LIM.maxCommand}) is too short to carry a piece of text`)
  const puts = []
  for (let i = 0; i < b64.length; i += size) puts.push(put(puts.length + 1, b64.slice(i, i + size)))
  if (puts.length > 999) throw new Error(`a text of ${b64.length} characters needs ${puts.length} pieces: too long`)
  const all = `${prefix}[0-9]*`
  const unpack = tail => `sh -c ${shq(`test "$(cat ${all} | cksum)" = "${total}" && cat ${all} | base64 --decode | ${tail} && rm -f ${all}`)}`
  return { puts, unpack }
}

const optsOf = step => {
  const o = {}
  if (step && step.model) o.model = step.model
  if (step && step.effort) o.effort = step.effort
  return o
}
let SMALL = {} // the model and effort of the script's small agents (factory.json, `small`)
async function runList(label, commands, own = SMALL) {
  const off = commands.map(plainProblem).find(Boolean)
  if (off) throw new Error(`a command is not plain ASCII: ${off}`)
  const long = LIM && commands.find(c => c.length > LIM.maxCommand)
  if (long) throw new Error(`a command is longer than ${LIM.maxCommand} characters (${long.length}): ${oneLine(long, 120)}`)
  const r = await agent(`Run these commands, in this order:
${commands.map((c, i) => `${i + 1}. ${c}`).join('\n')}`,
  { ...own, agentType: 'runner', label, phase: GROUP, schema: RUN_SCHEMA })
  return resultsOf(r)
}
// A null read is plumbing: it is asked once more.
const runListRetry = async (label, commands, own) => (await runList(label, commands, own)) || (await runList(`${label}:retry`, commands, own))

// The pages of the stored files, { name: { sum, length } } → { name: { text } or { error } }. Every page is checked when it
// arrives; the ones that do not match are asked again (three times in all); the whole is checked against the file's own.
async function readPages(label, files, own) {
  const size = LIM.maxOutput - 60
  const parts = {}
  for (const [name, f] of Object.entries(files)) parts[name] = Array(Math.ceil(f.length / size)).fill(null)
  const lengthOf = (name, k) => Math.min(size, files[name].length - k * size)
  for (let attempt = 1; attempt <= 3; attempt++) {
    const todo = Object.keys(parts).flatMap(name => parts[name].flatMap((p, k) => (p === null ? [{ name, k }] : [])))
    if (!todo.length) break
    const calls = []
    for (let i = 0; i < todo.length; i += PAGES_PER_CALL) calls.push(todo.slice(i, i + PAGES_PER_CALL))
    await Promise.all(calls.map(async (call, c) => {
      const commands = call.map(w => pageCommand(w.name, w.k, size))
      const rs = await runList(`${label}:pages${attempt > 1 ? `:again${attempt}` : ''}:${c + 1}`, commands, own)
      call.forEach((w, j) => {
        const r = rs && rs[j] && rs[j].exitCode === 0 && loose(rs[j].command) === loose(commands[j]) ? rs[j] : null
        const page = r ? pageOf(r.output, lengthOf(w.name, w.k)) : null
        if (page !== null) parts[w.name][w.k] = page
      })
    }))
  }
  const out = {}
  for (const [name, f] of Object.entries(files)) {
    const missing = parts[name].flatMap((p, k) => (p === null ? [k + 1] : []))
    if (missing.length) { out[name] = { error: `page ${missing.join(', ')} of ${parts[name].length} could not be read right in three tries` }; continue }
    const b64 = parts[name].join('')
    if (cksum(ascii(b64)) !== f.sum) { out[name] = { error: 'the pages do not add up to the file (hash and length differ)' }; continue }
    const d = fromBase64(b64)
    out[name] = d.error ? { error: `it is not valid base64 and UTF-8: ${d.error}` } : { text: d.text }
  }
  return out
}

// One call with plain commands and stored reads, then the pages of every stored one. specs: [{ command }] or [{ command,
// name }] for a stored read. Returns { results, error } (null if the runner answered nothing twice): results are like
// runList's, with a stored read's `output` the decoded text and its `exitCode` the command's own; error is the first
// reason an answer cannot be trusted, or null. `pre(results)`, if given, runs before the pages (the first read of
// factory.json sets the limits there).
async function runReads(label, specs, own, pre) {
  const commands = specs.map(s => (s.name ? stored(s.name, s.command) : s.command))
  const rs = await runListRetry(label, commands, own)
  if (!rs || !rs.length) return null
  for (let i = 0; i < rs.length; i++) {
    if (i >= commands.length || loose(rs[i].command) !== loose(commands[i])) return { results: rs, error: `it ran «${oneLine(rs[i].command, 120)}» where «${oneLine(commands[i] || 'nothing', 120)}» was expected` }
  }
  const bad = pre ? await pre(rs) : null
  if (bad) return { results: rs, error: bad }
  const files = {}
  const results = rs.map((r, i) => {
    if (!specs[i].name) return r
    const m = /^(\d+) (\d+) (\d+)$/.exec(String(r.output).trim())
    if (r.exitCode !== 0 || !m) return { ...r, error: `the store of «${oneLine(specs[i].command, 100)}» did not print its hash and length (exit code ${r.exitCode})` }
    files[specs[i].name] = { sum: `${m[2]} ${m[3]}`, length: Number(m[3]) }
    return { ...r, exitCode: Number(m[1]), code: Number(m[1]) }
  })
  const pages = await readPages(label, files, own)
  let error = null
  results.forEach((r, i) => {
    if (r.error) { error = error || r.error; return }
    const name = specs[i].name
    if (!name) return
    const p = pages[name]
    if (p.error) { error = error || `the output of \`${oneLine(specs[i].command, 100)}\` could not be read: ${p.error}`; results[i] = { ...r, error: p.error, output: '' } } else results[i] = { ...r, output: p.text }
  })
  return { results, error }
}

// ---------- Input ----------

const isObject = args !== null && typeof args === 'object' && !Array.isArray(args)
const input = isObject ? args : args == null ? {} : { base: args }

const limitsOk = l => !!l && Number.isInteger(l.maxCommand) && l.maxCommand >= 1100 && Number.isInteger(l.maxOutput) && l.maxOutput >= 400
let P = input.project, C = input.columns
if (P && C && limitsOk(input.runner)) {
  SMALL = optsOf(input.small)
  LIM = input.runner
} else {
  // Alone: the only read of factory.json. No model here: `small` is not known yet, so the runner's own. The file is read
  // in pages cut by the limits that are in it: one `grep` prints them in the same call that stores the file.
  const limits = output => {
    const get = k => { const m = new RegExp(`"${k}":\\s*(\\d+)`).exec(output); return m ? Number(m[1]) : 0 }
    return { maxCommand: get('maxCommand'), maxOutput: get('maxOutput') }
  }
  const first = await runReads('factory.json', [{ command: `grep -o ${shq('"max[A-Za-z]*": *[0-9]*')} ${FACTORY_JSON}` }, { name: 'factory', command: `cat ${FACTORY_JSON}` }], {}, rs => {
    const l = limits(rs[0] && rs[0].exitCode === 0 ? rs[0].output : '')
    if (!limitsOk(l)) return `${FACTORY_JSON} must give runner.maxCommand (an integer, at least 1100) and runner.maxOutput (an integer, at least 400), each on one line as "name": number`
    LIM = l
    return null
  })
  if (!first) return { stopped: `${FACTORY_JSON} is missing or cannot be read` }
  if (first.error) return { stopped: `${FACTORY_JSON} cannot be read: ${first.error}` }
  const read = first.results[1]
  if (!read || read.exitCode !== 0) return { stopped: `${FACTORY_JSON} is missing or cannot be read` }
  let F
  try { F = JSON.parse(read.output.trim()) } catch (e) { return { stopped: `${FACTORY_JSON} is not valid JSON: ${e.message}` } }
  P = F && F.project
  C = F && F.columns
  SMALL = optsOf(F && F.small)
  if (!F || !F.runner || F.runner.maxCommand !== LIM.maxCommand || F.runner.maxOutput !== LIM.maxOutput) return { stopped: `${FACTORY_JSON} is invalid: runner is not the one the pages were cut by (${JSON.stringify(LIM)}): the keys must be written as "maxCommand": n and "maxOutput": n, once each` }
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
// with the totals, so nothing is cut off silently. Only the last run comment of each ticket is printed (a ticket with ten
// comments is one line, not ten), and the whole is read in pages like any long text.
const QUERY = `query { repository(owner:"${OWNER}", name:"${REPO_NAME}") { issues(labels:["${P.doneLabel}"], states:[OPEN,CLOSED], first:100, orderBy:{field:UPDATED_AT,direction:DESC}) { pageInfo{hasNextPage} totalCount nodes { number title comments(last:10){nodes{body}} } } } }`
// The command is plain ASCII, so the dot of «run · » is its code, 183: a comment is a run comment if it starts with «run »
// and has the dot in the fifth place. The line break is built from its code too.
const COMMENTS_JQ = '.data.repository.issues | ({more: .pageInfo.hasNextPage, total: .totalCount} | tojson), '
  + '(.nodes[] | . as $i | ([10] | implode) as $nl | ([$i.comments.nodes[].body | select(startswith("run ") and ((.[4:5] | explode) == [183]))] | last) as $b '
  + '| {n: $i.number, t: $i.title} + (if $b == null then {} else ($b | split($nl) as $l | {head: $l[0], rounds: ([$l[] | select(startswith("Rounds: "))] | first), '
  + 'out: (($l | map(startswith("Out of the ticket")) | index(true)) as $k | if $k == null then null else ($l[$k:] | join($nl)) end)}) end) | tojson)'
const CARDS_LIMIT = 200
const CARDS_JQ = `{total: .totalCount, listed: (.items | length), cards: [.items[] | select(.status == ${JSON.stringify(C.needsHuman)}) | {n: .content.number, t: .title}]} | tojson`

const reads = [
  { command: `git rev-parse --short ${base}` }, // 0
  { name: 'log', command: `git log --first-parent --format=%p%x09%s ${P.mainBranch}..${base}` }, // 1: subjects can hold non-ASCII text
  { command: `git rev-list --count ${base} --not --remotes=origin` }, // 2
  { name: 'comments', command: `gh api graphql -f query='${QUERY}' --jq ${shq(COMMENTS_JQ)}` }, // 3: titles and comments
  { name: 'cards', command: `gh project item-list ${P.boardNumber} --owner ${P.boardOwner} --format json --limit ${CARDS_LIMIT} --jq ${shq(CARDS_JQ)}` }, // 4: titles
  { name: 'prs', command: `gh pr list -R ${P.repo} --head ${base} --base ${P.mainBranch} --state open --json number,url,body` }, // 5: the body
  { command: `git ls-remote --heads origin ${base}` }, // 6: the network last, the runner stops at the first that fails
]
// The stored ones are text from here on; an answer that cannot be trusted stops the report before anything is written.
const read = await runReads('read', reads)
if (!read) return { stopped: 'the read of git and GitHub returned nothing twice' }
if (read.error) return { stopped: `the read could not be trusted: ${read.error}` }
const rs = read.results
const got = i => rs[i] || null
const okAt = i => (got(i) && got(i).exitCode === 0 ? got(i) : null)
if (!okAt(0)) return { stopped: `${base} does not exist here: \`${reads[0].command}\` → ${rs[0].exitCode}` }
if (!okAt(1)) return { stopped: `the merges of ${base} since ${P.mainBranch} could not be read: ${rs[1] ? `\`${reads[1].command}\` → ${rs[1].exitCode} ${oneLine(rs[1].output)}` : 'the runner stopped before'}` }

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

// The last comment of a ticket that starts with «run · », with the three pieces the report uses (the read already kept
// only that one). A ticket with none has no head.
const lastRun = o => {
  const run = typeof o.head === 'string' && o.head.startsWith('run · ')
  return { n: o.n, t: o.t, head: run ? o.head : undefined, rounds: run ? o.rounds : undefined, out: run ? o.out : undefined }
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

// The report goes out in pieces, each one checked by its own command, and is confirmed by the file's fingerprint (`cksum`),
// not by the runner copying the file back. The first call carries the run's cleanup; if the file is not confirmed and the
// runner did answer, one more call sends the pieces again (the cleanup is not repeated). The files of the pieces and of the
// reads (`tmp-` in .claude/worktrees) are removed in the same call.
const msg = pieces('report', report)
const mine = fingerprint(report)
const sendReport = [...msg.puts, msg.unpack(`{ mkdir -p .claude/worktrees; cat > ${REPORT_FILE}; }`), `cksum < ${REPORT_FILE}`]
const tidy = `rm -f ${TMP}*`
// How a command of the call went: ok, failed (non-zero exit), changed (the runner ran another command than the one asked) or missing.
const outcome = (results, i, command) => {
  const r = results && results[i]
  if (!r) return { kind: 'missing' }
  if (loose(r.command) !== loose(command)) return { kind: 'changed', r }
  return { kind: r.exitCode === 0 ? 'ok' : 'failed', r }
}
const KIND = { missing: 'was not run', changed: 'was run as another command: the runner did not copy it as it was', failed: 'failed its check: the runner did not copy it as it was' }
// Why the file is not confirmed after a call whose results for sendReport start at `at`, or null if it is.
const notSent = (results, at) => {
  const o = i => outcome(results, at + i, sendReport[i])
  const bad = msg.puts.findIndex((_, i) => o(i).kind !== 'ok')
  if (bad >= 0) return `piece ${bad + 1} of ${msg.puts.length} ${KIND[o(bad).kind]}`
  if (o(msg.puts.length).kind !== 'ok') return 'the command that joins the pieces did not run as asked or failed'
  const last = o(sendReport.length - 1)
  const printed = last.kind === 'ok' ? String(last.r.output).trim() : ''
  if (!printed) return 'the fingerprint of the file could not be read'
  return printed === mine ? null : `the file has hash and length ${printed}, not ${mine}`
}
const ws = await runListRetry('write', [...cleanup, ...sendReport, tidy])
const cleanupResults = ws ? cleanup.map((c, i) => (ws[i] && loose(ws[i].command) === loose(c) ? ws[i] : null)).filter(Boolean) : []
let problem = ws ? notSent(ws, cleanup.length) : 'the runner answered nothing twice'
if (ws && problem) {
  const again = await runList('write:again', [...sendReport, tidy])
  problem = again ? notSent(again, 0) : `${problem}; and the second call answered nothing`
}
const fileOk = !problem
if (!fileOk) notes.push(`${REPORT_FILE} was not written as it should (${problem}): the commands below need it, so paste the report as the body`)

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
