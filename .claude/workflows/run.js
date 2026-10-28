export const meta = {
  name: 'run',
  description: 'Build a list of tickets: read the board, build each ready ticket in its own copy, check it, review it, merge one at a time into the working branch, block or skip the rest',
  whenToUse: 'The human runs /run with ticket numbers (or none, for every open ticket not done or blocked)',
}

// A dumb orchestrator: the script only decides what runs next. State comes from GitHub and from what the agents
// return. Project data, board columns and phases come from .claude/factory.json, read by board.js (the start) without an
// agent's summary. The Builder and the Reviewer are the only agents that think; every other step is a list of literal
// commands in one `runner` call (.claude/agents/runner.md), one agent per phase and not per command, and the script
// decides from the exit codes and the outputs. Text an agent wrote reaches a prompt of the others never, and a GitHub
// comment only as quoted data. One phase = one column = one agent. To add one: an entry in factory.json and a function
// in PHASES (documentation/launch-list.md, «The phases»). The `runner` copies by hand, so no command is longer than
// `runner.maxCommand` of factory.json, and a long text goes out in pieces and is confirmed by a fingerprint (below,
// «Long text through the runner»; documentation/launch-list.md, «Long text and the runner»).

const NAME = 'run' // the same as meta.name
const FACTORY_JSON = '.claude/factory.json'
const BOARD_WORKFLOW = '.claude/workflows/board.js' // the start, run as a child
const REPORT_WORKFLOW ='.claude/workflows/release-report.js' // the end of the list, run as a child
const MAX_ROUNDS = 2

// Trial failure 4: a commit must be a sha, not «HEAD of …».
const SHA = { type: 'string', pattern: '^[0-9a-f]{7,40}$' }
const CHECKS = { type: 'array', items: { type: 'object', required: ['command', 'exitCode', 'output'],
  properties: { command: { type: 'string' }, exitCode: { type: 'integer' }, output: { type: 'string' } } } }

// What the `runner` returns: each command it ran, in order, up to the first that failed. Run wf_41e0b269-ab2: an
// agent's summary of a command is not the command, so the runner returns the literal output and the script parses it.
const RUN_SCHEMA = { type: 'object', required: ['results'], properties: { results: CHECKS } }
// Run wf_fb8329e5-d57: for a command that printed nothing the runner sometimes returned the Bash tool's placeholder,
// and a clean `git status` read as changes. Every runner result comes through here, so every check sees "".
const NO_OUTPUT = '(Bash completed with no output)'
const resultsOf = r => r && Array.isArray(r.results)
  ? r.results.map(x => x && String(x.output).trim() === NO_OUTPUT ? { ...x, output: '' } : x)
  : null

const STRINGS = { type: 'array', items: { type: 'string' } }
const BUILD_SCHEMA = {
  type: 'object',
  required: ['worktreePath', 'worktreeBranch', 'branch', 'commit', 'needsHuman', 'needsHumanReason', 'published', 'noTrace', 'outOfTicket'],
  properties: {
    worktreePath: { type: 'string' }, worktreeBranch: { type: 'string' }, branch: { type: 'string' },
    commit: { anyOf: [SHA, { type: 'null' }] }, needsHuman: { type: 'boolean' }, needsHumanReason: { type: 'string' },
    published: STRINGS, noTrace: STRINGS, outOfTicket: STRINGS,
  },
}

// The verdict is a field, not a line of the report: a regex on the report would read a FAIL that quotes
// «VERDICT: PASS» as a PASS.
const REVIEW_SCHEMA = {
  type: 'object',
  required: ['verdict', 'report'],
  properties: { verdict: { type: 'string', enum: ['PASS', 'FAIL'] }, report: { type: 'string' } },
}

// ---------- Small helpers ----------

