// What `dynamo run` tells each agent and what it takes from its answer: the prompts, the JSON schemas of the answers, and
// the answers read as data into the outcome of the step. Pure: the subcommand `run` runs the agents.
import type { AgentResult } from './agents.ts';
import type { Check } from './checks.ts';
import type { Outcome } from './rounds.ts';
import { ROUNDS } from './rounds.ts';

const text = { type: 'string' };

export const BUILDER_SCHEMA = {
  type: 'object',
  properties: {
    commit: { type: ['string', 'null'] }, needsHuman: { type: 'boolean' }, needsHumanReason: text,
    published: text, noTrace: text, outOfTicket: text,
  },
  required: ['commit', 'needsHuman', 'needsHumanReason', 'published', 'noTrace', 'outOfTicket'],
  additionalProperties: false,
};

export const REVIEWER_SCHEMA = {
  type: 'object',
  properties: { verdict: { type: 'string', enum: ['PASS', 'FAIL'] }, report: text },
  required: ['verdict', 'report'],
  additionalProperties: false,
};

// `language` is `project.documentsLanguage`: the language of what the Builder writes (see `builderPrompt`).
export type Ticket = { n: number; title: string; repo: string; base: string; copy: string; branch: string; language: string };

// The documents language of a project, from its `project` block of factory.json; `English` when it has none, as `setup` does.
export function languageOf(project: unknown): string {
  const value = typeof project === 'object' && project !== null ? (project as Record<string, unknown>).documentsLanguage : undefined;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : 'English';
}

// What a Builder whose conversation is resumed is told: it already has the ticket, the rules and the round.
export const RESUME_PROMPT = 'Your run was cut off before it ended. Go on where you left it.';

// What the human wrote after a Builder stopped to ask, as the text the Builder is given (word for word, each comment apart).
export function answersText(answers: string[]): string {
  return answers.length === 0
    ? 'The human wrote no comment on the ticket since then.'
    : ['The human\'s comments on the ticket since then, word for word:', ...answers.map((a) => `---\n${a.trim()}`), '---'].join('\n');
}

// What a Builder that stopped to ask the human is told when its conversation is resumed: it already has the ticket and the rules.
export function answerPrompt(answers: string[]): string {
  return `You stopped to ask the human and your run ended there. ${answersText(answers)}\nGo on with their answer: finish the work and answer again. If it still does not settle what you asked, stop again with \`needsHuman\` and say what is missing.`;
}

// What a Builder cut off by a time limit, a budget or an unknown end is told when its conversation is resumed (keeps.ts): why it
// stopped and what the human wrote after the notice. It already has the ticket, the rules and what it did.
export function causePrompt(cause: string, answers: string[]): string {
  return `Your run was stopped: ${cause}. Your conversation, the copy and the branch were kept. ${answersText(answers)}\nGo on where you left it, without exploring again: finish the work and answer again.`;
}

// What a Builder is told when its conversation is resumed after the Reviewer failed it in the last round: the failure, and what the human
// wrote after the notice. It already has the ticket, the rules and what it did.
export function failurePrompt(report: string, answers: string[], by: 'Reviewer' | 'check' = 'Reviewer'): string {
  if (by === 'check') {
    return `The automatic check failed your work in the last round and your run ended there. Its output, word for word:
${report}
${answersText(answers)}
Go on: fix what the check found, with the human's comments in mind, commit, bring the base in and answer again.`;
  }
  return `The Reviewer failed your work in the last round and your run ended there. Its verdict, word for word:
${report}
${answersText(answers)}
Go on: fix what the Reviewer found, with the human's comments in mind, commit, bring the base in and answer again.`;
}

// What a Builder stopped by an outage of the permission check is told once the wait is over: its answer does not stand.
export const OUTAGE_PROMPT = 'The permission check is back: it failed for a while, which says nothing of your commands. Any answer you gave because of it does not stand. Go on where you left it, finish the work and answer again.';

