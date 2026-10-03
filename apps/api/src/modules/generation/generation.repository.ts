import {
  type AnswerOutcome,
  type CvContent,
  CvContentSchema,
  GENERATION_STEP_COUNT,
  type GenerationIssue,
} from '@cv-builder/shared';
import type { PrismaClient } from '../../db/prisma';
import type { Prisma } from '../../generated/prisma/client';
import type { AnswerResolution } from './answers/answer-changes';
import { JOB_FAILURES } from './generation.failures';
import type { GenerationInput } from './generation.input';

export const generationJobColumns = {
  id: true,
  cvId: true,
  status: true,
  progressStep: true,
  errorCode: true,
  errorMessage: true,
  issues: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
} satisfies Prisma.GenerationJobSelect;

export type GenerationJobRecord = Prisma.GenerationJobGetPayload<{
  select: typeof generationJobColumns;
}>;

/** What decides whether a CV can be generated; read while the CV's row is locked. */
export interface GenerationDraft {
  targetRole: string | null;
  sourceText: string | null;
  sourceDocument: {
    id: string;
    originalName: string;
    pageCount: number | null;
    extractedText: string | null;
  } | null;
}

export type StartJobResult =
  | { kind: 'not_found' }
  /** The CV already has content: generating again would overwrite the person's edits. */
  | { kind: 'already_generated' }
  | { kind: 'busy'; jobId: string }
  | { kind: 'created'; job: GenerationJobRecord };

/**
 * A worker's claim on a PROCESSING job. It holds while the job is PROCESSING with the same attempt
 * count: if the job went stale and was claimed again, every write made with the old lease is
 * ignored.
 */
export interface JobLease {
  jobId: string;
  attempts: number;
}

export type ClaimedJob = JobLease & {
  cvId: string;
  userId: string;
  /** Unvalidated JSON; the worker parses it with the input schema of the job's kind. */
  input: unknown;
} & (
    | { kind: 'GENERATE' }
    | {
        kind: 'APPLY_ANSWER';
        questionId: string;
        /** The CV's content when the job was claimed (unvalidated): what the answer builds on. */
        base: unknown;
      }
  );

/** How `completeAnswer` ended. */
export type CompleteAnswerResult = 'completed' | 'invalid' | 'lost';

/**
 * Serialises claims across workers, so the check that no other answer to the same CV is in
 * progress can't race. Claims take a millisecond; jobs run outside the lock.
 */
const CLAIM_LOCK = 734_501;

/** Why a job failed (see `JOB_FAILURES`). */
export interface JobFailure {
  code: string;
  /** Shown to the user. */
  message: string;
}