const squash = s => String(s).replace(/\s+/g, ' ').trim()
// The same command as asked, whatever the quoting the runner echoed: a missing or reordered command still shows.
const loose = s => String(s).replace(/['"\s]/g, '')
const normPath = p => String(p).trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
const norm = s => String(s).replace(/\r\n/g, '\n').trim()
const oneLine = (s, max = 300) => {
  const x = String(s).replace(/\s+/g, ' ').trim()
  return x.length > max ? `${x.slice(0, max - 1)}…` : x
}
const clip = (s, max = 4000) => {
  const x = String(s).trim()
  return x.length > max ? `${x.slice(0, max - 1)}…` : x
}
// One argument for `sh -c '…'`: the text inside single quotes, with its own single quotes escaped.
const shq = s => `'${String(s).split("'").join("'\\''")}'`
// Agent text goes into a comment only inside a fenced block longer than any run of backticks it has, so it is data:
// it opens no other block and mentions nobody.
function fence(text) {
  const body = clip(text)
  const runs = body.match(/`+/g) || []
  const f = '`'.repeat(Math.max(2, ...runs.map(r => r.length)) + 1)
  return `${f}text\n${body}\n${f}`
}

// ---------- Long text through the runner ----------

// The `runner` copies every command and every output by hand, and long text does not survive that (run wf_cec30c76-5dd:
// a typo in a 4.5 KB command, a dropped code fence, a read cut by the Bash tool at about 2 KB). So nothing long crosses
// in one piece. A text goes out in short pieces, each one a command that checks itself with a fingerprint the script
// computed, so the runner stops at the first piece that came out wrong; a text that comes back is not copied back at all,
// a command computes its fingerprint and the script compares it with its own. The limits are in factory.json
// (`runner`, read at the start): `maxCommand` is the longest command the script hands over; `maxOutput` the longest output
// it accepts. Scripts cannot import, so these helpers are the same in run.js and release-report.js.
// The fingerprint is `cksum`'s (POSIX: the same on Linux, macOS and Git Bash): "<crc> <length in bytes>".
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
const ascii = s => Array.from(String(s), ch => ch.charCodeAt(0))
// The fingerprint of a text as GitHub keeps it (no carriage returns, no blank edges): what `cksum` prints for the same text.
const fingerprint = text => cksum(utf8(String(text).replace(/\r/g, '').trim()))

// Base64 of a text: the pieces carry it so that no quote, backtick or newline of the text reaches a shell. The script has no Buffer.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
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

// A text to send: { puts, unpack(tail) }. `puts` are the commands that write the pieces, in order; each writes its piece to
// its own file and fails (exit 1) unless the file has the fingerprint the script computed for that piece. `unpack(tail)` is
// the command that, only if all the pieces together have the fingerprint of the whole, decodes them into `tail`'s standard
// input and removes them: once it ran, a second run finds no pieces and does nothing, so a text goes out at most once.
const TMP = '.claude/worktrees/tmp-' // ignored by git; the end of a list removes what is left
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

// Exact text through the `runner` (run wf_c3e19634-96a): an agent that copies text by hand does not keep an escape
// (an escape sequence for the middle dot came back as `·`) or a non-ASCII character (`·` came back as `�`). So every
// command is plain ASCII with no escape sequence in it (a filter that needs another character is done here, in the
// script), and text with other characters travels only as base64 in pieces (above). A command that is not plain ASCII is
// refused before it is sent.
const plainProblem = c => {
  const bad = String(c).match(/[^\x20-\x7e]|\\u[0-9a-fA-F{]|\\x[0-9a-fA-F]{2}/)
  return bad ? `«${oneLine(c, 120)}» has «${bad[0]}»` : null
}

// ---------- Phases ----------

// One function per phase of factory.json, picked by its name. It gets the ticket, its state (ctx) and its entry (ph) and
// returns: prompt; schema, isolation and serial (one at a time in the main folder), if it needs them; step, the word for
// «Stopped at»; exec(), instead of the prompt, for a phase the script decides itself from `runner` calls (it moves its
// own card); and read(result) → { pass: true } or { pass: false, failure, stop?, step? }. On a failure the ticket goes
// where the phase's onFail says; stop blocks it whatever onFail says.

// The Builder's rules live in one place, .claude/agents/builder.md (the phase's agentType); here only the data of this
// ticket goes in. Trial failure 2 (in the definition): round 2 brings round 1's commits with cherry-pick, only if any.
function buildPhase(t, ctx) {
  const prev = ctx.prev
  const second = !prev ? '' : `
Previous round's branch: \`${prev.branch}\`${prev.commit ? ` (commit ${prev.commit})` : ' (no commit)'}.
What failed:
${ctx.failure}`
  return {
    step: 'build',
    schema: BUILD_SCHEMA,
    isolation: 'worktree',
    prompt: `Ticket #${t.number} («${t.title}») in repo \`${P.repo}\`. Base: \`${base}\`. Round: ${ctx.round}. Documents language: ${P.documentsLanguage}.${second}`,
    read: async b => {
      builds.push({ number: t.number, round: ctx.round, worktreePath: b.worktreePath, worktreeBranch: b.worktreeBranch, branch: b.branch, commit: b.commit })
      ctx.build = b
      // Trial failure 3: a second round cannot fix a ticket that needs the human.
      if (b.needsHuman) return { pass: false, stop: true, failure: `needs the human: ${b.needsHumanReason}` }
      if (!b.commit) return { pass: false, failure: 'the Builder made no commit' }
      // The base moves while other tickets merge in parallel, so the check does not diff against its name: it diffs
      // against the commit the copy started from, read here in the copy. A null read is retried once (plumbing).
      const mb = await runListRetry(`base:#${t.number}:r${ctx.round}`, [`git -C ${b.worktreePath} merge-base HEAD ${base}`], 'Build')
      if (!mb || !mb.length) return infrastructure('the base of the copy could not be read (merge-base): no answer twice')
      const sha = mb[0].exitCode === 0 ? mb[0].output.trim() : ''
      if (!/^[0-9a-f]{40}$/.test(sha)) return { pass: false, stop: true, failure: `the base of the copy could not be pinned: \`${mb[0].command}\` → ${mb[0].exitCode}\n${mb[0].output}` }
      ctx.baseSha = sha
      return { pass: true }
    },
  }
}

// Verify is decided here, not by an agent: one `runner` call runs the card move with its read-back, the folder the
// checks run in, the state of the copy, its commit and the commands of the check, and the script decides from the exit
// codes and from which commands ran. `<base>` in the check is the sha the copy started from (ctx.baseSha), not the
// branch name, which moves while other tickets merge. A call that did not run what it should is plumbing: retried once,
// and a second time it stops the ticket as «infrastructure» without using a round.
// The folder does not carry over between the runner's Bash calls, so each check goes inside `sh -c 'cd <copy> && <command>'`,
// one literal command that runs in the Builder's copy (sh exists on Linux, macOS and Git Bash).
// The call ends with the card move of the next phase when that phase moves it at its start: the runner stops at the
// first failed command, so the card only moves if every check passed, and one agent less is launched.
const inCopy = (dir, command) => `sh -c '${`cd ${dir} && ${command}`.split("'").join("'\\''")}'`
function verifyPhase(t, ctx, ph) {
  const b = ctx.build
  const dir = b.worktreePath
  const next = F.phases[F.phases.findIndex(p => p.name === ph.name) + 1]
  const fold = next && next.moveCard === 'start' ? next : null
  const nChecks = P.checks.length
  const commands = [
    ...cardCommands(t.number, ph.column), // 0, 1
    inCopy(dir, 'git rev-parse --show-toplevel'), // 2: the folder the checks run in, run the same way as they do
    `git -C ${dir} status --porcelain`, // 3
    `git -C ${dir} rev-parse --short HEAD`, // 4
    ...P.checks.map(c => inCopy(dir, c.split('<base>').join(ctx.baseSha))), // 5...
    ...(fold ? cardCommands(t.number, fold.column) : []), // the last two
  ]
  // Why the answer cannot be trusted (the call is repeated), or null.
  function plumbing(results) {
    if (!results || !results.length) return 'no answer'
    for (let i = 0; i < results.length; i++) {
      if (i >= commands.length || squash(results[i].command) !== squash(commands[i])) return `it ran «${results[i].command}» where «${commands[i] || 'nothing'}» was expected`
    }
    if (results.length < 2 || results[0].exitCode !== 0 || results[1].exitCode !== 0 || !cardIn(results[1].output, ph.column)) return `the card did not reach ${ph.column}`
    if (results.length > 2 && (results[2].exitCode !== 0 || normPath(results[2].output) !== normPath(dir))) return `the checks would not run in the copy: it printed «${squash(results[2].output)}» for ${dir}`
    if (results.length < commands.length && results.every(r => r.exitCode === 0)) return 'not every command ran'
    return null
  }
  return {
    step: 'check',
    exec: async () => {
      let why = null
      for (let attempt = 1; attempt <= 2; attempt++) {
        const results = await runList(`verify:#${t.number}:r${ctx.round}${attempt > 1 ? ':retry' : ''}`, commands, ph.name,
          optsOf({ model: ph.model, effort: ph.effort }))
        why = plumbing(results)
        if (!why) return results
        log(`#${t.number} verify, attempt ${attempt}: ${why}`)
      }
      return { plumbing: why }
    },
    read: results => {
      if (results.plumbing) return infrastructure(`the check could not be run: ${results.plumbing}, twice`)
      const bad = []
      const failed = results.slice(2, 5 + nChecks).find(r => r.exitCode !== 0)
      if (failed) bad.push(`\`${failed.command}\` → ${failed.exitCode}\n${failed.output}`)
      const status = results[3], head = results[4]
      if (status && status.exitCode === 0 && status.output.trim()) bad.push(`uncommitted changes in the copy:\n${status.output}`)
      if (head && head.exitCode === 0) {
        const sha = head.output.trim()
        if (!sha || !(sha.startsWith(b.commit) || b.commit.startsWith(sha))) bad.push(`it ran on «${sha}», not on the Builder's commit ${b.commit}`)
      }
      ctx.checks = results.slice(5, 5 + nChecks)
      if (bad.length) return { pass: false, failure: `The automatic check failed (against ${ctx.baseSha}):\n${bad.join('\n')}` }
      // The next phase's card is moved only if its read-back shows it there; otherwise the loop moves it as usual.
      if (fold && results.length === commands.length && results[commands.length - 1].exitCode === 0 && cardIn(results[commands.length - 1].output, fold.column)) ctx.cardAt = fold.column
      return { pass: true }
    },
  }
}

function reviewPhase(t, ctx) {
  const b = ctx.build
  return {
    step: 'review',
    schema: REVIEW_SCHEMA,
    prompt: `Review ticket ${t.number} of repo ${P.repo}. Base: ${base}. Documents language: ${P.documentsLanguage}.
The change is committed on branch \`${b.branch}\` (commit ${b.commit}), checked out in the Builder's copy
\`${b.worktreePath}\`. Your working folder does not carry over between Bash calls, so do not rely on a \`cd\`: run every
git command as \`git -C ${b.worktreePath} …\` (the diff is \`git -C ${b.worktreePath} diff ${base}...HEAD\`, where HEAD is the
change) and read every file by its path inside the copy. A command that must run in the copy goes in one call as
\`${inCopy(b.worktreePath, '<command>')}\`. Change nothing in the copy.
The automatic check passed in the Builder's copy: ${ctx.checks.map(c => `\`${c.command}\` → ${c.exitCode}`).join('; ')}.
Return the verdict (PASS or FAIL) in \`verdict\` and the full report, in the shape of your definition, in \`report\`.
Round ${ctx.round}.${ctx.prevVerdict ? `\nYour previous verdict, word for word:\n${ctx.prevVerdict}` : ''}`,
    read: r => {
      const verdict = r.report
      ctx.verdict = verdict
      ctx.verdictWord = r.verdict
      if (r.verdict === 'PASS') return { pass: true }
      ctx.prevVerdict = verdict
      const forBuilder = (verdict.match(/For the Builder:[\s\S]*?(?=\nNotes|$)/) || [verdict])[0]
      return { pass: false, failure: `The reviewer said FAIL. ${forBuilder}` }
    },
  }
}

// Merge is decided here, not by an agent: a sequence of `runner` calls inside the serial slot, each one with the
// commands the script chose, and every fact read from a command's output.
//   call 1: status and branch of the main folder, a gate that stops the runner if they are wrong, the merge, the
//           checks with `<base>` = HEAD~1 (the base before the merge: the base's own name would compare the branch with
//           itself), and the proof, `git merge-base --is-ancestor` and `git rev-parse`. The runner stops at the first
//           command that fails, so a failed check never reaches the proof.
//   abort / revert: one more call, only when the merge conflicts or a check fails.
//   call 2: the label, the card to its column read back, and the comment the script wrote, read back.
// If call 1 returns nothing (or not what was asked), the state is read, not guessed: a branch that is an ancestor of HEAD
// is merged, and the checks are run again.
function mergePhase(t, ctx, ph) {
  const branch = ctx.build.branch
  const mergeChecks = P.checks.map(c => c.split('<base>').join('HEAD~1'))
  const n = mergeChecks.length
  const optsM = optsOf({ model: ph.model, effort: ph.effort })
  const tag = `merge:#${t.number}:r${ctx.round}`
  const gate = `sh -c ${shq(`test -z "$(git status --porcelain --untracked-files=no)" && test "$(git branch --show-current)" = "${base}"`)}`
  const first = [
    'git status --porcelain --untracked-files=no', // 0
    'git branch --show-current', // 1
    gate, // 2
    `git merge --no-ff ${branch} -m "Merge ${branch} into ${base} (#${t.number})"`, // 3
    ...mergeChecks, // 4...
    `git merge-base --is-ancestor ${branch} HEAD`, // 4 + n
    'git rev-parse --short HEAD', // 5 + n
  ]
  const reread = ['git status --porcelain --untracked-files=no', 'git branch --show-current',
    `git merge-base --is-ancestor ${branch} HEAD`, ...mergeChecks, 'git rev-parse --short HEAD']
  const as = (rs, cmds) => {
    for (let i = 0; i < rs.length; i++) if (i >= cmds.length || loose(rs[i].command) !== loose(cmds[i])) return `it ran «${rs[i].command}» where «${cmds[i] || 'nothing'}» was expected`
    return null
  }
  const failedCheck = rs => rs.find(r => r.exitCode !== 0)
  const isSha = s => /^[0-9a-f]{7,40}$/.test(s)

  // The state after call 1: what happened, from the outputs. kind: unknown (read the state), start, conflict, check,
  // bad (the proof contradicts the merge) or merged.
  function judge(rs) {
    if (!rs || !rs.length) return { kind: 'unknown', why: 'no answer' }
    const off = as(rs, first)
    if (off) return { kind: 'unknown', why: off }
    const st = rs[0], br = rs[1], gt = rs[2], mg = rs[3]
    if (st.exitCode !== 0) return { kind: 'start', reason: `the state of the main folder could not be read: \`${st.command}\` → ${st.exitCode}\n${st.output}` }
    if (st.output.trim()) return { kind: 'start', reason: `the main folder has changes in tracked files:\n${st.output.trimEnd()}` }
    if (!br) return { kind: 'unknown', why: 'not every command ran' }
    if (br.exitCode !== 0) return { kind: 'start', reason: `the current branch of the main folder could not be read: \`${br.command}\` → ${br.exitCode}\n${br.output}` }
    if (br.output.trim() !== base) return { kind: 'start', reason: `the main folder is on «${br.output.trim()}», not on the base (${base})` }
    if (!gt) return { kind: 'unknown', why: 'not every command ran' }
    if (gt.exitCode !== 0) return { kind: 'start', reason: `the main folder is not clean and on ${base}: \`${gt.command}\` → ${gt.exitCode}` }
    if (!mg) return { kind: 'unknown', why: 'not every command ran' }
    if (mg.exitCode !== 0) return { kind: 'conflict', output: mg.output }
    const checks = rs.slice(4, 4 + n)
    const bad = failedCheck(checks)
    if (bad) return { kind: 'check', failed: bad, checks }
    if (rs.length < first.length) return { kind: 'unknown', why: 'not every command ran' }
    const anc = rs[4 + n], head = rs[5 + n]
    if (anc.exitCode !== 0) return { kind: 'bad', reason: `the merge reported success but \`${anc.command}\` → ${anc.exitCode}: ${branch} is not in ${base}\n${anc.output}`, checks }
    const sha = head.output.trim()
    if (head.exitCode !== 0 || !isSha(sha)) return { kind: 'bad', reason: `the merge commit could not be read: \`${head.command}\` → ${head.exitCode}\n${head.output}`, checks }
    return { kind: 'merged', sha, checks }
  }

  // Call 1 returned nothing or not what was asked: read the state with literal commands and judge it again. A branch
  // that is not in the base, with the main folder clean and on the base, means the merge never started: kind retry.
  async function recover(why) {
    log(`#${t.number} merge: ${why}; reading the state of ${base}`)
    const rs = await runListRetry(`${tag}:read`, reread, ph.name, optsM)
    if (!rs || !rs.length) return { kind: 'lost', reason: `infrastructure: the merge could not be read back (${why}) and the read returned nothing twice: check ${base} by hand` }
    const off = as(rs, reread)
    if (off) return { kind: 'lost', reason: `infrastructure: the read-back of the merge ran the wrong commands (${off}): check ${base} by hand` }
    if (rs.length < 3) return { kind: 'lost', reason: `infrastructure: the Merge call failed (${why}) and the main folder could not be read: check ${base} by hand` }
    if (rs[2].exitCode !== 0) {
      if (rs[0].exitCode === 0 && !rs[0].output.trim() && rs[1].exitCode === 0 && rs[1].output.trim() === base) return { kind: 'retry' }
      return { kind: 'lost', reason: `infrastructure: the Merge call failed (${why}) and ${branch} is not in ${base}. The main folder is not clean on ${base} (\`${rs[0].command}\` printed «${squash(rs[0].output)}», the branch is «${squash(rs[1].output)}»): if it is in the middle of a merge, \`git merge --abort\` there` }
    }
    const checks = rs.slice(3, 3 + n)
    const bad = failedCheck(checks)
    if (bad) return { kind: 'check', failed: bad, checks }
    const sha = rs.length === reread.length ? rs[rs.length - 1].output.trim() : ''
    if (!isSha(sha)) return { kind: 'lost', reason: `infrastructure: ${branch} is in ${base} but its commit could not be read (${why})` }
    return { kind: 'merged', sha, checks }
  }

  return {
    step: 'merge', serial: true,
    exec: async () => {
      if (!/^[A-Za-z0-9._\/-]+$/.test(branch)) return { blocked: true, step: 'merge', failure: `the Builder's branch name is not safe to run (${JSON.stringify(branch)}): nothing was merged` }
      let s = judge(await runList(tag, first, ph.name, optsM))
      if (s.kind === 'unknown') s = await recover(s.why)
      if (s.kind === 'retry') {
        s = judge(await runList(`${tag}:retry`, first, ph.name, optsM))
        if (s.kind === 'unknown') s = await recover(s.why)
        if (s.kind === 'retry') s = { kind: 'lost', reason: `infrastructure: the Merge call returned nothing usable twice and ${branch} is not in ${base}` }
      }
      if (s.checks) ctx.mergeChecks = s.checks
      if (s.kind === 'start' || s.kind === 'bad') return { blocked: true, step: 'merge', failure: s.reason }
      if (s.kind === 'lost') return { blocked: true, step: 'infrastructure', failure: s.reason }
      if (s.kind === 'conflict') {
        const ab = await runListRetry(`${tag}:abort`, ['git diff --name-only --diff-filter=U', 'git merge --abort'], ph.name, optsM)
        const files = ab && ab[0] && ab[0].exitCode === 0 ? ab[0].output.trim() : ''
        const aborted = !!ab && ab.length === 2 && ab[1].exitCode === 0
        return { blocked: true, step: 'merge', failure: `merge conflict merging ${branch} into ${base}.\nConflicting files:\n${files || '(not read)'}\n${aborted ? 'The merge was aborted.' : `\`git merge --abort\` was NOT confirmed: the main folder may be in the middle of a merge.`}\nMerge output:\n${s.output}` }
      }
      if (s.kind === 'check') {
        const rv = await runListRetry(`${tag}:revert`, ['git revert -m 1 --no-edit HEAD', 'git status --porcelain --untracked-files=no'], ph.name, optsM)
        const reverted = !!rv && rv.length === 2 && rv[0].exitCode === 0 && rv[1].exitCode === 0 && !rv[1].output.trim()
        return { blocked: true, step: 'check', failure: `\`${s.failed.command}\` → ${s.failed.exitCode}\n${s.failed.output}\n${reverted ? `The merge was reverted: ${base} is as it was.` : `The revert was NOT confirmed (${rv ? rv.map(r => `\`${r.command}\` → ${r.exitCode}`).join(', ') : 'no answer'}): the merge may still be in ${base}; undo it by hand.`}` }
      }
      // Merged: proven by the ancestor read, not by what an agent said.
      ctx.mergeCommit = s.sha
      const body = ticketComment(t, ctx, `PASS and merged into ${base} (${s.sha})`)
      const fin = await settle(`${tag}:close`, t.number, ph.name, { label: P.doneLabel, column: ph.column, body })
      ctx.notes.push(...fin.notes)
      return { merged: true }
    },
    read: r => (r.merged ? { pass: true } : { pass: false, stop: true, step: r.step, failure: r.failure }),
  }
}

const PHASES = { Build: buildPhase, Verify: verifyPhase, Review: reviewPhase, Merge: mergePhase }

// ---------- factory.json ----------

// Only what factory.json sets: a null model or effort leaves the agent's own (its definition's, or the session's).
function optsOf(step) {
  const o = {}
  if (step.model) o.model = step.model
  if (step.effort) o.effort = step.effort
  if (step.agentType) o.agentType = step.agentType
  return o
}

// ---------- The start ----------

// board.js reads it (documentation/launch-list.md, «The start»): factory.json parsed and validated, the base, the tickets
// with their card and blockers, and the problem of the main folder, if any. The same args as /run go to it. Which tickets
// are built, and the check of every phase having its function, stay here.
let board
try { board = await workflow({ scriptPath: BOARD_WORKFLOW }, args !== null && typeof args === 'object' && !Array.isArray(args) ? args : args == null ? {} : { tickets: args }) } catch (e) { return { stopped: `the start could not be read (${e})` } }
if (!board || board.stopped) return { stopped: board ? board.stopped : 'the start returned nothing' }
const { factory: F, base } = board
const C = F.columns
const P = F.project
const SMALL = optsOf(F.small) // the script's small agents: every `runner` call that has no phase of its own
const LIM = F.runner // the longest command and the longest output of the runner (factory.json, `runner`)
const noFunction = F.phases.find(p => !PHASES[p.name])
if (noFunction) return { stopped: `${FACTORY_JSON} is invalid: phase «${noFunction.name}» has no function in PHASES of .claude/workflows/run.js` }
if (board.mainFolder.problem) return { stopped: board.mainFolder.problem }

const doneOnBoard = t => t.state.toLowerCase() === 'closed' || t.labels.includes(P.doneLabel)
const onNeedsHuman = t => t.status === C.needsHuman
// Asked for by number: all of them, and the run says what it does with each. Asked for none: the open ones that are neither.
const tickets = board.wanted.length ? board.tickets : board.tickets.filter(t => !doneOnBoard(t) && !onNeedsHuman(t))
const byNum = {}
for (const t of tickets) byNum[t.number] = t

// A list of commands in one `runner` agent (.claude/agents/runner.md): it runs them in order, literally, stops at the
// first that fails and returns each one it ran with its exit code and output. The runner names no project data; the
// commands come from here. The results it ran, or null if it returned nothing.
async function runList(label, commands, phase, own = {}) {
  const off = commands.map(plainProblem).find(Boolean)
  if (off) throw new Error(`a command is not plain ASCII: ${off}`)
  const long = commands.find(c => c.length > LIM.maxCommand)
  if (long) throw new Error(`a command is longer than ${LIM.maxCommand} characters (${long.length}): ${oneLine(long, 120)}`)
  const r = await agent(`Run these commands, in this order:
${commands.map((c, i) => `${i + 1}. ${c}`).join('\n')}`,
  { ...SMALL, ...own, agentType: 'runner', label, phase, schema: RUN_SCHEMA })
  return resultsOf(r)
}

// A null read is plumbing, not the ticket's fault: it is asked once more; null again means nothing could be read.
const runListRetry = async (label, commands, phase, own) => (await runList(label, commands, phase, own)) || (await runList(`${label}:retry`, commands, phase, own))

// A ticket stopped by the plumbing, not by its work: it stops where it is, uses no round and its comment says so.
const infrastructure = reason => ({ pass: false, stop: true, step: 'infrastructure', failure: `infrastructure: ${reason}` })

// The script moves every card, by issue URL, and checks it on GitHub: the board always shows the real step.
// The two commands that move a card and read it back; the script decides from the read-back, not from the edit.
const cardCommands = (n, column) => [
  `gh project item-edit ${P.boardNumber} --owner ${P.boardOwner} --url https://github.com/${P.repo}/issues/${n} --field "Status" --value "${column}"`,
  `gh issue view ${n} -R ${P.repo} --json projectItems`,
]

// Whether the read-back of a card (the output of `gh issue view --json projectItems`) shows it in the column.
const cardIn = (output, column) => {
  let seen = null
  try { seen = JSON.parse(String(output).trim()) } catch (e) { /* not JSON: no card seen */ }
  return !!seen && Array.isArray(seen.projectItems) && seen.projectItems.some(i => i && i.status && i.status.name === column)
}

async function moveCard(n, column, group) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const rs = await runList(`card:#${n}:${column}:${attempt}`, cardCommands(n, column), group)
    if (rs && rs.length === 2 && rs[1].exitCode === 0 && cardIn(rs[1].output, column)) return
  }
  log(`#${n} could not be moved to ${column}: check it by hand`)
}

