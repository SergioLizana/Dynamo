export const meta = {
  name: 'run-list',
  description: 'Build a list of tickets: read the board, build each ready ticket in its own copy, review it, merge one at a time into the working branch, block or skip the rest',
  whenToUse: 'The human runs /run-list with ticket numbers (or none, for every open ticket not done or blocked)',
  phases: [
    { title: 'Frontier', detail: 'read project data, tickets, labels and native blockers' },
    { title: 'Build', detail: 'one agent per ticket and round, in its own worktree' },
    { title: 'Review', detail: 'the reviewer agent judges the ticket branch against the base' },
    { title: 'Merge', detail: 'one at a time in the main folder; block, skip and clean up' },
  ],
}

// A dumb orchestrator: the script only decides what runs next. State comes from GitHub and from what the agents
// return. Project data (repo, branches, board, labels, check, language) comes from .claude/factory.md.

const NAME = 'run-list' // the same as meta.name
const FAST = { model: 'haiku', effort: 'high' }
const MAX_ROUNDS = 2

// Every agent gets these rules. Trial failure 5: in a worktree, chained commands are refused, so one command per
// call and cards moved by URL. Trial failure 4: facts come from commands, never from memory.
const COMMON = `Project data is in \`.claude/factory.md\`: read it first. The board commands are in the file it names.
Hard limits: never push; never check out, merge into or commit on the main branch; never delete a branch.
Run one command per Bash call: no \`&&\`, \`;\`, pipes or \`$(...)\`. Move a card with the single-command form by
issue URL from the board commands file (\`gh project item-edit ... --url ... --field "Status" --value "<state>"\`),
never with the \`move_card\` function.
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
      required: ['repo', 'mainBranch', 'workingBranch', 'doneLabel', 'blockedLabel', 'checks'],
      properties: {
        repo: { type: 'string' }, mainBranch: { type: 'string' }, workingBranch: { type: 'string' },
        doneLabel: { type: 'string' }, blockedLabel: { type: 'string' },
        checks: { type: 'array', items: { type: 'string' } },
      },
    },
    tickets: {
      type: 'array',
      items: {
        type: 'object',
        required: ['number', 'title', 'state', 'labels', 'blockers'],
        properties: {
          number: { type: 'integer' }, title: { type: 'string' }, state: { type: 'string' },
          labels: { type: 'array', items: { type: 'string' } },
          blockers: {
            type: 'array',
            items: {
              type: 'object',
              required: ['number', 'state', 'labels'],
              properties: {
                number: { type: 'integer' }, state: { type: 'string' },
                labels: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  },
}

const BUILD_SCHEMA = {
  type: 'object',
  required: ['worktreePath', 'worktreeBranch', 'branch', 'commit', 'checks', 'checkPassed', 'needsHuman',
    'needsHumanReason', 'published', 'noTrace', 'outOfTicket'],
  properties: {
    worktreePath: { type: 'string' }, worktreeBranch: { type: 'string' }, branch: { type: 'string' },
    commit: { anyOf: [SHA, { type: 'null' }] },
    checks: CHECKS, checkPassed: { type: 'boolean' },
    needsHuman: { type: 'boolean' }, needsHumanReason: { type: 'string' },
    published: { type: 'array', items: { type: 'string' } },
    noTrace: { type: 'array', items: { type: 'string' } },
    outOfTicket: { type: 'array', items: { type: 'string' } },
  },
}

const MERGE_SCHEMA = {
  type: 'object',
  required: ['outcome', 'mergeCommit', 'reason', 'checks'],
  properties: {
    outcome: { type: 'string', enum: ['merged', 'blocked'] },
    mergeCommit: { anyOf: [SHA, { type: 'null' }] },
    reason: { type: 'string' }, checks: CHECKS,
  },
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

// ---------- Frontier ----------

const input = Array.isArray(args) ? { tickets: args } : (args || {})
const wanted = (input.tickets || []).map(Number)

phase('Frontier')
const front = await agent(`${COMMON}

