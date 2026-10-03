import { z } from 'zod';
import { isStorableText, UNSTORABLE_TEXT_MESSAGE } from './cv-content';
import type { GenerationIssue, GenerationJobStatus } from './generation-job';

/**
 * Where a question about a CV stands (mirrors the `cv_question_status` database enum):
 * - `open`: waiting for an answer (again, after the AI asked for more detail);
 * - `skipped`: put off on the questions screen; it waits in the editor;
 * - `answered`: the answer is saved, and its update of the CV ran or is running (see `update`);
 * - `dismissed`: the person doesn't want to answer it.
 */
export const CV_QUESTION_STATUSES = ['open', 'skipped', 'answered', 'dismissed'] as const;

export type CvQuestionStatus = (typeof CV_QUESTION_STATUSES)[number];

/**
 * What an answer did to the CV: `updated` it, changed nothing (`no_change`: the answer had nothing
 * to add, or the person had changed that part themselves meanwhile), or the AI needs a clearer
 * answer first (`needs_more_info`, with a follow-up question).
 */
export const ANSWER_OUTCOMES = ['updated', 'no_change', 'needs_more_info'] as const;

export type AnswerOutcome = (typeof ANSWER_OUTCOMES)[number];

export const ANSWER_MAX_LENGTH = 1_000;

/** The background update of the CV from the latest answer. */
export interface CvQuestionUpdateDto {
  jobId: string;
  status: GenerationJobStatus;
  /** Set once the update has completed. */
  outcome: AnswerOutcome | null;
  /** Set when the update failed; shown as a reference next to the error. */
  errorCode: string | null;
}

/** A question the AI asked about a CV, stored with it until it is answered or dismissed. */
export interface CvQuestionDto {
  id: string;
  section: GenerationIssue['section'];
  kind: GenerationIssue['kind'];
  /** The exact place, e.g. "Experience · Northpay". */
  target: string;
  /** The experience or education entry the question is about, if it is about one. */
  itemId: string | null;
  question: string;
  why: string;
  status: CvQuestionStatus;
  /** The latest answer. */
  answer: string | null;
  /** What the AI still needs after that answer; the question is `open` again meanwhile. */
  followUp: string | null;
  update: CvQuestionUpdateDto | null;
}

/** True while an answer is being applied to the CV. */
export function isUpdating(question: CvQuestionDto): boolean {
  return question.update?.status === 'PENDING' || question.update?.status === 'PROCESSING';
}

export const QuestionParamsSchema = z.object({
  cvId: z.uuid(),
  questionId: z.uuid(),
});

export const AnswerQuestionRequestSchema = z.strictObject({
  answer: z
    .string({ error: 'Write an answer, or skip this question.' })
    .trim()
    .min(1, 'Write an answer, or skip this question.')
    .max(ANSWER_MAX_LENGTH, `Use at most ${ANSWER_MAX_LENGTH} characters.`)
    .refine(isStorableText, UNSTORABLE_TEXT_MESSAGE),
});

export type AnswerQuestionRequest = z.input<typeof AnswerQuestionRequestSchema>;

/** Skipping (on the questions screen) or dismissing (in the editor) a question. */
export const UpdateQuestionRequestSchema = z.strictObject({
  status: z.enum(['skipped', 'dismissed']),
});

export type UpdateQuestionRequest = z.infer<typeof UpdateQuestionRequestSchema>;