// A comment the script wrote travels in pieces (`pieces`) and is posted from stdin by a command that checks the
// fingerprint of the whole first. It is confirmed by a command over the ticket's last comment, which prints its fingerprint
// (crc and length in bytes, without carriage returns): the script compares it with its own, and the runner copies back
// nothing but those two numbers.
const lastCommentFingerprint = n => `sh -c ${shq(`printf %s "$(gh issue view ${n} -R ${P.repo} --json comments --jq ".comments[-1].body" | tr -d "\\r")" | cksum`)}`

// What closes a ticket's step in one `runner` call: the done label (if any), the card in its column (if any) and the
// comment, each read back; the runner stops at the first command that fails, so a second call repeats only what is
// still missing. A comment is posted at most once: after a call whose answer does not say whether the post ran, the last
// comment is read before anything is sent again (and if it cannot be read, nothing is), and once posted it is never sent
// again, whatever the read-back says. Returns what could not be confirmed, in notes.
async function settle(tag, n, group, { label, column, body }) {
  const text = norm(body)
  const mine = fingerprint(text)
  const msg = pieces(`post-${n}`, text)
  const post = msg.unpack(`gh issue comment ${n} -R ${P.repo} --body-file -`)
  const lastRead = lastCommentFingerprint(n)
  const need = { label: !!label, card: !!column, comment: true }
  const state = { card: !column, posted: false, held: false, confirmed: false, unsure: false, seen: null, why: 'it was not tried' }
  // A fingerprint printed by `cksum`: two numbers.
  const printed = r => (r && r.exitCode === 0 && /^\d+ \d+$/.test(String(r.output).trim()) ? String(r.output).trim() : null)
  // The last comment's fingerprint, alone (asked twice if the runner answers nothing); whether it could be read.
  const look = async name => {
    for (const suffix of ['', ':retry']) {
      const rd = await runList(`${tag}:${name}${suffix}`, [lastRead], group)
      const seen = rd && rd[0] && loose(rd[0].command) === loose(lastRead) ? printed(rd[0]) : null
      if (seen) { state.seen = seen; state.confirmed = seen === mine; return true }
    }
    return false
  }
  // The post may have gone through while its answer was lost: the last comment says. Not readable: nothing is sent again.
  const settleDoubt = async name => {
    state.unsure = false
    const read = await look(name)
    if (read && state.confirmed) { need.comment = false; state.posted = true }
    else if (!read) { need.comment = false; state.held = true; state.why = 'the answer did not say whether the post ran and the last comment could not be read, so it was not sent again' }
  }
  for (let attempt = 1; attempt <= 2 && (need.label || need.card || need.comment); attempt++) {
    if (need.comment && state.unsure) await settleDoubt(`look${attempt}`)
    const cmds = [], at = {}
    if (need.label) { at.label = cmds.length; cmds.push(`gh issue edit ${n} -R ${P.repo} --add-label ${P.doneLabel}`) }
    if (need.card) { at.card = cmds.length; cmds.push(...cardCommands(n, column)) }
    if (need.comment) { at.puts = cmds.length; cmds.push(...msg.puts); at.post = cmds.length; cmds.push(post, lastRead) }
    if (!cmds.length) break
    const rs = await runList(attempt > 1 ? `${tag}:retry` : tag, cmds, group)
    // Only a result for the command that was asked counts.
    const got = i => (rs && rs[i] && loose(rs[i].command) === loose(cmds[i]) ? rs[i] : null)
    // How a command went: ok, failed (non-zero exit), changed (the runner ran another command than the one asked) or missing.
    const kindOf = i => (!rs || !rs[i] ? 'missing' : !got(i) ? 'changed' : rs[i].exitCode === 0 ? 'ok' : 'failed')
    const WHAT = { missing: 'was not run', changed: 'was run as another command: the runner did not copy it as it was', failed: 'failed its check: the runner did not copy it as it was' }
    if (need.label && got(at.label) && got(at.label).exitCode === 0) need.label = false
    const cb = need.card ? got(at.card + 1) : null
    if (cb && cb.exitCode === 0 && cardIn(cb.output, column)) { need.card = false; state.card = true }
    if (!need.comment) continue
    const failedPut = msg.puts.findIndex((_, i) => kindOf(at.puts + i) !== 'ok')
    const p = got(at.post)
    if (p && p.exitCode === 0) {
      need.comment = false
      state.posted = true
      state.seen = null; state.confirmed = false
      const seen = printed(got(at.post + 1))
      if (seen) { state.seen = seen; state.confirmed = seen === mine }
    } else if (failedPut >= 0) {
      state.why = `piece ${failedPut + 1} of ${msg.puts.length} ${WHAT[kindOf(at.puts + failedPut)]}`
    } else {
      state.why = `the command that posts ${WHAT[kindOf(at.post)]}`
    }
    // A command that failed stopped the runner, so nothing after it ran. Without one, the post may have run unseen.
    if (need.comment && !p && !(rs && rs.some(r => r && r.exitCode !== 0))) state.unsure = true
  }
  if (need.comment && state.unsure) await settleDoubt('look')
  // Posted but not read back: one more read, alone, never a second post.
  if (state.posted && !state.seen) await look('look')
  const notes = []
  if (need.label) notes.push(`the label ${P.doneLabel} could not be added to #${n}: add it by hand`)
  if (need.card) notes.push(`the card of #${n} could not be moved to ${column}: check it by hand`)
  if (state.held) notes.push(`the comment on #${n} may not have been posted: ${state.why}: read the ticket`)
  else if (!state.posted) notes.push(`the comment on #${n} was not posted: ${state.why}`)
  else if (!state.confirmed) notes.push(`the last comment on #${n} could not be confirmed to be the script's report: ${state.seen ? `its hash and length (${state.seen}) are not the report's (${mine})` : 'its hash and length could not be read'}: read it`)
  for (const m of notes) log(m)
  return { notes, card: state.card }
}

// ---------- One ticket ----------

// Merges, block reports and skip reports go through this queue: one at a time in the main folder.
let queue = Promise.resolve()
function serial(fn) {
  const p = queue.then(fn)
  queue = p.catch(() => null)
  return p
}

const builds = [] // every Build result, for the cleanup

// The ticket's comment, built here. What an agent wrote (the reviewer's checkboxes, the Builder's no-trace and
// out-of-ticket lines, a reason that quotes one) goes only inside a fenced block, as quoted data. What the Builder
// published on the ticket itself is not repeated. stuck = { step, left } for a ticket that did not merge.
function ticketComment(t, ctx, head, stuck) {
  const b = ctx.build
  const checks = [...(ctx.checks || []), ...(ctx.mergeChecks || [])]
  const lines = [`${NAME} · ${head}`, `Rounds: ${ctx.round}/${MAX_ROUNDS}`,
    `Checks: ${checks.length ? checks.map(c => `\`${oneLine(c.command, 160)}\` → ${c.exitCode}`).join('; ') : 'none'}`]
  if (ctx.verdict) {
    const all = String(ctx.verdict).split('\n')
    const boxes = all.filter(l => /^\s*- \[[ x?]\]/.test(l))
    lines.push(`Reviewer: ${ctx.verdictWord || 'no verdict'}, quoted from the reviewer:`, fence((boxes.length ? boxes : all.slice(0, 12)).join('\n')))
  } else lines.push('Reviewer: no review')
  const noTrace = b && b.noTrace && b.noTrace.length ? b.noTrace.join('\n') : ''
  lines.push(noTrace ? 'No trace, quoted from the Builder:' : 'No trace: none')
  if (noTrace) lines.push(fence(noTrace))
  const seen = b && b.outOfTicket && b.outOfTicket.length ? b.outOfTicket.join('\n') : ''
  lines.push(seen ? 'Out of the ticket (for the backlog), quoted from the Builder:' : 'Out of the ticket (for the backlog): nothing')
  if (seen) lines.push(fence(seen))
  if (stuck) {
    lines.push(`Stopped at: ${stuck.step}`, `Left: ${stuck.left}`,
      `To relaunch: take the card out of *${C.needsHuman}* (documentation/github-board.md) and launch \`/run ${t.number}\` (documentation/launch-list.md). First, the human deletes the branch in «Left» or renames it.`)
  }
  return lines.join('\n')
}