Read the state of the tickets for a run. Change nothing.
1. From \`.claude/factory.md\`: repo, main branch, working branch, done label, blocked label and every command of
   the automatic check. Base branch: ${input.base ? `\`${input.base}\`` : 'the working branch'}; return it as
   workingBranch.
2. In this folder: \`git status --porcelain --untracked-files=no\` must be empty and \`git branch --show-current\` must be the base branch.
   If not, ok = false and stopReason says which.
3. Tickets: ${wanted.length ? wanted.map(n => `#${n}`).join(', ') : 'every open issue that has neither the done label nor the blocked label'}.
   For each: \`gh issue view <n> -R <repo> --json number,title,state,labels\`, and its native blockers from
   \`gh api repos/<repo>/issues/<n>/dependencies/blocked_by --jq '.[]|{number,state,labels:[.labels[].name]}'\`.
4. ok = false too if the base branch is the main branch. Otherwise ok = true and stopReason = "".`,
  { ...FAST, label: 'frontier', phase: 'Frontier', schema: FRONTIER_SCHEMA })

if (!front || !front.ok) {
  return { stopped: front ? front.stopReason : 'the Frontier agent returned nothing' }
}
const P = front.project
const base = P.workingBranch
if (base === P.mainBranch) return { stopped: `the base is the main branch (${base})` }

const byNum = {}
for (const t of front.tickets) byNum[t.number] = t
const doneOnBoard = t => t.state.toLowerCase() === 'closed' || t.labels.includes(P.doneLabel)

// ---------- One ticket ----------

// Merges, block reports and skip reports go through this queue: one at a time in the main folder.
let queue = Promise.resolve()
function serial(fn) {
  const p = queue.then(fn)
  queue = p.catch(() => null)
  return p
}

const builds = [] // every Build result, for the cleanup

// Trial failure 2: round 2 brings round 1's commits with cherry-pick (linear history), and only if there are any.
function buildPrompt(t, round, prev) {
  const second = round === 1 ? '' : `
This is round ${round}. Round 1 left its work on branch \`${prev.branch}\`${prev.commit ? ` (commit ${prev.commit})` : ' with no commit'}.
- If \`git log --oneline ${base}..${prev.branch}\` lists commits, bring them in with
  \`git cherry-pick ${base}..${prev.branch}\`. If it lists none, do not cherry-pick: start from the base.
- Fix exactly what failed, nothing more:
${prev.failure}
- Whatever round 1 already published on GitHub for a checkbox: edit that comment if it must change, never post it again.`
  return `${COMMON}

You are the Builder of ticket #${t.number} («${t.title}») in repo \`${P.repo}\`, base \`${base}\`. You are in your own
copy (a git worktree) that starts at the tip of the base.
1. Note \`git rev-parse --show-toplevel\` (worktreePath) and \`git branch --show-current\` (worktreeBranch).
2. \`git checkout -b ticket/${t.number}-<short-slug>${round === 1 ? '' : `-r${round}`}\`. Move the card to *In Progress*.
3. \`gh issue view ${t.number} -R ${P.repo}\`: read the ticket and the plan sections it cites. Change only what it asks.${second}
4. If a checkbox asks for something written outside the code (a comment on the ticket, a note), publish it now and
   list it in \`published\`. For a checkbox that leaves no trace in git or GitHub, put \`command → output\` in \`noTrace\`.
5. Move the card to *Verify*. Run every command of the automatic check with \`<base>\` = \`${base}\`. Report each with
   its exit code and its literal output (trimmed to the failing part).
6. Only if all exit 0: stage only the files of the change (\`git add <paths>\`), commit with a subject ending in
   \`(#${t.number})\` plus the attribution line Claude Code gives you, and move the card to *In Review*.
   Otherwise do not commit. Never check out the base and never merge.
7. needsHuman = true only if the ticket contradicts itself or cannot be done without a decision from the human;
   say why in needsHumanReason. Anything you noticed outside the ticket goes in \`outOfTicket\`.`
}

