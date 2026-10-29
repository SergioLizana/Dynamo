// What `dynamo run` tells each agent and what it takes from its answer: the prompts, the JSON schemas of the answers, and
// the answers read as data into the outcome of the step. Pure: the subcommand `run` runs the agents.
import type { AgentResult } from './agents.ts';
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

export type Ticket = { n: number; title: string; repo: string; base: string; copy: string; branch: string };

export function builderPrompt(t: Ticket, round: number, failed: string | null): string {
  return [
    `Ticket #${t.n} «${t.title}» of ${t.repo}. Base: ${t.base}. Round ${round} of ${ROUNDS}.`,
    `You run under \`dynamo run\` in your copy ${t.copy}, on the branch ${t.branch}: follow «In a copy under \`dynamo run\`» `
      + 'of your agent file, and answer with the fields of the schema.',
    ...(failed === null ? [] : ['', `What failed in round ${round - 1}, word for word:`, failed]),
  ].join('\n');
}

export function reviewerPrompt(t: Ticket, previous: string | null): string {
  return [
    `Ticket #${t.n} of ${t.repo}. Base: ${t.base}.`,
    `The change: the Builder's copy ${t.copy} (it is your working folder), HEAD of its branch ${t.branch}.`,
    'Answer with the structured reply: PASS or FAIL in `verdict`, and your whole report in `report`.',
    ...(previous === null ? [] : ['', 'Your previous verdict, word for word:', previous]),
  ].join('\n');
}

export type BuilderAnswer = {
  commit: string | null; needsHuman: boolean; needsHumanReason: string; published: string; noTrace: string; outOfTicket: string;
};
export type ReviewerAnswer = { verdict: 'PASS' | 'FAIL'; report: string };

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isText = (x: unknown): x is string => typeof x === 'string';

// The answer of an agent is unknown until checked: one that ended well without an answer of its schema is an error.
export function readBuilder(r: AgentResult): { outcome: Outcome; answer: BuilderAnswer | null } {
  const s = r.structured;
  const answer = isObject(s) && (s.commit === null || isText(s.commit)) && typeof s.needsHuman === 'boolean'
    && isText(s.needsHumanReason) && isText(s.published) && isText(s.noTrace) && isText(s.outOfTicket)
    ? { commit: s.commit, needsHuman: s.needsHuman, needsHumanReason: s.needsHumanReason, published: s.published, noTrace: s.noTrace, outOfTicket: s.outOfTicket }
    : null;
  const [ending, detail] = r.ending === 'success' && answer === null ? ['error' as const, 'its answer is not the one of its schema'] : [r.ending, r.detail];
  return { outcome: { step: 'build', ending, detail, needsHuman: answer?.needsHuman ?? false, reason: answer?.needsHumanReason ?? null }, answer };
}

export function readReviewer(r: AgentResult): { outcome: Outcome; answer: ReviewerAnswer | null } {
  const s = r.structured;
  const answer = isObject(s) && (s.verdict === 'PASS' || s.verdict === 'FAIL') && isText(s.report) ? { verdict: s.verdict, report: s.report } : null;
  return { outcome: { step: 'review', ending: r.ending, detail: r.detail, verdict: answer?.verdict ?? null, report: answer?.report ?? null }, answer };
}