// step: the step where the ticket stopped (build, check, review, merge or infrastructure). What is left of its work is
// read, never remembered: its branches and the copies of its rounds.
function block(t, ctx, step, reason, group) {
  return serial(async () => {
    const mine = builds.filter(b => b.number === t.number)
    const rs = await runList(`left:#${t.number}`, [`git branch --list "ticket/${t.number}-*"`, 'git worktree list'], group)
    let left = 'could not be read: look at `git branch --list` and `git worktree list`'
    if (rs && rs.length === 2 && rs.every(r => r.exitCode === 0)) {
      const branches = rs[0].output.split('\n').map(l => l.replace(/^[*+]?\s*/, '').trim()).filter(Boolean)
      const copies = mine.map(b => b.worktreePath).filter(p => p && rs[1].output.split('\n').some(l => normPath(l).startsWith(`${normPath(p)} `)))
      left = [branches.length ? `branch ${branches.join(', ')}` : '', copies.length ? `copy ${copies.join(', ')}` : ''].filter(Boolean).join('; ') || 'nothing'
    }
    const body = `${ticketComment(t, ctx, 'not merged: see the reason', { step, left })}\nReason, quoted:\n${fence(reason)}`
    const fin = await settle(`block:#${t.number}`, t.number, group, { column: C.needsHuman, body })
    return { number: t.number, status: 'blocked', rounds: ctx.round, reason, marked: fin.card, ...(fin.notes.length ? { notes: fin.notes } : {}) }
  })
}

