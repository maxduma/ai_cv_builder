import { type CvContent, GENERATION_STEP_COUNT, type GenerationIssue } from '@cv-builder/shared';
import type { PrismaClient } from '../../db/prisma';
import type { Prisma } from '../../generated/prisma/client';
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

export interface ClaimedJob extends JobLease {
  cvId: string;
  userId: string;
  /** Unvalidated JSON; the worker parses it with `GenerationInputSchema`. */
  input: unknown;
}

/** Why a job failed (see `JOB_FAILURES`). */
export interface JobFailure {
  code: string;
  /** Shown to the user. */
  message: string;
}

/** Data access for generation jobs: Postgres is the queue (see README, "CV generation"). */
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

        const active = await tx.generationJob.findFirst({
          where: { cvId, userId, status: { in: ['PENDING', 'PROCESSING'] } },
          select: { id: true },
        });
        if (active) return { kind: 'busy', jobId: active.id } as const;

        const cv = await tx.cv.findUniqueOrThrow({
          where: { id_userId: { id: cvId, userId } },
          select: {
            targetRole: true,
            sourceText: true,
            sourceDocuments: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { id: true, originalName: true, pageCount: true, extractedText: true },
            },
          },
        });
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

    /** Claims the oldest pending job. Concurrent workers skip rows another worker has locked. */
    claimNext(): Promise<ClaimedJob | null> {
      return prisma.$transaction(async (tx) => {
        const [next] = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM generation_jobs WHERE status = 'PENDING'
          ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`;
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
          select: { id: true, attempts: true, cvId: true, userId: true, input: true },
        });
        return {
          jobId: job.id,
          attempts: job.attempts,
          cvId: job.cvId,
          userId: job.userId,
          input: job.input,
        };
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
     * Completes the job with its validated result and issues, and saves the result as the CV's
     * content, in one transaction.
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
        return true;
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
