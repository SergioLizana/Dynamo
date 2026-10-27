export const meta = {
  name: 'run',
  description: 'Build a list of tickets: read the board, build each ready ticket in its own copy, check it, review it, merge one at a time into the working branch, block or skip the rest',
  whenToUse: 'The human runs /run with ticket numbers (or none, for every open ticket not done or blocked)',
}

// A dumb orchestrator: the script only decides what runs next. State comes from GitHub and from what the agents
// return. Project data (repo, branches, board, labels, check, language, document paths) comes from the `project`
// block of .claude/factory.json, read by the script without an agent's summary; so do the board columns and the phases
// (order, column, model, effort, agent type, where a failure goes). The start is two literal reads, with no agent that
// interprets: factory.json, then the tickets, their blockers and the state of the main folder in one agent (one agent
// per phase, not per command); the script parses and decides.
// One phase = one column = one agent. To add one: an entry in factory.json and a function in PHASES
// (documentation/launch-list.md, «The phases»).

const NAME = 'run' // the same as meta.name
const FACTORY_JSON = '.claude/factory.json'
const MAX_ROUNDS = 2

// Every agent gets these rules. Trial failure 5: in a worktree, chained commands are refused, so one command per
// call. Trial failure 4: facts come from commands, never from memory.
const COMMON = `Project data is in the \`project\` block of \`.claude/factory.json\`: read it first. The board commands are in the file \`project.boardCommands\` names.
Hard limits: never push; never check out, merge into or commit on the main branch; never delete a branch.
Run one command per Bash call: no \`&&\`, \`;\`, pipes or \`$(...)\`. Never move a card: the script moves them.
Every fact you return or write on GitHub comes from a command you ran in this step: a commit is the sha that
\`git rev-parse --short HEAD\` printed, a copy or branch exists only if \`git worktree list\` or
\`git branch --list\` shows it. Never write «HEAD of …» or a path you did not see.
Write GitHub comments and commit subjects in the documents language (\`project.documentsLanguage\`).`

// Trial failure 4: a commit must be a sha, not «HEAD of …».
const SHA = { type: 'string', pattern: '^[0-9a-f]{7,40}$' }
const CHECKS = {
  type: 'array',
  items: {
    type: 'object',
    required: ['command', 'exitCode', 'output'],
    properties: { command: { type: 'string' }, exitCode: { type: 'integer' }, output: { type: 'string' } },
  },
}

// Run wf_41e0b269-ab2: an agent's summary of a command is not the command. A raw read returns the literal output
// and the script parses it.
const RAW_SCHEMA = {
  type: 'object',
  required: ['exitCode', 'stdout'],
  properties: { exitCode: { type: 'integer' }, stdout: { type: 'string' } },
}

// What the `runner` returns: each command it ran, in order, up to the first that failed.
const RUN_SCHEMA = { type: 'object', required: ['results'], properties: { results: CHECKS } }

// The only read of the start besides factory.json: three commands, each with its literal output.
const START_SCHEMA = {
  type: 'object',
  required: ['status', 'branch', 'tickets'],
  properties: { status: RAW_SCHEMA, branch: RAW_SCHEMA, tickets: RAW_SCHEMA },
}

const BUILD_SCHEMA = {
  type: 'object',
  required: ['worktreePath', 'worktreeBranch', 'branch', 'commit', 'needsHuman', 'needsHumanReason', 'published',
    'noTrace', 'outOfTicket'],
  properties: {
    worktreePath: { type: 'string' }, worktreeBranch: { type: 'string' }, branch: { type: 'string' },
    commit: { anyOf: [SHA, { type: 'null' }] },
    needsHuman: { type: 'boolean' }, needsHumanReason: { type: 'string' },
    published: { type: 'array', items: { type: 'string' } },
    noTrace: { type: 'array', items: { type: 'string' } },
    outOfTicket: { type: 'array', items: { type: 'string' } },
  },
}

const MERGE_SCHEMA = {
  type: 'object',
  required: ['outcome', 'stoppedAt', 'mergeCommit', 'reason', 'checks'],
  properties: {
    outcome: { type: 'string', enum: ['merged', 'blocked'] },
    stoppedAt: { type: 'string', enum: ['none', 'start', 'merge', 'check'] },
    mergeCommit: { anyOf: [SHA, { type: 'null' }] },
    reason: { type: 'string' }, checks: CHECKS,
  },
}

// The verdict is a field, not a line of the report: a regex on the report would read a FAIL that quotes
// «VERDICT: PASS» as a PASS.
const REVIEW_SCHEMA = {
  type: 'object',
  required: ['verdict', 'report'],
  properties: { verdict: { type: 'string', enum: ['PASS', 'FAIL'] }, report: { type: 'string' } },
}

