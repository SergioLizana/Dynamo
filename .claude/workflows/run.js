export const meta = {
  name: 'run',
  description: 'Build a list of tickets: read the board, build each ready ticket in its own copy, check it, review it, merge one at a time into the working branch, block or skip the rest',
  whenToUse: 'The human runs /run with ticket numbers (or none, for every open ticket not done or blocked)',
}

// A dumb orchestrator: the script only decides what runs next. State comes from GitHub and from what the agents
// return. Project data (repo, branches, board, labels, check, language) comes from .claude/factory.md; the board
// columns and the phases (order, column, model, effort, agent type, where a failure goes) from .claude/factory.json.
// One phase = one column = one agent. To add one: an entry in factory.json and a function in PHASES
// (documentation/launch-list.md, «The phases»).

const NAME = 'run' // the same as meta.name
const FACTORY_JSON = '.claude/factory.json'
const MAX_ROUNDS = 2

// Every agent gets these rules. Trial failure 5: in a worktree, chained commands are refused, so one command per
// call. Trial failure 4: facts come from commands, never from memory.
const COMMON = `Project data is in \`.claude/factory.md\`: read it first. The board commands are in the file it names.
Hard limits: never push; never check out, merge into or commit on the main branch; never delete a branch.
Run one command per Bash call: no \`&&\`, \`;\`, pipes or \`$(...)\`. Never move a card: the script moves them.
Every fact you return or write on GitHub comes from a command you ran in this step: a commit is the sha that
\`git rev-parse --short HEAD\` printed, a copy or branch exists only if \`git worktree list\` or
\`git branch --list\` shows it. Never write «HEAD of …» or a path you did not see.
Write GitHub comments and commit subjects in the documents language of \`.claude/factory.md\`.`

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

const FRONTIER_SCHEMA = {
  type: 'object',
  required: ['ok', 'stopReason', 'project', 'tickets'],
  properties: {
    ok: { type: 'boolean' },
    stopReason: { type: 'string' },
    project: {
      type: 'object',
      required: ['repo', 'mainBranch', 'workingBranch', 'doneLabel', 'checks', 'boardOwner', 'boardNumber'],
      properties: {
        repo: { type: 'string' }, mainBranch: { type: 'string' }, workingBranch: { type: 'string' },
        doneLabel: { type: 'string' },
        checks: { type: 'array', items: { type: 'string' } },
        boardOwner: { type: 'string' }, boardNumber: { type: 'integer' },
      },
    },
    tickets: {
      type: 'array',
      items: {
        type: 'object',
        required: ['number', 'title', 'state', 'labels', 'status'],
        properties: {
          number: { type: 'integer' }, title: { type: 'string' }, state: { type: 'string' },
          labels: { type: 'array', items: { type: 'string' } },
          status: { type: 'string' },
        },
      },
    },
  },
}

// Run wf_41e0b269-ab2: an agent's summary of a command is not the command. A raw read returns the literal output
// and the script parses it.
const RAW_SCHEMA = {
  type: 'object',
  required: ['exitCode', 'stdout'],
  properties: { exitCode: { type: 'integer' }, stdout: { type: 'string' } },
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

const VERIFY_SCHEMA = {
  type: 'object',
  required: ['checks', 'passed'],
  properties: { checks: CHECKS, passed: { type: 'boolean' } },
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

// One function per phase of factory.json, picked by its name. It gets the ticket and its state (ctx) and returns:
// prompt; schema, isolation and serial (one at a time in the main folder), if it needs them; step, the word for
// «Parado en»; and read(result) → { pass: true } or { pass: false, failure, stop?, reported? }. On a failure the
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
    read: b => {
      builds.push({ number: t.number, round: ctx.round, worktreePath: b.worktreePath, worktreeBranch: b.worktreeBranch, branch: b.branch })
      ctx.build = b
      outOf[t.number] = b.outOfTicket // the latest round's, for the report of the list
      // Trial failure 3: a second round cannot fix a ticket that needs the human.
      if (b.needsHuman) return { pass: false, stop: true, failure: `needs the human: ${b.needsHumanReason}` }
      if (!b.commit) return { pass: false, failure: 'the Builder made no commit' }
      return { pass: true }
    },
  }
}