/** Data access for generation jobs: Postgres is the queue (see docs/architecture.md, "CV generation as a persistent job"). */
export function createGenerationRepository(prisma: PrismaClient) {
  const held = (lease: JobLease) => ({
    id: lease.jobId,
    status: 'PROCESSING' as const,
    attempts: lease.attempts,
  });

  return {
    findForUser(userId: string, jobId: string): Promise<GenerationJobRecord | null> {
      return prisma.generationJob.findFirst({
        where: { id: jobId, userId },
        select: generationJobColumns,
      });
    },

    /**
     * Queues a generation for the CV unless one is already active. `buildInput` applies the
     * business rules to the CV's current sources and may throw; nothing is written then.
     */
    startJob(
      userId: string,
      cvId: string,
      buildInput: (draft: GenerationDraft) => GenerationInput,
    ): Promise<StartJobResult> {
      return prisma.$transaction(async (tx) => {
        // Locking the CV row serialises concurrent starts (a double click, a second tab).
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM cvs WHERE id = ${cvId}::uuid AND user_id = ${userId}::uuid FOR UPDATE`;
        if (locked.length === 0) return { kind: 'not_found' } as const;

        const cv = await tx.cv.findUniqueOrThrow({
          where: { id_userId: { id: cvId, userId } },
          select: {
            contentVersion: true,
            targetRole: true,
            sourceText: true,
            sourceDocuments: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { id: true, originalName: true, pageCount: true, extractedText: true },
            },
          },
        });
        // Content exists from version 1 on.
        if (cv.contentVersion > 0) return { kind: 'already_generated' } as const;

        const active = await tx.generationJob.findFirst({
          where: { cvId, userId, kind: 'GENERATE', status: { in: ['PENDING', 'PROCESSING'] } },
          select: { id: true },
        });
        if (active) return { kind: 'busy', jobId: active.id } as const;

        const input = buildInput({
          targetRole: cv.targetRole,
          sourceText: cv.sourceText,
          sourceDocument: cv.sourceDocuments[0] ?? null,
        });

        const job = await tx.generationJob.create({
          data: { cvId, userId, input },
          select: generationJobColumns,
        });
        return { kind: 'created', job } as const;
      });
    },

    /**
     * Puts PROCESSING jobs whose worker stopped sending heartbeats back in the queue, or fails them
     * once they have used up their attempts.
     */
    async recoverStale(staleBefore: Date, maxAttempts: number) {
      const stale = {
        status: 'PROCESSING' as const,
        OR: [{ heartbeatAt: { lt: staleBefore } }, { heartbeatAt: null }],
      };
      const failed = await prisma.generationJob.updateMany({
        where: { ...stale, attempts: { gte: maxAttempts } },
        data: {
          status: 'FAILED',
          errorCode: JOB_FAILURES.workerLost.code,
          errorMessage: JOB_FAILURES.workerLost.message,
          finishedAt: new Date(),
        },
      });
      const requeued = await prisma.generationJob.updateMany({
        where: stale,
        data: { status: 'PENDING', heartbeatAt: null, progressStep: 0 },
      });
      return { requeued: requeued.count, failed: failed.count };
    },

    /**
     * Claims the next pending job: answers first (they take seconds, generations a minute), then
     * the oldest. Answers to the same CV run one at a time, each building on the one before, so an
     * answer job waits while another answer to its CV is in progress.
     */
    claimNext(): Promise<ClaimedJob | null> {
      return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CLAIM_LOCK}::bigint)`;
        const [next] = await tx.$queryRaw<{ id: string }[]>`
          SELECT j.id FROM generation_jobs j
          WHERE j.status = 'PENDING'
            AND NOT (j.kind = 'APPLY_ANSWER' AND EXISTS (
              SELECT 1 FROM generation_jobs p
              WHERE p.cv_id = j.cv_id AND p.kind = 'APPLY_ANSWER' AND p.status = 'PROCESSING'))
          ORDER BY (j.kind = 'APPLY_ANSWER') DESC, j.created_at, j.id
          LIMIT 1 FOR UPDATE SKIP LOCKED`;
        if (!next) return null;

        const now = new Date();
        const job = await tx.generationJob.update({
          where: { id: next.id },
          data: {
            status: 'PROCESSING',
            attempts: { increment: 1 },
            progressStep: 0,
            startedAt: now,
            heartbeatAt: now,
          },
          select: {
            id: true,
            attempts: true,
            cvId: true,
            userId: true,
            input: true,
            kind: true,
            questionId: true,
            cv: { select: { content: true } },
          },
        });
        const claimed = {
          jobId: job.id,
          attempts: job.attempts,
          cvId: job.cvId,
          userId: job.userId,
          input: job.input,
        };
        return job.kind === 'APPLY_ANSWER' && job.questionId
          ? { ...claimed, kind: 'APPLY_ANSWER', questionId: job.questionId, base: job.cv.content }
          : { ...claimed, kind: 'GENERATE' };
      });
    },

    /** Refreshes the heartbeat (and the current step). False means the lease is lost. */
    async heartbeat(lease: JobLease, step?: number): Promise<boolean> {
      const { count } = await prisma.generationJob.updateMany({
        where: held(lease),
        data: { heartbeatAt: new Date(), ...(step === undefined ? {} : { progressStep: step }) },
      });
      return count === 1;
    },

    /**
     * Completes a generation with its validated result and issues, in one transaction: the result
     * becomes the CV's content, and the issues its open questions.
     */
    succeed(lease: JobLease, content: CvContent, issues: GenerationIssue[]): Promise<boolean> {
      return prisma.$transaction(async (tx) => {
        const now = new Date();
        const { count } = await tx.generationJob.updateMany({
          where: held(lease),
          data: {
            status: 'COMPLETED',
            result: content,
            issues,
            progressStep: GENERATION_STEP_COUNT,
            heartbeatAt: now,
            finishedAt: now,
          },
        });
        if (count === 0) return false;

        const job = await tx.generationJob.findUniqueOrThrow({
          where: { id: lease.jobId },
          select: { cvId: true, userId: true },
        });
        await tx.cv.update({
          where: { id_userId: { id: job.cvId, userId: job.userId } },
          data: { content, contentVersion: { increment: 1 } },
        });
        await tx.cvQuestion.createMany({
          data: issues.map((issue, position) => ({
            cvId: job.cvId,
            userId: job.userId,
            position,
            section: issue.section,
            kind: issue.kind,
            target: issue.target,
            itemId: issue.itemId ?? null,
            question: issue.question,
            why: issue.why,
          })),
        });
        return true;
      });
    },

    /**
     * Completes an answer job, in one transaction with the CV's row locked: `resolve` sees the CV
     * as it is now and decides what the answer does to it. Its content is written (and its version
     * bumped) only if something changed. The question becomes ANSWERED, or OPEN again with a
     * follow-up, unless the person dismissed it meanwhile.
     *
     * `invalid`: nothing was written and the job is still the caller's to fail. `lost`: another run
     * took the job over.
     */
    async completeAnswer(
      lease: JobLease,
      resolve: (current: CvContent) => AnswerResolution,
    ): Promise<CompleteAnswerResult> {
      return prisma.$transaction(async (tx) => {
        const job = await tx.generationJob.findUnique({
          where: { id: lease.jobId },
          select: { cvId: true, userId: true, questionId: true },
        });
        if (!job?.questionId) return 'lost';

        // The CV's row first, as every other writer of content and questions locks it.
        const [cv] = await tx.$queryRaw<{ content: unknown }[]>`
          SELECT content FROM cvs WHERE id = ${job.cvId}::uuid FOR UPDATE`;
        const current = CvContentSchema.safeParse(cv?.content);
        if (!current.success) return 'invalid';

        const resolution = resolve(current.data);
        if (resolution.kind === 'invalid') return 'invalid';

        const applied = resolution.kind === 'content' ? resolution.applied : [];
        const outcome: AnswerOutcome =
          resolution.kind === 'follow_up'
            ? 'needs_more_info'
            : applied.length > 0
              ? 'updated'
              : 'no_change';
        const now = new Date();
        const { count } = await tx.generationJob.updateMany({
          where: held(lease),
          data: {
            status: 'COMPLETED',
            result: { outcome, applied },
            heartbeatAt: now,
            finishedAt: now,
          },
        });
        if (count === 0) return 'lost';

        if (resolution.kind === 'content' && applied.length > 0) {
          await tx.cv.update({
            where: { id_userId: { id: job.cvId, userId: job.userId } },
            data: { content: resolution.content, contentVersion: { increment: 1 } },
          });
        }
        await tx.cvQuestion.updateMany({
          where: { id: job.questionId, status: { not: 'DISMISSED' } },
          data:
            resolution.kind === 'follow_up'
              ? { status: 'OPEN', followUp: resolution.followUp }
              : { status: 'ANSWERED', followUp: null },
        });
        return 'completed';
      });
    },

    async fail(lease: JobLease, failure: JobFailure): Promise<boolean> {
      const { count } = await prisma.generationJob.updateMany({
        where: held(lease),
        data: {
          status: 'FAILED',
          errorCode: failure.code,
          errorMessage: failure.message,
          finishedAt: new Date(),
        },
      });
      return count === 1;
    },

    /** Hands an interrupted job back to the queue without counting the attempt (shutdown). */
    async release(lease: JobLease): Promise<boolean> {
      const { count } = await prisma.generationJob.updateMany({
        where: held(lease),
        data: {
          status: 'PENDING',
          attempts: { decrement: 1 },
          progressStep: 0,
          startedAt: null,
          heartbeatAt: null,
        },
      });
      return count === 1;
    },
  };
}

export type GenerationRepository = ReturnType<typeof createGenerationRepository>;