const CLEANUP_SCHEMA = {
  type: 'object',
  required: ['removed', 'kept', 'branchesLeft'],
  properties: {
    removed: { type: 'array', items: { type: 'string' } },
    kept: { type: 'array', items: { type: 'string' } },
    branchesLeft: { type: 'array', items: { type: 'string' } },
  },
}

// ---------- Phases ----------

// One function per phase of factory.json, picked by its name. It gets the ticket, its state (ctx) and its entry (ph) and returns:
// prompt; schema, isolation and serial (one at a time in the main folder), if it needs them; step, the word for
// «Parado en»; exec(), instead of the prompt, for a phase the script decides itself from one `runner` call (it moves
// its own card); and read(result) → { pass: true } or { pass: false, failure, stop?, reported? }. On a failure the
// ticket goes where the phase's onFail says; stop blocks it whatever onFail says, and reported means the agent
// already posted the ticket's comment.

// Trial failure 2: round 2 brings round 1's commits with cherry-pick (linear history), and only if there are any.
function buildPhase(t, ctx) {
  const prev = ctx.prev
  const second = !prev ? '' : `
This is round ${ctx.round}. Round ${ctx.round - 1} left its work on branch \`${prev.branch}\`${prev.commit ? ` (commit ${prev.commit})` : ' with no commit'}.
- If \`git log --oneline ${base}..${prev.branch}\` lists commits, bring them in with
  \`git cherry-pick ${base}..${prev.branch}\`. If it lists none, do not cherry-pick: start from the base.
- Fix exactly what failed, nothing more:
${ctx.failure}
- Whatever an earlier round already published on GitHub for a checkbox: edit that comment if it must change, never post it again.`
  return {
    step: 'build',
    schema: BUILD_SCHEMA,
    isolation: 'worktree',
    prompt: `${COMMON}

You are the Builder of ticket #${t.number} («${t.title}») in repo \`${P.repo}\`, base \`${base}\`. You are in your own
copy (a git worktree) that starts at the tip of the base.
1. Note \`git rev-parse --show-toplevel\` (worktreePath) and \`git branch --show-current\` (worktreeBranch).
2. \`git checkout -b ticket/${t.number}-<short-slug>${ctx.round === 1 ? '' : `-r${ctx.round}`}\`.
3. \`gh issue view ${t.number} -R ${P.repo}\`: read the ticket and the plan sections it cites. Change only what it asks.${second}
4. If a checkbox asks for something written outside the code (a comment on the ticket, a note), publish it now and
   list it in \`published\`. For a checkbox that leaves no trace in git or GitHub, put \`command → output\` in \`noTrace\`.
5. Do not run the automatic check: the next phase runs it in this copy.
6. Stage only the files of the change (\`git add <paths>\`) and commit with a subject ending in \`(#${t.number})\`
   plus the attribution line Claude Code gives you. Leave nothing uncommitted. Never check out the base and never merge.
7. needsHuman = true only if the ticket contradicts itself or cannot be done without a decision from the human;
   say why in needsHumanReason. Anything you noticed outside the ticket goes in \`outOfTicket\`.`,
    read: async b => {
      builds.push({ number: t.number, round: ctx.round, worktreePath: b.worktreePath, worktreeBranch: b.worktreeBranch, branch: b.branch })
      ctx.build = b
      outOf[t.number] = b.outOfTicket // the latest round's, for the report of the list
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
// branch name, which moves while other tickets merge. A call that did not run what it should is plumbing: it is
// retried once, and a second time stops the ticket as «infrastructure» without using a round.
// The runner runs each command alone in its own Bash call and the folder does not carry over between calls, so a `cd`
// would be lost: each check goes inside `sh -c 'cd <copy> && <command>'`, one literal command that runs in the
// Builder's copy whatever the folder of the call (sh exists on Linux, macOS and Git Bash).
const inCopy = (dir, command) => `sh -c '${`cd ${dir} && ${command}`.split("'").join("'\\''")}'`
const normPath = p => String(p).trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
function verifyPhase(t, ctx, ph) {
  const b = ctx.build
  const dir = b.worktreePath
  const commands = [
    ...cardCommands(t.number, ph.column), // 0, 1
    inCopy(dir, 'git rev-parse --show-toplevel'), // 2: the folder the checks run in, run the same way as they do
    `git -C ${dir} status --porcelain`, // 3
    `git -C ${dir} rev-parse --short HEAD`, // 4
    ...P.checks.map(c => inCopy(dir, c.split('<base>').join(ctx.baseSha))), // 5...
  ]
  const squash = s => String(s).replace(/\s+/g, ' ').trim()
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
      const failed = results.slice(2).find(r => r.exitCode !== 0)
      if (failed) bad.push(`\`${failed.command}\` → ${failed.exitCode}\n${failed.output}`)
      const status = results[3], head = results[4]
      if (status && status.exitCode === 0 && status.output.trim()) bad.push(`uncommitted changes in the copy:\n${status.output}`)
      if (head && head.exitCode === 0) {
        const sha = head.output.trim()
        if (!sha || !(sha.startsWith(b.commit) || b.commit.startsWith(sha))) bad.push(`it ran on «${sha}», not on the Builder's commit ${b.commit}`)
      }
      ctx.checks = results.slice(5)
      return bad.length ? { pass: false, failure: `The automatic check failed (against ${ctx.baseSha}):\n${bad.join('\n')}` } : { pass: true }
    },
  }
}

function reviewPhase(t, ctx) {
  const b = ctx.build
  return {
    step: 'review',
    schema: REVIEW_SCHEMA,
    prompt: `Review ticket ${t.number} of repo ${P.repo}. Base: ${base}.
The change is committed on branch \`${b.branch}\` (commit ${b.commit}), checked out in the Builder's copy
\`${b.worktreePath}\`. First \`cd ${b.worktreePath}\`, alone in its call; every command after it runs there, so HEAD is
the change and \`git diff ${base}...HEAD\` is the diff. Change nothing in the copy.
The automatic check passed in the Builder's copy: ${ctx.checks.map(c => `\`${c.command}\` → ${c.exitCode}`).join('; ')}.
Return the verdict (PASS or FAIL) in \`verdict\` and the full report, in the shape of your definition, in \`report\`.
Round ${ctx.round}.${ctx.prevVerdict ? `\nYour previous verdict, word for word:\n${ctx.prevVerdict}` : ''}`,
    read: r => {
      const verdict = r.report
      ctx.verdict = verdict
      if (r.verdict === 'PASS') return { pass: true }
      ctx.prevVerdict = verdict
      const forBuilder = (verdict.match(/For the Builder:[\s\S]*?(?=\nNotes|$)/) || [verdict])[0]
      return { pass: false, failure: `The reviewer said FAIL. ${forBuilder}` }
    },
  }
}