function reviewPrompt(t, round, b, prevVerdict) {
  return `Review ticket ${t.number} of repo ${P.repo}. Base: ${base}.
The change is committed on branch \`${b.branch}\` (commit ${b.commit}), which is not checked out here: read it with
\`git diff ${base}...${b.branch}\`, \`git log ${base}..${b.branch}\` and \`git show ${b.branch}:<path>\`. Do not check it out.
The automatic check passed in the Builder's copy: ${b.checks.map(c => `\`${c.command}\` → ${c.exitCode}`).join('; ')}.
Round ${round}.${prevVerdict ? `\nYour previous verdict, word for word:\n${prevVerdict}` : ''}`
}

function reportShape(head) {
  return `\`\`\`text
${NAME} · ${head}
Vueltas: <round>/${MAX_ROUNDS}
Comprobación: <cada comando → resultado>
Revisor: <veredicto final, una línea por casilla> | sin revisión
Pruebas sin rastro en GitHub: <command → output> | ninguna
Fuera del ticket (para el backlog): <lo visto> | nada
\`\`\``
}

function block(t, round, reason, b, verdict) {
  return serial(() => agent(`${COMMON}

Ticket #${t.number} in repo \`${P.repo}\` stops as blocked: it is not merged.
1. Add the blocked label. Do not move the card: it stays where it stopped.
2. Check where its work is: \`git branch --list "ticket/${t.number}-*"\` and \`git worktree list\`.
3. One \`gh issue comment ${t.number} -R ${P.repo}\` with this shape, and the reason as a literal quote plus where the
   work is (only what step 2 showed):
${reportShape(`no fusionado: <motivo>`)}
Reason: ${reason}
Round: ${round}. Builder: ${JSON.stringify(b || {})}
Verdict: ${verdict || 'sin revisión'}`,
    { ...FAST, label: `block:#${t.number}`, phase: 'Merge' }))
    .then(() => ({ number: t.number, status: 'blocked', rounds: round, reason }))
}

function skip(t, reason) {
  return serial(() => agent(`${COMMON}

Ticket #${t.number} in repo \`${P.repo}\` is skipped in this run. Change no label and do not move its card.
Post one \`gh issue comment ${t.number} -R ${P.repo}\`: «${NAME} · saltado: ${reason}».`,
    { ...FAST, label: `skip:#${t.number}`, phase: 'Merge' }))
    .then(() => ({ number: t.number, status: 'skipped', reason }))
}

