import type { AnswerQuestionRequest, UpdateQuestionRequest } from '@cv-builder/shared';
import { AppError, NotFoundError } from '../../lib/errors';
import { type AnswerInput, AnswerInputSchema } from '../generation/answers/answer-input';
import type {
  AnswerContext,
  QuestionsRepository,
  QuestionWriteResult,
} from './questions.repository';

/**
 * The AI's follow-up this answer replies to, and the answer that prompted it: from the question
 * while it waits for that reply, or, when a reply is tried again after its update failed, from
 * the failed update (the question was cleared when the reply was saved).
 */
function earlierExchange({ question, failedInput }: AnswerContext) {
  if (question.followUp) return { followUp: question.followUp, previousAnswer: question.answer };
  const failed = AnswerInputSchema.safeParse(failedInput);
  return failed.success
    ? { followUp: failed.data.followUp, previousAnswer: failed.data.previousAnswer }
    : { followUp: null, previousAnswer: null };
}

/** The snapshot the answer job works from (the CV itself is read when the job starts). */
function toAnswerInput(answer: string, context: AnswerContext): AnswerInput {
  const { targetRole, question } = context;
  return AnswerInputSchema.parse({
    targetRole: targetRole ?? '',
    question: {
      section: question.section,
      kind: question.kind,
      target: question.target,
      itemId: question.itemId,
      question: question.question,
      why: question.why,
    },
    answer,
    // Only an answer to a follow-up carries the earlier exchange.
    ...earlierExchange(context),
  });
}

function questionOf(result: QuestionWriteResult) {
  switch (result.kind) {
    case 'not_found':
      throw new NotFoundError('Question not found');
    case 'busy':
      throw new AppError(
        409,
        'QUESTION_BUSY',
        'The last answer to this question is still being applied',
      );
    case 'closed':
      throw new AppError(409, 'QUESTION_CLOSED', 'This question can no longer be answered');
    case 'done':
      return result.question;
  }
}

/** Answering, skipping and dismissing the AI's questions about a CV. */
export function createQuestionsService(questions: QuestionsRepository) {
  return {
    /** Saves the answer and queues its update of the CV. Nothing waits for it: clients poll. */
    async answer(userId: string, cvId: string, questionId: string, input: AnswerQuestionRequest) {
      const answer = input.answer.trim();
      return questionOf(
        await questions.answer(userId, cvId, questionId, answer, (context) =>
          toAnswerInput(answer, context),
        ),
      );
    },

    async setStatus(
      userId: string,
      cvId: string,
      questionId: string,
      { status }: UpdateQuestionRequest,
    ) {
      const dbStatus = status === 'skipped' ? 'SKIPPED' : 'DISMISSED';
      return questionOf(await questions.setStatus(userId, cvId, questionId, dbStatus));
    },
  };
}

export type QuestionsService = ReturnType<typeof createQuestionsService>;