// Run wf_41e0b269-ab2: whatever Merge says, a ticket it stops ends in Needs Human, set by the script.
function mergePhase(t, ctx) {
  const b = ctx.build
  return {
    step: 'merge',
    schema: MERGE_SCHEMA,
    serial: true,
    prompt: `${COMMON}

Merge ticket #${t.number} in repo \`${P.repo}\` into \`${base}\`, in this folder (the main one).
1. \`git status --porcelain --untracked-files=no\` must be empty and \`git branch --show-current\` must be \`${base}\`. If not, outcome =
   blocked, stoppedAt = start, and say why; change nothing.
2. \`git merge --no-ff ${b.branch} -m "Merge ${b.branch} into ${base} (#${t.number})"\`. On a conflict:
   \`git merge --abort\`, outcome = blocked, stoppedAt = merge, reason = the conflicting files.
3. Run every command of the automatic check, one per call, with \`<base>\` = \`HEAD~1\` (the base before the merge:
   \`${base}\` itself would compare the branch with itself and miss what the merge brought in):
${P.checks.map(c => `   - \`${c.split('<base>').join('HEAD~1')}\``).join('\n')}
   If any fails:
   \`git revert -m 1 --no-edit HEAD\`, outcome = blocked, stoppedAt = check, reason = the failing command and its output.
4. If blocked: change no label. If merged: stoppedAt = none, mergeCommit is what \`git rev-parse --short HEAD\` prints
   after the merge, and add the done label.
5. One \`gh issue comment ${t.number} -R ${P.repo}\`, the only report of this ticket, with this shape:
${reportShape(`<PASS and merged into ${base} (<mergeCommit>) | not merged: <reason>>`, t.number)}
   If blocked, keep the three lines Stopped at, Left and To relaunch: Stopped at is «merge» if stoppedAt is start
   or merge, and «check» if it is check; Left is the branch \`${b.branch}\` and the copy \`${b.worktreePath}\`,
   each only if \`git branch --list\` or \`git worktree list\` still shows it. If merged, delete those three lines.
   Do not repeat what the Builder already published: ${JSON.stringify(b.published)}.
Round: ${ctx.round}. Checks in the Builder's copy: ${JSON.stringify(ctx.checks)}. No trace: ${JSON.stringify(b.noTrace)}.
Out of the ticket: ${JSON.stringify(b.outOfTicket)}.
Verdict:
${ctx.verdict}`,
    read: m => {
      if (m.outcome === 'merged') { ctx.mergeCommit = m.mergeCommit; return { pass: true } }
      return { pass: false, reported: true, failure: m.reason }
    },
  }
}