async function runTicket(t) {
  if (doneOnBoard(t)) return { number: t.number, status: 'done', note: 'ya estaba hecho' }
  if (t.labels.includes(P.blockedLabel)) return { number: t.number, status: 'blocked', note: 'ya estaba bloqueado' }

  // Wait for blockers in this run; a blocker outside the run must already be done.
  for (const bl of t.blockers) {
    if (!byNum[bl.number] && bl.state.toLowerCase() !== 'closed' && !bl.labels.includes(P.doneLabel)) {
      return skip(t, `depende de #${bl.number}, que no está en la release`)
    }
  }
  const inRun = t.blockers.filter(bl => byNum[bl.number])
  const results = await Promise.all(inRun.map(bl => start(bl.number)))
  const failed = inRun.filter((bl, i) => !results[i] || results[i].status !== 'done')
  if (failed.length) {
    return skip(t, `depende de ${failed.map(bl => `#${bl.number}`).join(', ')}, que no llegó a la release`)
  }

  let prev = null
  let prevVerdict = null
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const b = await agent(buildPrompt(t, round, prev),
      { ...FAST, label: `build:#${t.number}:r${round}`, phase: 'Build', isolation: 'worktree', schema: BUILD_SCHEMA })
    if (!b) return block(t, round, 'el agente Build no devolvió nada', null, null)
    builds.push({ number: t.number, round, worktreePath: b.worktreePath, worktreeBranch: b.worktreeBranch, branch: b.branch })

    // Trial failure 3: a second round cannot fix a ticket that needs the human.
    if (b.needsHuman) return block(t, round, `necesita al humano: ${b.needsHumanReason}`, b, null)

    if (!b.checkPassed || !b.commit) {
      const failure = b.checks.filter(c => c.exitCode !== 0).map(c => `\`${c.command}\` → ${c.exitCode}\n${c.output}`).join('\n')
        || 'no commit was made'
      if (round === MAX_ROUNDS) return block(t, round, `comprobación: ${failure}`, b, null)
      prev = { branch: b.branch, commit: b.commit, failure: `The automatic check failed:\n${failure}` }
      continue
    }

    const verdict = await agent(reviewPrompt(t, round, b, prevVerdict),
      { label: `review:#${t.number}:r${round}`, phase: 'Review', agentType: 'reviewer' })
    if (!verdict) return block(t, round, 'el revisor no devolvió nada', b, null)
    const pass = /VEREDICTO:\s*PASA/.test(verdict)
    if (!pass) {
      if (round === MAX_ROUNDS) return block(t, round, 'el revisor dice FALLA', b, verdict)
      const forBuilder = (verdict.match(/Para el Builder:[\s\S]*?(?=\nNotas|$)/) || [verdict])[0]
      prev = { branch: b.branch, commit: b.commit, failure: `The reviewer said FALLA. ${forBuilder}` }
      prevVerdict = verdict
      continue
    }

    const m = await serial(() => agent(`${COMMON}

Merge ticket #${t.number} in repo \`${P.repo}\` into \`${base}\`, in this folder (the main one).
1. \`git status --porcelain --untracked-files=no\` must be empty and \`git branch --show-current\` must be \`${base}\`. If not, outcome =
   blocked and say why; change nothing.
2. \`git merge --no-ff ${b.branch} -m "Fusiona ${b.branch} en ${base} (#${t.number})"\`. On a conflict:
   \`git merge --abort\`, outcome = blocked, reason = the conflicting files.
3. Move the card to *Verify* and run every command of the automatic check with \`<base>\` = \`${base}\`. If any fails:
   \`git revert -m 1 --no-edit HEAD\`, outcome = blocked, reason = the failing command and its output.
4. If blocked: add the blocked label and leave the card where it stopped. If merged: mergeCommit is what
   \`git rev-parse --short HEAD\` prints after the merge; add the done label and move the card to *Done*.
5. One \`gh issue comment ${t.number} -R ${P.repo}\`, the only report of this ticket, with this shape:
${reportShape(`<PASA y fusionado en ${base} (<mergeCommit>) | no fusionado: <motivo>>`)}
   Do not repeat what the Builder already published: ${JSON.stringify(b.published)}.
Round: ${round}. Builder's checks: ${JSON.stringify(b.checks)}. No trace: ${JSON.stringify(b.noTrace)}.
Out of the ticket: ${JSON.stringify(b.outOfTicket)}.
Verdict:
${verdict}`,
      { ...FAST, label: `merge:#${t.number}`, phase: 'Merge', schema: MERGE_SCHEMA }))
    if (!m) return { number: t.number, status: 'blocked', rounds: round, reason: 'el agente Merge no devolvió nada' }
    return m.outcome === 'merged'
      ? { number: t.number, status: 'done', rounds: round, mergeCommit: m.mergeCommit }
      : { number: t.number, status: 'blocked', rounds: round, reason: m.reason }
  }
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
  { ...FAST, label: 'cleanup', phase: 'Merge', schema: CLEANUP_SCHEMA }) : null

return {
  base,
  tickets: results,
  copiesRemoved: clean ? clean.removed : [],
  copiesKept: clean ? clean.kept : [],
  branchesForTheHuman: clean ? clean.branchesLeft : [],
}
