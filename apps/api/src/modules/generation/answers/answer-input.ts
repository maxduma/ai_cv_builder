import {
  ANSWER_MAX_LENGTH,
  type CvContent,
  GENERATION_ISSUE_KINDS,
  GENERATION_ISSUE_SECTIONS,
  GenerationIssueSchema,
  TARGET_ROLE_MAX_LENGTH,
} from '@cv-builder/shared';
import { z } from 'zod';
import type { Logger } from '../../../lib/logger';

const issue = GenerationIssueSchema.shape;

/**
 * The snapshot an answer job works from, stored in `generation_jobs.input` when the person answers.
 * The CV itself is not in it: the job reads the CV when it starts, so it builds on every edit and
 * every earlier answer made until then.
 */
export const AnswerInputSchema = z.object({
  /** The CV's target role; empty when it has none. */
  targetRole: z.string().max(TARGET_ROLE_MAX_LENGTH),
  question: z.object({
    section: z.enum(GENERATION_ISSUE_SECTIONS),
    kind: z.enum(GENERATION_ISSUE_KINDS),
    target: issue.target,
    /** The experience or education entry the question is about. */
    itemId: z.string().min(1).max(64).nullable(),
    question: issue.question,
    why: issue.why,
  }),
  answer: z.string().min(1).max(ANSWER_MAX_LENGTH),
  /** The AI's request for more detail this answer replies to, and the answer that prompted it. */
  followUp: z.string().min(1).nullable(),
  previousAnswer: z.string().min(1).nullable(),
});

export type AnswerInput = z.infer<typeof AnswerInputSchema>;

/** What an answer updater works from: the job's input, and the CV as it was when the job started. */
export interface AnswerRequest extends AnswerInput {
  cv: CvContent;
}

export interface AnswerHooks {
  /**
   * Aborted when the worker shuts down, loses the job or reaches its deadline; updaters must stop
   * promptly and let the abort propagate.
   */
  signal: AbortSignal;
  /** The job's logger. Never log the CV or the answer. */
  log: Logger;
}

/**
 * Turns an answer into changes to one section of the CV: an object in the shape of that section's
 * `ANSWER_UPDATE_SCHEMAS` entry. The result is untrusted until the worker has validated it.
 */
export interface AnswerUpdater {
  apply(request: AnswerRequest, hooks: AnswerHooks): Promise<unknown>;
}