const PHASES = { Build: buildPhase, Verify: verifyPhase, Review: reviewPhase, Merge: mergePhase }

// ---------- factory.json ----------

// What the run needs from factory.json; the reason it is invalid, or null.
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
    if (!PHASES[p.name]) return `${at} has no function in PHASES of .claude/workflows/run.js`
    if (!str(p.column)) return `${at} needs a column`
    if (p.moveCard !== 'start' && p.moveCard !== 'end') return `${at}: moveCard is "start" or "end"`
    if (!opt(p.model) || !opt(p.effort) || !opt(p.agentType)) return `${at}: model, effort and agentType are a string or null`
    if (p.onFail !== c.needsHuman && !seen.includes(p.onFail)) return `${at}: onFail is an earlier phase or «${c.needsHuman}»`
    seen.push(p.name)
  }
  return null
}

// Only what factory.json sets: a null model or effort leaves the agent's own (its definition's, or the session's).
function optsOf(step) {
  const o = {}
  if (step.model) o.model = step.model
  if (step.effort) o.effort = step.effort
  if (step.agentType) o.agentType = step.agentType
  return o
}

// Without a valid factory.json nothing runs. No model here: it is not read yet.
const rawFactory = await agent(`Run exactly this one command and nothing else, then return its exit code and its
standard output character for character: no summary, no reformatting, nothing left out.
cat ${FACTORY_JSON}`, { label: 'factory.json', schema: RAW_SCHEMA })
if (!rawFactory || rawFactory.exitCode !== 0) return { stopped: `${FACTORY_JSON} is missing or cannot be read` }
let F
try { F = JSON.parse(rawFactory.stdout.trim()) } catch (e) { return { stopped: `${FACTORY_JSON} is not valid JSON: ${e.message}` } }
const invalid = checkFactory(F)
if (invalid) return { stopped: `${FACTORY_JSON} is invalid: ${invalid}` }
const C = F.columns
const P = F.project
const SMALL = optsOf(F.small) // the script's small agents: raw reads, cards, reports, cleanup
const LAST = F.phases[F.phases.length - 1].name

// ---------- Frontier ----------

// /run passes the tickets as text («38», «38 43», «38,43»); a call by script path, as a number, an array or { tickets, base }.
// Any args that is not an object is the ticket list, and a single value is a list of one.
// Something that is not a ticket number stops the run: an empty list would take every ticket.
const isObject = args !== null && typeof args === 'object' && !Array.isArray(args)
const input = isObject ? args : args == null ? {} : { tickets: args }
const given = input.tickets == null ? [] : [].concat(input.tickets)
const tokens = given.flatMap(t => String(t).split(/[\s,]+/)).filter(t => t !== '')
const unreadable = tokens.filter(t => !/^\d+$/.test(t))
if (unreadable.length) return { stopped: `these are not ticket numbers: ${unreadable.join(', ')}` }
const wanted = tokens.map(Number)

// The base is known from factory.json and the call: the main branch stops the run before any other agent.
const base = input.base ? String(input.base) : P.workingBranch
if (base === P.mainBranch) return { stopped: `the base is the main branch (${base})` }

// The three reads of the start in one agent, with the literal output of each: the state of the main folder, the branch
// and the tickets with their labels, card status and native blockers (one GraphQL query, every list with its total
// checked, so nothing is cut off silently). The script parses and decides.
const [OWNER, REPO_NAME] = P.repo.split('/')
const TICKET_FIELDS = 'number title state labels(first:20){totalCount nodes{name}} '
  + 'projectItems(first:5){totalCount nodes{fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}} '
  + 'blockedBy(first:20){totalCount nodes{number state labels(first:10){totalCount nodes{name}}}}'
const wantedSet = [...new Set(wanted)]
const query = `query { repository(owner:"${OWNER}", name:"${REPO_NAME}") { ${wantedSet.length
  ? wantedSet.map(n => `t${n}: issue(number:${n}) { ${TICKET_FIELDS} }`).join(' ')
  : `issues(states:OPEN, first:100) { pageInfo{hasNextPage} nodes { ${TICKET_FIELDS} } }`} } }`

const read = await agent(`Run exactly these three commands, one per Bash call, and nothing else. For each, return its exit code
and its standard output character for character: no summary, no reformatting, nothing left out. A command that exits
with a non-zero code is not an error for you to fix: return the code and what it printed.
status: git status --porcelain --untracked-files=no
branch: git branch --show-current
tickets: gh api graphql -f query='${query}'`,
{ ...SMALL, label: 'tickets', schema: START_SCHEMA })