function skip(t, reason) {
  return serial(async () => {
    const fin = await settle(`skip:#${t.number}`, t.number, 'Skipped', { body: `${NAME} · skipped: ${reason}` })
    return { number: t.number, status: 'skipped', reason, ...(fin.notes.length ? { notes: fin.notes } : {}) }
  })
}

async function runTicket(t) {
  if (doneOnBoard(t)) return { number: t.number, status: 'done', note: 'already done' }
  if (onNeedsHuman(t)) return { number: t.number, status: 'blocked', note: `already in ${C.needsHuman}` }

  // Wait for blockers in this run; a blocker outside the run must already be done.
  const outside = t.blockers.find(bl => !byNum[bl.number] && !doneOnBoard(bl))
  if (outside) return skip(t, `depends on #${outside.number}, which is not in the release`)
  const inRun = t.blockers.filter(bl => byNum[bl.number])
  const results = await Promise.all(inRun.map(bl => start(bl.number)))
  const failed = inRun.filter((bl, i) => !results[i] || results[i].status !== 'done')
  if (failed.length) return skip(t, `depends on ${failed.map(bl => `#${bl.number}`).join(', ')}, which did not reach the release`)

  // The phases of factory.json, in order. The card enters a phase's column when the phase starts (moveCard
  // "start") or when it passes ("end"), never earlier.
  const ctx = { round: 1, prev: null, failure: null, build: null, baseSha: null, checks: [], mergeChecks: [], verdict: null, verdictWord: null,
    prevVerdict: null, mergeCommit: null, cardAt: null, notes: [] }
  const at = { step: 'build', group: F.phases[0].name } // where the ticket is, for the comment if it throws
  try {
    return await runPhases(t, ctx, at)
  } catch (e) {
    // A ticket that throws (budget exhausted, schema error) also ends in the needsHuman column, with a comment.
    log(`#${t.number} threw at ${at.step}: ${String(e)}`)
    return block(t, ctx, at.step, `the run threw: ${String(e)}`, at.group)
  }
}

async function runPhases(t, ctx, at) {
  let i = 0
  while (i < F.phases.length) {
    const ph = F.phases[i]
    at.group = ph.name
    const spec = PHASES[ph.name](t, ctx, ph)
    at.step = spec.step
    // A phase with `exec` runs its own commands in `runner` calls, card move included (or the card was already moved
    // by the call of the phase before, which read it back).
    if (ph.moveCard === 'start' && !spec.exec && ctx.cardAt !== ph.column) await moveCard(t.number, ph.column, ph.name)
    const opts = { ...optsOf(ph), label: `${ph.name.toLowerCase()}:#${t.number}:r${ctx.round}`, phase: ph.name }
    if (spec.schema) opts.schema = spec.schema
    if (spec.isolation) opts.isolation = spec.isolation
    const run = spec.exec ? spec.exec : () => agent(spec.prompt, opts)
    const r = spec.serial ? await serial(run) : await run()
    const out = r ? await spec.read(r) : { pass: false, stop: true, failure: `the ${ph.name} agent returned nothing` }
    if (out.pass) {
      if (ph.moveCard === 'end' && !spec.exec) await moveCard(t.number, ph.column, ph.name)
      i++; continue
    }
    // Every failure that sends the ticket back to an earlier phase is a new round, up to MAX_ROUNDS in total.
    const back = F.phases.findIndex(p => p.name === ph.onFail)
    if (!out.stop && back >= 0 && ctx.round < MAX_ROUNDS) {
      ctx.round++; ctx.failure = out.failure
      ctx.prev = ctx.build ? { branch: ctx.build.branch, commit: ctx.build.commit } : null
      // What belongs to a round dies with it: a block in round 2 quotes only round 2. prevVerdict is the one thing that
      // is meant to cross, so the reviewer sees its own previous verdict.
      ctx.build = null; ctx.baseSha = null; ctx.checks = []; ctx.mergeChecks = []; ctx.verdict = null; ctx.verdictWord = null; ctx.cardAt = null
      i = back; continue
    }
    return block(t, ctx, out.step || spec.step, out.failure, ph.name)
  }
  return { number: t.number, status: 'done', rounds: ctx.round, mergeCommit: ctx.mergeCommit, ...(ctx.notes.length ? { notes: ctx.notes } : {}) }
}

// Start each ticket once; a ticket waits on the promises of its blockers. A cycle counts as not done.
const running = {}
const visiting = new Set()
function start(n) {
  if (running[n]) return running[n]
  if (visiting.has(n)) return Promise.resolve({ number: n, status: 'cycle' })
  visiting.add(n)
  running[n] = runTicket(byNum[n]).catch(e => ({ number: n, status: 'blocked', reason: String(e) }))
  return running[n]
}

const order = tickets.map(t => t.number).sort((a, b) => a - b)
log(`${order.length} tickets on ${base}: ${order.map(n => `#${n}`).join(', ')}`)
const results = await Promise.all(order.map(start))
await queue

// ---------- The end of the list ----------

// The report is the child workflow release-report.js (documentation/launch-list.md, «The end of a list»): it writes the
// report file and returns the commands for the human; the run never pushes and never opens a PR. The cleanup of the copies
// rides in the child's `runner` call that writes the file. Copies: removed if their ticket is done or the Builder
// committed (the branch keeps the work); kept otherwise, a copy with no commit holds the only copy. The branches left are
// the copies' own and those of rounds that did not end their ticket: the human deletes them.
const statusOf = n => (results.find(r => r.number === n) || {}).status
const removable = builds.filter(b => b.worktreePath && (statusOf(b.number) === 'done' || b.commit))
const branchNames = [...new Set(builds.flatMap(b => [b.worktreeBranch, builds.some(o => o.number === b.number && o.round > b.round) ? b.branch : null]).filter(Boolean))]
const WORKTREES = 'git worktree list'
// One command per group of names that fits maxCommand: a list of tickets can have more branches than one command holds.
const BRANCHES = []
for (const name of branchNames.map(shq)) {
  const last = BRANCHES.length - 1
  if (last >= 0 && `${BRANCHES[last]} ${name}`.length <= LIM.maxCommand) BRANCHES[last] += ` ${name}`
  else BRANCHES.push(`git branch --list ${name}`)
}
const cleanup = [
  ...removable.map(b => `sh -c ${shq(`git worktree remove --force ${shq(b.worktreePath)} || true`)}`),
  'git worktree prune', WORKTREES,
  ...BRANCHES,
]
let rep = null, reportFailure = null
try { rep = await workflow({ scriptPath: REPORT_WORKFLOW }, { base, project: P, columns: C, small: F.small, runner: LIM, results, cleanup }) } catch (e) { reportFailure = String(e) }
if (rep && rep.stopped) { reportFailure = rep.stopped; rep = null }
const notes = rep ? [...rep.notes] : [`the release report was not built (${reportFailure}): the copies were not cleaned; launch /release-report`]

// Copies and branches, from what git listed after the cleanup.
const ranOk = cmd => {
  const r = rep && rep.cleanupResults.find(x => loose(x.command) === loose(cmd))
  return r && r.exitCode === 0 ? r : null
}
const listing = ranOk(WORKTREES)
const stillThere = p => !!listing && listing.output.split('\n').some(l => normPath(l).startsWith(`${normPath(p)} `))
const copyPaths = [...new Set(builds.map(b => b.worktreePath).filter(Boolean))]
const copiesRemoved = listing ? copyPaths.filter(p => !stillThere(p)) : []
const copiesKept = listing ? copyPaths.filter(stillThere) : []
const branchReads = BRANCHES.map(ranOk)
const branchRead = branchNames.length && branchReads.every(Boolean) ? branchReads.map(r => r.output).join('\n') : null
const branchesLeft = branchRead ? branchRead.split('\n').map(l => l.replace(/^[*+]?\s*/, '').trim()).filter(l => branchNames.includes(l)) : []
if (rep && !listing) notes.push('the copies could not be listed after the cleanup: look at `git worktree list`')
if (rep && branchNames.length && !branchRead) notes.push('the branches of the run could not be listed: look at `git branch --list`')

return {
  base, tickets: results, copiesRemoved, copiesKept, branchesForTheHuman: branchesLeft,
  pullRequest: rep ? rep.pullRequest : null, baseOnRemote: rep ? rep.baseOnRemote : null,
  remote: rep ? rep.remote : null, reportFile: rep ? rep.reportFile : null, commandsForTheHuman: rep ? rep.commandsForTheHuman : [],
  notes,
}