// The check runs in the Builder's copy, on its commit, and the script reads the result. The commit and the state of
// the copy are not the agent's to report: the script reads them from the literal output of two commands.
function verifyPhase(t, ctx) {
  const b = ctx.build
  return {
    step: 'check',
    schema: VERIFY_SCHEMA,
    prompt: `${COMMON}

Run the automatic check of ticket #${t.number} in the Builder's copy \`${b.worktreePath}\` (branch \`${b.branch}\`,
commit ${b.commit}). Change nothing: no edit, no commit, no label, no comment.
1. \`cd ${b.worktreePath}\`, alone in its call. Every command below runs there.
2. Run each of these, one per call, and return each with its exit code and its literal output (trimmed to the
   failing part):
${P.checks.map(c => `   - \`${c.split('<base>').join(base)}\``).join('\n')}
3. passed = true only if every one of them exited 0.`,
    read: async v => {
      ctx.checks = v.checks
      const bad = []
      const head = await readRaw(`head:#${t.number}:r${ctx.round}`, `git -C ${b.worktreePath} rev-parse --short HEAD`, 'Verify')
      const status = await readRaw(`status:#${t.number}:r${ctx.round}`, `git -C ${b.worktreePath} status --porcelain`, 'Verify')
      const sha = head && head.exitCode === 0 ? head.stdout.trim() : ''
      if (!sha) bad.push('the commit of the copy could not be read')
      else if (!(sha.startsWith(b.commit) || b.commit.startsWith(sha))) bad.push(`it ran on ${sha}, not on the Builder's commit ${b.commit}`)
      if (!status || status.exitCode !== 0) bad.push('the state of the copy could not be read')
      else if (status.stdout.trim()) bad.push(`uncommitted changes in the copy:\n${status.stdout}`)
      if (v.checks.length < P.checks.length) bad.push('not every command of the check ran')
      for (const c of v.checks) if (c.exitCode !== 0) bad.push(`\`${c.command}\` → ${c.exitCode}\n${c.output}`)
      if (!v.passed && !bad.length) bad.push('the agent said the check did not pass')
      return bad.length ? { pass: false, failure: `The automatic check failed:\n${bad.join('\n')}` } : { pass: true }
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
  const c = f.columns
  if (!c || !str(c.todo) || !str(c.needsHuman) || !str(c.done)) return 'columns needs todo, needsHuman and done'
  const s = f.start
  if (!s || !str(s.name) || !opt(s.model) || !opt(s.effort)) return 'start needs a name, a model and an effort (or null)'
  if (!Array.isArray(f.phases) || !f.phases.length) return 'phases must be a list with at least one phase'
  const seen = []
  for (const p of f.phases) {
    if (!p || !str(p.name)) return 'every phase needs a name'
    const at = `phase «${p.name}»`
    if (seen.includes(p.name) || p.name === s.name) return `${at} is named twice`
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
const SMALL = optsOf(F.start) // the Frontier and the script's small agents: raw reads, cards, reports, cleanup
const START = F.start.name
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

phase(START)
const front = await agent(`${COMMON}

Read the state of the tickets for a run. Change nothing.
1. From \`.claude/factory.md\`: repo, main branch, working branch, done label, every command of the automatic check,
   and the board's owner and number.
   Base branch: ${input.base ? `\`${input.base}\`` : 'the working branch'}; return it as workingBranch.
2. In this folder: \`git status --porcelain --untracked-files=no\` must be empty and \`git branch --show-current\` must be the base branch.
   If not, ok = false and stopReason says which.
3. Tickets: ${wanted.length ? wanted.map(n => `#${n}`).join(', ') : `every open issue that has neither the done label nor a card in *${C.needsHuman}*`}.
   For each: \`gh issue view <n> -R <repo> --json number,title,state,labels,projectItems\`. Do not read its blockers.
   status = the name of its item's status in the board, or "" if it has none.
4. ok = false too if the base branch is the main branch. Otherwise ok = true and stopReason = "".`,
  { ...SMALL, label: START.toLowerCase(), phase: START, schema: FRONTIER_SCHEMA })

