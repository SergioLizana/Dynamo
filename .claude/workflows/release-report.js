export const meta = {
  name: 'release-report',
  description: 'Rebuild the release report from git and GitHub: the tickets merged into the working branch since the main branch, their last run comment, the tickets in Needs Human, and the commands for the human (push, then gh pr create or edit)',
  whenToUse: 'The human runs /release-report (no args: the working branch of factory.json; or a base) to rebuild the report of a release; the run workflow calls it as a child at the end of a list',
}

// The report of a release is built from state, never from what a run remembers: the merge commits of the base since the
// main branch (git log), the last run comment of every ticket on GitHub and the cards in Needs Human. A workflow script
// cannot read a file or run a command, and everything that crosses the `runner` is copied by hand, so the script reads and
// writes nothing big: the command .claude/workflows/lib/read.js does the reads where the data is, builds the report file
// itself and prints ONE SHORT LINE (the file, its length and hash, and a few counts); the script checks that line against the
// hash and length the command printed with it and builds the commands for the human from it (documentation/launch-list.md,
// «The end of a list» and «Long text and the runner»). It never pushes and never opens or edits a PR: it returns the commands
// the human runs.
// Alone: args is empty, a base («release/0.1.0») or { base }; the command reads .claude/factory.json itself.
// As a child of run.js (`workflow({ scriptPath }, args)`): args = { base, small, runner, results, cleanup }.
// small and runner are the blocks of factory.json (run.js read them already); results are the tickets of the run (blocked and
// skipped ones are told in the report, and a merge the log does not show is a note), which go to the command in pieces, each
// one checked by the command; cleanup is a list of commands the run wants executed in the same `runner` call (the copies it
// made), whose results are returned untouched.

const LIB = '.claude/workflows/lib/read.js'
const GROUP = 'Report'

// ---------- Helpers (the same as board.js and run.js where they repeat: a child workflow cannot import) ----------

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

// ---------- The text to the command ----------

// The results of the run go out in short pieces, each one a command of the same lib that checks itself with a fingerprint
// the script computed, so the runner stops at the first piece that came out wrong. The text travels as base64 so that no
// quote, backtick or newline of it reaches a shell. The script has no Buffer.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
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
// { puts, total }: `puts` are the commands that store the pieces, in order (the command fails unless the piece arrived with
// the hash and length printed in it); `total` is the "<crc>.<length>" of the whole, which the release command checks before it
// uses the pieces.
function pieces(name, text, maxCommand) {
  const b64 = base64(text)
  const put = (k, chunk) => `node ${LIB} put ${name} ${k} ${chunk} ${cksum(ascii(chunk))}`
  const size = Math.floor((maxCommand - put(999, '').length - 20) / 4) * 4
  if (size < 4) throw new Error(`maxCommand (${maxCommand}) is too short to carry a piece of text`)
  const puts = []
  for (let i = 0; i < b64.length; i += size) puts.push(put(puts.length + 1, b64.slice(i, i + size)))
  if (puts.length > 999) throw new Error(`a text of ${b64.length} characters needs ${puts.length} pieces: too long`)
  return { puts, total: cksum(ascii(b64)).replace(' ', '.') }
}

const optsOf = step => {
  const o = {}
  if (step && step.model) o.model = step.model
  if (step && step.effort) o.effort = step.effort
  return o
}
let SMALL = {} // the model and effort of the script's small agents (factory.json, `small`)
let LIM = null // { maxCommand, maxOutput, maxLine } of factory.json, if the run passed them
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

// ---------- Input ----------

const isObject = args !== null && typeof args === 'object' && !Array.isArray(args)
const input = isObject ? args : args == null ? {} : { base: args }
const text = v => typeof v === 'string' && v.length > 0
if (input.runner && Number.isInteger(input.runner.maxCommand) && input.runner.maxCommand >= 1100) LIM = input.runner
SMALL = optsOf(input.small)

// The base goes into a command as it is: nothing that a shell could read as something else.
const SAFE = /^[A-Za-z0-9._\/-]+$/
if (text(input.base) && !SAFE.test(input.base)) return { stopped: 'the base has characters that are not safe to put in a command' }
const results = Array.isArray(input.results) ? input.results : []
const cleanup = Array.isArray(input.cleanup) ? input.cleanup.filter(text) : []
if (results.length && !LIM) return { stopped: 'the results of the run need runner.maxCommand (factory.json) to travel in pieces' }

// ---------- The call ----------

// What the command needs of the run: the number, the status, the reason and the merge commit of each ticket.
const sent = results.filter(r => r && Number.isInteger(r.number)).map(r => ({
  number: r.number, status: r.status, reason: oneLine(r.reason || r.note || 'no reason given'), mergeCommit: r.mergeCommit,
}))
const msg = results.length ? pieces('results', JSON.stringify(sent), LIM.maxCommand) : { puts: [], total: '' }
const release = `node ${LIB} release ${text(input.base) ? input.base : '-'}${results.length ? ` results ${msg.total}` : ''}`
const tidy = `node ${LIB} tidy`
const build = [...msg.puts, release, tidy]

