import {
  ANSWER_OUTCOMES,
  type CvQuestionDto,
  type CvQuestionStatus,
  GENERATION_ISSUE_KINDS,
  GENERATION_ISSUE_SECTIONS,
} from '@cv-builder/shared';
import { z } from 'zod';
import type { CvQuestionStatus as DbStatus } from '../../generated/prisma/client';
import type { CvQuestionRecord } from './questions.repository';

const STATUS: Record<DbStatus, CvQuestionStatus> = {
  OPEN: 'open',
  SKIPPED: 'skipped',
  ANSWERED: 'answered',
  DISMISSED: 'dismissed',
};

const AnswerResultSchema = z.object({ outcome: z.enum(ANSWER_OUTCOMES) });
const SectionSchema = z.enum(GENERATION_ISSUE_SECTIONS);
const KindSchema = z.enum(GENERATION_ISSUE_KINDS);

export function toCvQuestionDto(question: CvQuestionRecord): CvQuestionDto {
  const job = question.jobs[0];
  return {
    id: question.id,
    // Written from validated issues; an unknown value can only come from a later change of the
    // lists, and reads as the most general one.
    section: SectionSchema.catch('general').parse(question.section),
    kind: KindSchema.catch('missing').parse(question.kind),
    target: question.target,
    itemId: question.itemId,
    question: question.question,
    why: question.why,
    status: STATUS[question.status],
    answer: question.answer,
    followUp: question.followUp,
    update: job
      ? {
          jobId: job.id,
          status: job.status,
          outcome: AnswerResultSchema.safeParse(job.result).data?.outcome ?? null,
          errorCode: job.errorCode,
        }
      : null,
  };
}