// `resumed`: a run of this ticket was cut off, so its copy may already hold work (a new Builder goes on from it). `answers`: a
// Builder had stopped to ask the human and its conversation could not be resumed, so this one is told what the human wrote;
// `failure`: that stop was the Reviewer's verdict in the last round, which this one is told too; `cause`: it was a limit or an unknown
// end instead (causePrompt), which this one is told with the same comments.
export function builderPrompt(t: Ticket, round: number, failed: string | null, resumed = false, answers: string[] | null = null, failure: string | null = null, cause: string | null = null, by: 'Reviewer' | 'check' = 'Reviewer'): string {
  return [
    `Ticket #${t.n} «${t.title}» of ${t.repo}. Base: ${t.base}. Round ${round} of ${ROUNDS}.`,
    `You run under \`dynamo run\` in your copy ${t.copy}, on the branch ${t.branch}: follow «In a copy under \`dynamo run\`» `
      + 'of your agent file, and answer with the fields of the schema.',
    // The fields of the answer are not «GitHub comments» to a Builder, so its agent file did not reach them: Talia Web's #22
    // had its «No trace» and «Out of the ticket» in English under a Spanish project. The code says it, in every prompt.
    `Write the text of your answer (\`needsHumanReason\`, \`published\`, \`noTrace\`, \`outOfTicket\`), your commit subjects and your GitHub comments in ${t.language} (\`project.documentsLanguage\`); change no number, \`#n\`, command or path.`,
    ...(resumed ? ['A run of this ticket was cut off before it ended: the copy may already hold the work of an earlier Builder (git log and git status show it). Go on from it; do not start over.'] : []),
    ...(answers === null ? [] : cause !== null
      ? [`An earlier Builder of this ticket was stopped (${cause}), and its conversation could not be resumed; the copy holds its work: go on from it, do not start over. ` + answersText(answers)]
      : failure === null
      ? ['An earlier Builder of this ticket stopped to ask the human, and its conversation could not be resumed; the copy holds its work. ' + answersText(answers)]
      : by === 'check'
      ? ['The automatic check failed an earlier Builder of this ticket in the last round, and its conversation could not be resumed; the copy holds its work. The output of the check, word for word:', failure, answersText(answers)]
      : ['The Reviewer failed an earlier Builder of this ticket in the last round, and its conversation could not be resumed; the copy holds its work. The verdict of the Reviewer, word for word:', failure, answersText(answers)]),
    ...(failed === null ? [] : ['', `What failed in round ${round - 1}, word for word:`, failed]),
  ].join('\n');
}

// The result of the check goes in the prompt: it is the proof of any checkbox that asks for the check, which the reviewer
// never runs again (the suite outlasts Bash's limit and an agent that waits on it can hang).
export function reviewerPrompt(t: Ticket, previous: string | null, checks: Check[] | null): string {
  return [
    `Ticket #${t.n} of ${t.repo}. Base: ${t.base}.`,
    `The change: the Builder's copy ${t.copy} (it is your working folder), HEAD of its branch ${t.branch}.`,
    ...(checks === null ? [] : ['The automatic check, which dynamo ran on this change (each command and its exit code):', ...checks.map((c) => `- ${c.command} → exit ${c.code}`)]),
    'Answer with the structured reply: PASS or FAIL in `verdict`, and your whole report in `report`.',
    ...(previous === null ? [] : ['', 'Your previous verdict, word for word:', previous]),
  ].join('\n');
}

export type BuilderAnswer = {
  commit: string | null; needsHuman: boolean; needsHumanReason: string; published: string; noTrace: string; outOfTicket: string;
};
export type ReviewerAnswer = { verdict: 'PASS' | 'FAIL'; report: string };

export const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isText = (x: unknown): x is string => typeof x === 'string';

// The answers of the agents as data, or null when what came is not the one of their schema (unknown until checked).
export function asBuilder(s: unknown): BuilderAnswer | null {
  return isObject(s) && (s.commit === null || isText(s.commit)) && typeof s.needsHuman === 'boolean'
    && isText(s.needsHumanReason) && isText(s.published) && isText(s.noTrace) && isText(s.outOfTicket)
    ? { commit: s.commit, needsHuman: s.needsHuman, needsHumanReason: s.needsHumanReason, published: s.published, noTrace: s.noTrace, outOfTicket: s.outOfTicket }
    : null;
}

export function asReviewer(s: unknown): ReviewerAnswer | null {
  return isObject(s) && (s.verdict === 'PASS' || s.verdict === 'FAIL') && isText(s.report) ? { verdict: s.verdict, report: s.report } : null;
}

// The answer of an agent is unknown until checked: one that ended well without an answer of its schema is an error.
export function readBuilder(r: AgentResult): { outcome: Outcome; answer: BuilderAnswer | null } {
  const answer = asBuilder(r.structured);
  const [ending, detail] = r.ending === 'success' && answer === null ? ['error' as const, 'its answer is not the one of its schema'] : [r.ending, r.detail];
  return { outcome: { step: 'build', ending, detail, needsHuman: answer?.needsHuman ?? false, reason: answer?.needsHumanReason ?? null }, answer };
}

export function readReviewer(r: AgentResult): { outcome: Outcome; answer: ReviewerAnswer | null } {
  const answer = asReviewer(r.structured);
  return { outcome: { step: 'review', ending: r.ending, detail: r.detail, verdict: answer?.verdict ?? null, report: answer?.report ?? null }, answer };
}