if (!read) return { stopped: 'the read of the tickets and of the main folder returned nothing' }
if (read.status.exitCode !== 0) return { stopped: 'the state of the main folder could not be read' }
if (read.status.stdout.trim()) return { stopped: `the main folder has changes in tracked files:\n${read.status.stdout.trimEnd()}` }
if (read.branch.exitCode !== 0) return { stopped: 'the current branch of the main folder could not be read' }
if (read.branch.stdout.trim() !== base) return { stopped: `the main folder is on «${read.branch.stdout.trim()}», not on the base (${base})` }

// GitHub prints the data and the errors together (a missing ticket is null with an error), then exits non-zero: the
// output is parsed whatever the code, and a stray line before or after the JSON is ignored.
let answer = null
const out = read.tickets.stdout
for (const text of [out.trim(), out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)]) {
  try { answer = JSON.parse(text); break } catch (e) { /* the next text */ }
}
const repository = answer && answer.data && answer.data.repository
if (!repository) return { stopped: `the tickets could not be read: GitHub's answer is not usable (exit code ${read.tickets.exitCode})` }

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

const doneOnBoard = t => t.state.toLowerCase() === 'closed' || t.labels.includes(P.doneLabel)
const onNeedsHuman = t => t.status === C.needsHuman

// A requested ticket that cannot be read stops the run here, before any Build, and is named.
let tickets
if (wantedSet.length) {
  tickets = wantedSet.map(n => toTicket(repository[`t${n}`]))
  const unreadableTickets = wantedSet.filter((n, i) => !tickets[i] || tickets[i].number !== n)
  if (unreadableTickets.length) return { stopped: `these tickets cannot be read on GitHub: ${unreadableTickets.map(n => `#${n}`).join(', ')}` }
} else {
  const open = repository.issues
  if (!open || !Array.isArray(open.nodes) || !open.pageInfo) return { stopped: 'the list of open tickets could not be read' }
  if (open.pageInfo.hasNextPage) return { stopped: 'there are more than 100 open tickets: name the ones to run' }
  tickets = open.nodes.map(toTicket)
  const bad = open.nodes.map((n, i) => (tickets[i] ? null : n && Number.isInteger(n.number) ? `#${n.number}` : 'one of them')).filter(Boolean)
  if (bad.length) return { stopped: `these tickets cannot be read on GitHub: ${bad.join(', ')}` }
  tickets = tickets.filter(t => !doneOnBoard(t) && !onNeedsHuman(t))
}
if (read.tickets.exitCode !== 0 && !(answer.errors || []).length) return { stopped: `the tickets query failed (exit code ${read.tickets.exitCode}) with no error to show` }

const byNum = {}
for (const t of tickets) byNum[t.number] = t

// A list of commands in one `runner` agent (.claude/agents/runner.md): it runs them in order, literally, stops at the
// first that fails and returns each one it ran with its exit code and output. The runner names no project data; the
// commands come from here. The results it ran, or null if it returned nothing.
async function runList(label, commands, phase, own = {}) {
  const r = await agent(`Run these commands, in this order:
${commands.map((c, i) => `${i + 1}. ${c}`).join('\n')}`,
  { ...SMALL, ...own, agentType: 'runner', label, phase, schema: RUN_SCHEMA })
  return r && Array.isArray(r.results) ? r.results : null
}

// A null read is plumbing, not the ticket's fault: it is asked once more; null again means nothing could be read.
async function runListRetry(label, commands, phase, own) {
  return (await runList(label, commands, phase, own)) || (await runList(`${label}:retry`, commands, phase, own))
}

// A ticket stopped by the plumbing, not by its work: it stops where it is, uses no round and its comment says so.
function infrastructure(reason) {
  return { pass: false, stop: true, step: 'infrastructure', failure: `infrastructure: ${reason}` }
}

// One command and its literal output, as the agent got them. null if the agent returned nothing.
async function readRaw(label, command, phase) {
  const results = await runList(label, [command], phase)
  return results && results.length ? { exitCode: results[0].exitCode, stdout: results[0].output } : null
}

// The same, parsed here. null if it failed or is not JSON.
async function readJson(label, command, phase) {
  const r = await readRaw(label, command, phase)
  if (!r || r.exitCode !== 0) return null
  try { return JSON.parse(r.stdout.trim()) } catch (e) { return null }
}

// The script moves every card, by issue URL, and checks it on GitHub: the board always shows the real step.
// The two commands that move a card and read it back; the script decides from the read-back, not from the edit.
function cardCommands(n, column) {
  return [
    `gh project item-edit ${P.boardNumber} --owner ${P.boardOwner} --url https://github.com/${P.repo}/issues/${n} --field "Status" --value "${column}"`,
    `gh issue view ${n} -R ${P.repo} --json projectItems`,
  ]
}

// The parsed read-back of a card (the output of `gh issue view --json projectItems`), or null if it is not JSON.
function cardSeen(output) {
  try { return JSON.parse(String(output).trim()) } catch (e) { return null }
}
const cardIn = (output, column) => {
  const seen = cardSeen(output)
  const items = seen && Array.isArray(seen.projectItems) ? seen.projectItems : []
  return items.some(i => i && i.status && i.status.name === column)
}

async function moveCard(n, column, group) {
  let seen = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    const results = await runList(`card:#${n}:${column}:${attempt}`, cardCommands(n, column), group)
    const back = results && results.length === 2 && results[1].exitCode === 0 ? results[1] : null
    seen = back ? cardSeen(back.output) : null
    if (back && cardIn(back.output, column)) return { moved: true }
  }
  log(`#${n} could not be moved to ${column}: check it by hand`)
  return { moved: false, seen }
}

