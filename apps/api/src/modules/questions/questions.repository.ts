import { type CvContent, CvContentSchema } from '@cv-builder/shared';
import type { PrismaClient } from '../../db/prisma';
import type { Prisma } from '../../generated/prisma/client';
import type { AnswerInput } from '../generation/answers/answer-input';

export const cvQuestionColumns = {
  id: true,
  section: true,
  kind: true,
  target: true,
  itemId: true,
  question: true,
  why: true,
  status: true,
  answer: true,
  followUp: true,
  // The latest answer's update.
  jobs: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { id: true, status: true, errorCode: true, result: true },
  },
} satisfies Prisma.CvQuestionSelect;

export type CvQuestionRecord = Prisma.CvQuestionGetPayload<{ select: typeof cvQuestionColumns }>;

/** What an answer job's input is built from; read while the CV's row is locked. */
export interface AnswerContext {
  targetRole: string | null;
  question: CvQuestionRecord;
  /**
   * When this answer tries again after a failed update: that update's input (unvalidated). It
   * holds the follow-up exchange, which the question itself no longer does by then.
   */
  failedInput: unknown;
}

export type QuestionWriteResult =
  | { kind: 'not_found' }
  /** Its answer is being applied right now. */
  | { kind: 'busy' }
  /** Dismissed, already applied, or about an entry that no longer exists. */
  | { kind: 'closed' }
  | { kind: 'done'; question: CvQuestionRecord };

const isActive = (question: CvQuestionRecord) =>
  question.jobs[0]?.status === 'PENDING' || question.jobs[0]?.status === 'PROCESSING';

/** Whether the entry a question is about is still in the CV. */
function hasEntry(content: CvContent, question: CvQuestionRecord): boolean {
  if (!question.itemId) return true;
  const entries =
    question.section === 'experience'
      ? content.experience
      : question.section === 'education'
        ? content.education
        : [];
  return entries.some((entry) => entry.id === question.itemId);
}

/**
 * Data access for the questions the AI asked about CVs. Every write first locks the CV's row,
 * like the other writers of a CV's content, questions and answer jobs, so they never interleave.
 */
export function createQuestionsRepository(prisma: PrismaClient) {
  async function lockCv(tx: Prisma.TransactionClient, userId: string, cvId: string) {
    const [cv] = await tx.$queryRaw<{ content: unknown; target_role: string | null }[]>`
      SELECT content, target_role FROM cvs
      WHERE id = ${cvId}::uuid AND user_id = ${userId}::uuid FOR UPDATE`;
    return cv;
  }

  const findQuestion = (
    tx: Prisma.TransactionClient,
    userId: string,
    cvId: string,
    questionId: string,
  ) =>
    tx.cvQuestion.findFirst({
      where: { id: questionId, cvId, userId },
      select: cvQuestionColumns,
    });

  return {
    /**
     * Saves an answer and queues the job that applies it, unless the question can't take one:
     * an open or skipped question can, and an answered one whose update failed (to try again).
     */
    answer(
      userId: string,
      cvId: string,
      questionId: string,
      answer: string,
      buildInput: (context: AnswerContext) => AnswerInput,
    ): Promise<QuestionWriteResult> {
      return prisma.$transaction(async (tx) => {
        const cv = await lockCv(tx, userId, cvId);
        const question = cv && (await findQuestion(tx, userId, cvId, questionId));
        if (!question) return { kind: 'not_found' } as const;
        if (isActive(question)) return { kind: 'busy' } as const;

        const failedUpdate = question.jobs[0]?.status === 'FAILED';
        const answerable =
          question.status === 'OPEN' ||
          question.status === 'SKIPPED' ||
          (question.status === 'ANSWERED' && failedUpdate);
        // Questions only exist for generated CVs, so the content is there.
        const content = CvContentSchema.safeParse(cv.content);
        if (!answerable || !content.success || !hasEntry(content.data, question)) {
          return { kind: 'closed' } as const;
        }

        const failed =
          failedUpdate && question.jobs[0]
            ? await tx.generationJob.findUnique({
                where: { id: question.jobs[0].id },
                select: { input: true },
              })
            : null;
        const input = buildInput({
          targetRole: cv.target_role,
          question,
          failedInput: failed?.input ?? null,
        });
        await tx.cvQuestion.update({
          where: { id: questionId },
          data: { status: 'ANSWERED', answer, followUp: null },
        });
        await tx.generationJob.create({
          data: { cvId, userId, kind: 'APPLY_ANSWER', questionId, input },
        });
        const updated = await findQuestion(tx, userId, cvId, questionId);
        return { kind: 'done', question: updated! } as const;
      });
    },

    /**
     * Skips (only a question still waiting for its first answer) or dismisses a question. Neither
     * can happen while its answer is being applied.
     */
    setStatus(
      userId: string,
      cvId: string,
      questionId: string,
      status: 'SKIPPED' | 'DISMISSED',
    ): Promise<QuestionWriteResult> {
      return prisma.$transaction(async (tx) => {
        const cv = await lockCv(tx, userId, cvId);
        const question = cv && (await findQuestion(tx, userId, cvId, questionId));
        if (!question) return { kind: 'not_found' } as const;
        if (isActive(question)) return { kind: 'busy' } as const;
        const allowed =
          status === 'DISMISSED' || question.status === 'OPEN' || question.status === 'SKIPPED';
        if (!allowed) return { kind: 'closed' } as const;

        if (question.status !== status) {
          await tx.cvQuestion.update({ where: { id: questionId }, data: { status } });
        }
        const updated = await findQuestion(tx, userId, cvId, questionId);
        return { kind: 'done', question: updated! } as const;
      });
    },
  };
}

export type QuestionsRepository = ReturnType<typeof createQuestionsRepository>;