if (!front || !front.ok) {
  return { stopped: front ? front.stopReason : `the ${START} agent returned nothing` }
}
const P = front.project
const base = P.workingBranch
if (base === P.mainBranch) return { stopped: `the base is the main branch (${base})` }

const byNum = {}
for (const t of front.tickets) byNum[t.number] = t
const doneOnBoard = t => t.state.toLowerCase() === 'closed' || t.labels.includes(P.doneLabel)
const onNeedsHuman = t => t.status === C.needsHuman

// One command and its literal output, as the agent got them. null if the agent returned nothing.
function readRaw(label, command, phase) {
  return agent(`Run exactly this one command and nothing else, then return its exit code and its standard
output character for character: no summary, no reformatting, nothing left out.
${command}`, { ...SMALL, label, phase, schema: RAW_SCHEMA })
}

// The same, parsed here. null if it failed or is not JSON.
async function readJson(label, command, phase) {
  const r = await readRaw(label, command, phase)
  if (!r || r.exitCode !== 0) return null
  try { return JSON.parse(r.stdout.trim()) } catch (e) { return null }
}

// Native blockers, from GitHub's output and not from an agent's summary. null if they cannot be read.
async function readBlockers(n) {
  const list = await readJson(`blockers:#${n}`,
    `gh api repos/${P.repo}/issues/${n}/dependencies/blocked_by --jq '[.[]|{number,state,labels:[.labels[].name]}]'`, START)
  if (!Array.isArray(list)) return null
  if (!list.every(b => b && Number.isInteger(b.number) && typeof b.state === 'string' && Array.isArray(b.labels))) return null
  return list
}

// The script moves every card, by issue URL, and checks it on GitHub: the board always shows the real step.
async function moveCard(n, column, group) {
  const url = `https://github.com/${P.repo}/issues/${n}`
  let seen = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    await agent(`Move the card of ticket #${n}. Run exactly this command and nothing else:
\`gh project item-edit ${P.boardNumber} --owner ${P.boardOwner} --url ${url} --field "Status" --value "${column}"\``,
      { ...SMALL, label: `card:#${n}:${column}:${attempt}`, phase: group })
    seen = await readJson(`card-check:#${n}:${attempt}`, `gh issue view ${n} -R ${P.repo} --json projectItems`, group)
    const items = seen && Array.isArray(seen.projectItems) ? seen.projectItems : []
    if (items.some(i => i && i.status && i.status.name === column)) return { moved: true }
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
    { ...SMALL, label: `skip:#${t.number}`, phase: START }))
    .then(() => ({ number: t.number, status: 'skipped', reason }))
}

async function runTicket(t) {
  if (doneOnBoard(t)) return { number: t.number, status: 'done', note: 'already done' }
  if (onNeedsHuman(t)) return { number: t.number, status: 'blocked', note: `already in ${C.needsHuman}` }

  // Wait for blockers in this run; a blocker outside the run must already be done.
  const blockers = blockersOf[t.number]
  if (!blockers) return skip(t, 'its blockers could not be read on GitHub')
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
  const ctx = { round: 1, prev: null, failure: null, build: null, checks: [], verdict: null, prevVerdict: null, mergeCommit: null }
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
    const spec = PHASES[ph.name](t, ctx)
    at.step = spec.step
    if (ph.moveCard === 'start') await moveCard(t.number, ph.column, ph.name)
    const opts = { ...optsOf(ph), label: `${ph.name.toLowerCase()}:#${t.number}:r${ctx.round}`, phase: ph.name }
    if (spec.schema) opts.schema = spec.schema
    if (spec.isolation) opts.isolation = spec.isolation
    const call = () => agent(spec.prompt, opts)
    const r = spec.serial ? await serial(call) : await call()
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
      i = back
      continue
    }
    if (out.reported) {
      const mark = await markStuck(t.number, ph.name)
      return { number: t.number, status: 'blocked', rounds: ctx.round, reason: out.failure, ...mark }
    }
    return block(t, ctx, spec.step, out.failure, ph.name)
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

const order = front.tickets.map(t => t.number).sort((a, b) => a - b)
// All blockers before any ticket starts: start() finds cycles only while runTicket has not awaited yet.
const blockersOf = {}
await parallel(order.map(n => async () => { blockersOf[n] = await readBlockers(n) }))
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