// A stopped ticket ends in the needsHuman column.
async function markStuck(n, group) {
  const r = await moveCard(n, C.needsHuman, group)
  return r.moved ? { marked: true } : { marked: false, seen: r.seen }
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
const outOf = {} // ticket number → the «Out of the ticket» lines of its latest Build, for the report of the list

// A stuck ticket's comment also says where it stopped, what is left and how to relaunch it (stuck = its number).
function reportShape(head, stuck) {
  return `\`\`\`text
${NAME} · ${head}
Rounds: <round>/${MAX_ROUNDS}
Checks: <each command → result>
Reviewer: <final verdict, one line per checkbox> | no review
No trace: <command → output> | none
Out of the ticket (for the backlog): <what was seen> | nothing${stuck ? `
Stopped at: <step where it stopped>
Left: <branch and working copy, by name and path, from step 2 | nothing>
To relaunch: take the card out of *${C.needsHuman}* (documentation/github-board.md) and launch \`/run ${stuck}\` (documentation/launch-list.md). First, the human deletes the branch in «Left» or renames it.` : ''}
\`\`\``
}

// step: the step where the ticket stopped (build, check, review or merge).
function block(t, ctx, step, reason, group) {
  return serial(() => agent(`${COMMON}

Ticket #${t.number} in repo \`${P.repo}\` stops as blocked: it is not merged.
1. Change no label: the script moves the card.
2. Check where its work is: \`git branch --list "ticket/${t.number}-*"\` and \`git worktree list\`.
3. One \`gh issue comment ${t.number} -R ${P.repo}\` with this shape: the reason as a literal quote, «Stopped at» is
   \`${step}\`, and «Left» is only what step 2 showed:
${reportShape(`not merged: <reason>`, t.number)}
Reason: ${reason}
Round: ${ctx.round}. Builder: ${JSON.stringify(ctx.build || {})}. Check: ${JSON.stringify(ctx.checks)}
Verdict: ${ctx.verdict || 'no review'}`,
    { ...SMALL, label: `block:#${t.number}`, phase: group }))
    .then(() => markStuck(t.number, group))
    .then(mark => ({ number: t.number, status: 'blocked', rounds: ctx.round, reason, ...mark }))
}

function skip(t, reason) {
  return serial(() => agent(`${COMMON}

Ticket #${t.number} in repo \`${P.repo}\` is skipped in this run. Change no label.
Post one \`gh issue comment ${t.number} -R ${P.repo}\`: «${NAME} · skipped: ${reason}».`,
    { ...SMALL, label: `skip:#${t.number}`, phase: 'Skipped' }))
    .then(() => ({ number: t.number, status: 'skipped', reason }))
}