// How a command of the call went: ok, failed (non-zero exit), changed (the runner ran another command than the one asked) or missing.
const outcome = (rs, i, command) => {
  const r = rs && rs[i]
  if (!r) return { kind: 'missing' }
  if (loose(r.command) !== loose(command)) return { kind: 'changed', r }
  return { kind: r.exitCode === 0 ? 'ok' : 'failed', r }
}
const KIND = { missing: 'was not run', changed: 'was run as another command: the runner did not copy it as it was', failed: 'failed' }
// The line of the release command in a call whose results for `build` start at `at`: { line } or { problem, reason }.
// A line is trusted only if its hash and length are its own; a command that failed explains itself in an `error` line.
function built(rs, at) {
  const bad = msg.puts.findIndex((_, i) => outcome(rs, at + i, build[i]).kind !== 'ok')
  if (bad >= 0) {
    const o = outcome(rs, at + bad, build[bad])
    const said = o.r && lineOf(o.r.output)
    return { problem: `piece ${bad + 1} of ${msg.puts.length} ${KIND[o.kind]}${said && said.kind === 'error' ? `: ${said.reason}` : ''}` }
  }
  const i = msg.puts.length
  const o = outcome(rs, at + i, release)
  if (o.kind === 'missing' || o.kind === 'changed') return { problem: `the release command ${KIND[o.kind]}` }
  const line = lineOf(o.r.output)
  if (!line) return { problem: 'the line the release command printed does not have its own hash and length: the runner did not copy it as it was' }
  if (line.kind === 'error') return { problem: line.reason, stopped: true }
  if (o.kind !== 'ok' || line.kind !== 'release') return { problem: `the release command ${KIND[o.kind === 'ok' ? 'failed' : o.kind]}` }
  return { line }
}

// The first call carries the run's cleanup; if the line cannot be trusted and the runner did answer, one more call runs the
// command again (the cleanup is not repeated): it builds the same file from the same state.
const first = await runListRetry('release', [...cleanup, ...build])
const cleanupResults = first ? cleanup.map((c, i) => (first[i] && loose(first[i].command) === loose(c) ? first[i] : null)).filter(Boolean) : []
let result = first ? built(first, cleanup.length) : { problem: 'the runner answered nothing twice' }
if (first && result.problem && !result.stopped) {
  const again = await runList('release:again', build)
  result = again ? built(again, 0) : { problem: `${result.problem}; and the second call answered nothing` }
}

const notes = []
if (result.stopped) return { stopped: result.problem, cleanupResults }
if (result.problem) {
  notes.push(`the release report was not built or could not be confirmed (${result.problem}): nothing was taken from it; launch /release-report`)
  return { base: text(input.base) ? input.base : null, reportFile: null, commandsForTheHuman: [], cleanupResults, notes }
}

// ---------- What the command printed ----------

const f = result.line
const count = v => (/^\d+$/.test(v) ? Number(v) : null)
const base = f.base
const missing = count(f.missing)
const remote = { state: f.remote === 'up-to-date' ? 'up to date' : f.remote, missing }
const pr = count(f.pr) === null ? null : { number: count(f.pr), url: `https://github.com/${f.repo}/pull/${count(f.pr)}` }

// The notes are codes with arguments; the text of each is here.
const NOTE = {
  'more-tickets': () => 'more than 100 tickets have the done label: only the 100 updated last were read, so older ones have no data in this report',
  'no-tickets': code => `the tickets and their comments could not be read (exit code ${code}): the report lists the merged tickets without titles or results`,
  'cards-more': listed => `the board has more than 200 cards: only the first ${listed} were read, so a card in the Needs Human column may be missing`,
  'no-cards': () => 'the cards in the Needs Human column could not be read: look at the board',
  'no-prs': () => `the pull requests of the repository could not be read: if one from ${base} exists, use \`gh pr edit\` with the file instead of the create command`,
  'no-remote': () => 'the remote (origin) could not be read: check that it has the base before the push',
  'remote-missing': n => `${base} is not on the remote (origin): the push creates it${n === '-' ? '' : `; ${n} commits are not on origin yet`}`,
  'remote-behind': n => `the remote ${base} is behind ${base} here: ${n} commits are not on it; push first`,
  'remote-different': (remoteSha, localSha) => `the remote ${base} is at ${remoteSha} and ${base} here at ${localSha}, with no commit to push: look at the difference before pushing`,
  unmerged: (n, sha) => `the run merged #${n} (${sha}) but ${base} has no merge commit with (#${n}) since ${f.main}: look at the log`,
}
for (const code of f.notes ? f.notes.split(',') : []) {
  const [name, ...a] = code.split(':')
  const say = NOTE[name]
  notes.push(say ? say(...a) : `the command reported «${code}», which this script does not know: look at the report`)
}

// ---------- What the human runs ----------

// The push is the first command whenever the remote lacks commits, with a PR or without one. Nothing here is run.
const needsPush = remote.state === 'missing' || remote.state === 'behind'
const commandsForTheHuman = [
  ...(needsPush ? [`git push -u origin ${base}`] : []),
  ...(pr
    ? [`gh pr edit ${pr.number} -R ${f.repo} --body-file ${f.file}`]
    : [`gh pr create -R ${f.repo} --base ${f.main} --head ${base} --title "Release ${base.replace(/^release\//, '')}" --body-file ${f.file}`]),
]
if (pr) notes.push(`\`gh pr edit\` replaces the body of PR #${pr.number} with the report: a \`/cost\` line filled in there is kept in the report`)

return {
  base,
  reportFile: f.file,
  reportSum: f.sum, // "<crc>.<length>" of the file, as `cksum < file` prints it
  mergedCount: count(f.merged),
  needsHumanCount: count(f.needs),
  pullRequest: pr,
  baseOnRemote: remote.state === 'unknown' ? null : remote.state !== 'missing',
  remote,
  commandsForTheHuman,
  cleanupResults,
  notes,
}