async function runTicket(t) {
  if (doneOnBoard(t)) return { number: t.number, status: 'done', note: 'already done' }
  if (onNeedsHuman(t)) return { number: t.number, status: 'blocked', note: `already in ${C.needsHuman}` }

  // Wait for blockers in this run; a blocker outside the run must already be done.
  const blockers = t.blockers
  for (const bl of blockers) {
    if (!byNum[bl.number] && bl.state.toLowerCase() !== 'closed' && !bl.labels.includes(P.doneLabel)) {
      return skip(t, `depends on #${bl.number}, which is not in the release`)
    }
  }
  const inRun = blockers.filter(bl => byNum[bl.number])
  const results = await Promise.all(inRun.map(bl => start(bl.number)))
  const failed = inRun.filter((bl, i) => !results[i] || results[i].status !== 'done')
  if (failed.length) {
    return skip(t, `depends on ${failed.map(bl => `#${bl.number}`).join(', ')}, which did not reach the release`)
  }

  // The phases of factory.json, in order. The card enters a phase's column when the phase starts (moveCard
  // "start") or when it passes ("end"), never earlier.
  const ctx = { round: 1, prev: null, failure: null, build: null, baseSha: null, checks: [], verdict: null, prevVerdict: null, mergeCommit: null }
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
    // A phase with `exec` runs its own commands in one runner call, card move included.
    if (ph.moveCard === 'start' && !spec.exec) await moveCard(t.number, ph.column, ph.name)
    const opts = { ...optsOf(ph), label: `${ph.name.toLowerCase()}:#${t.number}:r${ctx.round}`, phase: ph.name }
    if (spec.schema) opts.schema = spec.schema
    if (spec.isolation) opts.isolation = spec.isolation
    const call = () => agent(spec.prompt, opts)
    const r = spec.exec ? await spec.exec() : spec.serial ? await serial(call) : await call()
    const out = r ? await spec.read(r) : { pass: false, stop: true, failure: `the ${ph.name} agent returned nothing` }
    if (out.pass) {
      if (ph.moveCard === 'end') await moveCard(t.number, ph.column, ph.name)
      i++
      continue
    }
    // Every failure that sends the ticket back to an earlier phase is a new round, up to MAX_ROUNDS in total.
    const back = F.phases.findIndex(p => p.name === ph.onFail)
    if (!out.stop && back >= 0 && ctx.round < MAX_ROUNDS) {
      ctx.round++
      ctx.failure = out.failure
      ctx.prev = ctx.build ? { branch: ctx.build.branch, commit: ctx.build.commit } : null
      // What belongs to a round dies with it: a block in round 2 quotes only round 2. prevVerdict is the one thing that
      // is meant to cross, so the reviewer sees its own previous verdict.
      ctx.build = null; ctx.baseSha = null; ctx.checks = []; ctx.verdict = null
      i = back
      continue
    }
    if (out.reported) {
      const mark = await markStuck(t.number, ph.name)
      return { number: t.number, status: 'blocked', rounds: ctx.round, reason: out.failure, ...mark }
    }
    return block(t, ctx, out.step || spec.step, out.failure, ph.name)
  }
  return { number: t.number, status: 'done', rounds: ctx.round, mergeCommit: ctx.mergeCommit }
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

// ---------- Cleanup (trial failure 1) ----------

const clean = builds.length ? await agent(`${COMMON}

Clean up the copies this run made, in this folder (the main one). Do not delete any branch.
Copies and branches: ${JSON.stringify(builds)}
Tickets: ${JSON.stringify(results)}
1. \`git worktree list\`. For each copy above that it still lists: if its ticket is done, or its branch has a commit
   (\`git log --oneline ${base}..<branch>\` not empty), \`git worktree remove --force <path>\`; otherwise keep it, it
   holds the only copy of the work. Then \`git worktree prune\`.
2. \`git branch --list\` for every worktreeBranch above and for the branch of every round that was not the last of
   its ticket. branchesLeft = those that still exist: the human deletes them.
3. removed and kept are the paths, as \`git worktree list\` showed them.`,
  { ...SMALL, label: 'cleanup', phase: LAST, schema: CLEANUP_SCHEMA }) : null

// ---------- Report of the list ----------

// The end of a list: the report, built here from the results (not from what an agent remembers), goes into the body
// of the PR from the base to the main branch if one exists. The run never pushes and never opens a PR: with no PR it
// returns the report and the commands the human runs (documentation/launch-list.md, «The end of a list»).

const REPORT_FILE = '.claude/worktrees/run-report.md' // ignored by git; the body that `gh` reads
const oneLine = (s, max = 300) => {
  const x = String(s).replace(/\s+/g, ' ').trim()
  return x.length > max ? `${x.slice(0, max - 1)}…` : x
}
const norm = s => String(s).replace(/\r\n/g, '\n').trim()

function listReport(list, out) {
  const title = n => (byNum[n] ? ` «${byNum[n].title}»` : '')
  const rounds = r => (r.rounds ? `${r.rounds}/${MAX_ROUNDS}` : 'n/a')
  const merged = list.filter(r => r.status === 'done' && r.mergeCommit)
  const blocked = list.filter(r => r.status === 'blocked')
  const skipped = list.filter(r => r.status === 'skipped')
  const ticketLine = r => {
    if (r.status === 'done' && r.mergeCommit) return `- #${r.number}${title(r.number)}: merged into ${base} (${r.mergeCommit}), rounds ${rounds(r)}`
    if (r.status === 'done') return `- #${r.number}${title(r.number)}: ${r.note || 'done'}`
    if (r.status === 'blocked') return `- #${r.number}${title(r.number)}: blocked, rounds ${rounds(r)}${r.marked === false ? `; its card could not be moved to *${C.needsHuman}*: check it by hand` : ''}`
    return `- #${r.number}${title(r.number)}: ${r.status}`
  }
  const why = r => `- #${r.number}: ${oneLine(r.reason || r.note || 'no reason given')}`
  const seen = list.flatMap(r => (out[r.number] || []).map(l => `- #${r.number}: ${oneLine(l, 600)}`))
  return [
    `## ${NAME} report · ${base}`, '',
    '### Tickets', '', ...(list.length ? list.map(ticketLine) : ['- none']), '',
    '### Blocked', '', ...(blocked.length ? blocked.map(why) : ['- none']), '',
    '### Skipped', '', ...(skipped.length ? skipped.map(why) : ['- none']), '',
    '### Out of the ticket (for the backlog)', '', ...(seen.length ? seen : ['- nothing']), '',
    '### Cost', '', '- `/cost` of the session: <the human fills it in>', '',
    ...merged.map(r => `Closes #${r.number}`),
  ].join('\n').trim()
}

const report = listReport(results, outOf)
const prs = await readJson('pr', `gh pr list -R ${P.repo} --head ${base} --base ${P.mainBranch} --state open --json number,url,body`, LAST)
const pr = Array.isArray(prs) && prs.length ? prs[0] : null
const remote = await readRaw('remote', `git ls-remote --heads origin ${base}`, LAST)
const onRemote = !remote || remote.exitCode !== 0 ? null : remote.stdout.trim() !== ''
const notes = []
if (!Array.isArray(prs)) notes.push(`the pull requests of ${P.repo} could not be read: if one from ${base} exists, put the report in its body by hand`)
if (!pr && onRemote === false) notes.push(`${base} is not on the remote (origin): the push creates it`)
if (!pr && onRemote === null) notes.push('the remote (origin) could not be read: check that it has the base before the push')

// With a PR: its body plus the report, with a Closes line only for a ticket the body does not close already.
let body = report
if (pr) {
  const old = norm(pr.body || '')
  const oldLines = new Set(old.split('\n').map(l => l.trim()))
  body = [old, report.split('\n').filter(l => !(l.startsWith('Closes #') && oldLines.has(l.trim()))).join('\n').trim()]
    .filter(Boolean).join('\n\n')
}
const wrote = await agent(`${COMMON}

Leave the report of the list. Do not push, do not create a pull request, do not change a label or a card.
1. With the Write tool (no shell redirection), write the text between the two marker lines to \`${REPORT_FILE}\`,
   character for character, without the marker lines.
${pr ? `2. Run exactly this one command and return its exit code in editExitCode:
   \`gh pr edit ${pr.number} -R ${P.repo} --body-file ${REPORT_FILE}\`` : '2. Run nothing else: editExitCode = null.'}
-----BEGIN REPORT-----
${body}
-----END REPORT-----`,
{ ...SMALL, label: 'report', phase: LAST, schema: { type: 'object', required: ['fileWritten', 'editExitCode'],
  properties: { fileWritten: { type: 'boolean' }, editExitCode: { anyOf: [{ type: 'integer' }, { type: 'null' }] } } } })

// What was left is read back, not taken from the agent's word.
const file = await readRaw('report-file', `cat ${REPORT_FILE}`, LAST)
const fileOk = !!file && file.exitCode === 0 && norm(file.stdout) === norm(body)
let prUpdated = false
if (pr) {
  const now = await readJson('pr-after', `gh pr view ${pr.number} -R ${P.repo} --json body`, LAST)
  prUpdated = !!now && norm(now.body || '') === norm(body)
  if (!prUpdated) notes.push(`the body of PR #${pr.number} could not be confirmed: the report is in ${REPORT_FILE} and below`)
} else if (!fileOk) {
  notes.push(`${REPORT_FILE} was not written as it should: the create command below needs it, so paste the report as the body`)
}
const commands = pr ? [] : [
  ...(onRemote === true ? [] : [`git push -u origin ${base}`]),
  `gh pr create -R ${P.repo} --base ${P.mainBranch} --head ${base} --title "Release ${base.replace(/^release\//, '')}" --body-file ${REPORT_FILE}`,
]

return {
  base,
  tickets: results,
  copiesRemoved: clean ? clean.removed : [],
  copiesKept: clean ? clean.kept : [],
  branchesForTheHuman: clean ? clean.branchesLeft : [],
  report,
  pullRequest: pr ? { number: pr.number, url: pr.url, updated: prUpdated } : null,
  baseOnRemote: onRemote,
  reportFile: fileOk ? REPORT_FILE : null,
  commandsForTheHuman: commands,
  notes,
}
