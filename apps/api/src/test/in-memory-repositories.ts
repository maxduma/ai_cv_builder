import { randomUUID } from 'node:crypto';
import { GENERATION_STEP_COUNT, type GenerationJobStatus } from '@cv-builder/shared';
import type { Repositories } from '../db/repositories';
import type { CvDetailRecord, CvSummaryRecord } from '../modules/cvs/cvs.repository';
import type {
  GenerationJobRecord,
  JobLease,
  StartJobResult,
} from '../modules/generation/generation.repository';
import type { SourceDocumentRecord } from '../modules/source-documents/source-documents.repository';

export interface CvRow {
  id: string;
  userId: string;
  title: string;
  targetRole: string | null;
  sourceText: string | null;
  content: unknown;
  contentVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentRow {
  id: string;
  cvId: string;
  userId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number | null;
  storageKey: string;
  extractedText: string | null;
  createdAt: Date;
}

export interface JobRow {
  id: string;
  cvId: string;
  userId: string;
  status: GenerationJobStatus;
  input: unknown;
  result: unknown;
  attempts: number;
  progressStep: number;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  heartbeatAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}

/**
 * The repositories, backed by arrays: behaves like the Prisma implementation (scoping by user,
 * one active job per CV, leases) without a database. `db` exposes the rows to assertions.
 */
export function createInMemoryRepositories() {
  const db = { cvs: [] as CvRow[], documents: [] as DocumentRow[], jobs: [] as JobRow[] };

  // A clock that always moves forward keeps "latest first" ordering deterministic.
  let clock = Date.UTC(2026, 0, 1);
  const now = () => new Date((clock += 1_000));

  const findCv = (userId: string, cvId: string) =>
    db.cvs.find((cv) => cv.id === cvId && cv.userId === userId);
  const latest = <T extends { cvId: string; createdAt: Date }>(rows: T[], cvId: string) =>
    rows
      .filter((row) => row.cvId === cvId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

  function toSummary(cv: CvRow): CvSummaryRecord {
    const job = latest(db.jobs, cv.id);
    return {
      id: cv.id,
      title: cv.title,
      targetRole: cv.targetRole,
      createdAt: cv.createdAt,
      updatedAt: cv.updatedAt,
      generationJobs: job ? [{ status: job.status }] : [],
    };
  }

  function toDocument(document: DocumentRow): SourceDocumentRecord {
    const { id, originalName, sizeBytes, pageCount, createdAt } = document;
    return { id, originalName, sizeBytes, pageCount, createdAt };
  }

  function toJob(job: JobRow): GenerationJobRecord {
    const { id, cvId, status, progressStep, errorCode, errorMessage, createdAt } = job;
    return {
      id,
      cvId,
      status,
      progressStep,
      errorCode,
      errorMessage,
      createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    };
  }

  function toDetail(cv: CvRow): CvDetailRecord {
    const document = latest(db.documents, cv.id);
    const job = latest(db.jobs, cv.id);
    return {
      ...toSummary(cv),
      sourceText: cv.sourceText,
      sourceDocuments: document ? [toDocument(document)] : [],
      generationJobs: job ? [toJob(job)] : [],
    };
  }

  function takeDocuments(userId: string, cvId: string) {
    const taken = db.documents.filter((d) => d.cvId === cvId && d.userId === userId);
    db.documents = db.documents.filter((d) => !taken.includes(d));
    return taken.map((d) => d.storageKey);
  }

  const held = (lease: JobLease) =>
    db.jobs.find(
      (job) =>
        job.id === lease.jobId && job.status === 'RUNNING' && job.attempts === lease.attempts,
    );

  const repositories: Repositories = {
    cvs: {
      async listForUser(userId) {
        return db.cvs
          .filter((cv) => cv.userId === userId)
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
          .map(toSummary);
      },
      async findForUser(userId, cvId) {
        const cv = findCv(userId, cvId);
        return cv ? toDetail(cv) : null;
      },
      async existsForUser(userId, cvId) {
        return !!findCv(userId, cvId);
      },
      async create(userId, data) {
        const createdAt = now();
        const cv: CvRow = {
          id: randomUUID(),
          userId,
          ...data,
          content: null,
          contentVersion: 0,
          createdAt,
          updatedAt: createdAt,
        };
        db.cvs.push(cv);
        return toDetail(cv);
      },
      async update(userId, cvId, changes) {
        const cv = findCv(userId, cvId);
        if (!cv) return null;
        if (Object.keys(changes).length > 0) {
          Object.assign(cv, changes, { updatedAt: now() });
        }
        return toDetail(cv);
      },
    },

    sourceDocuments: {
      async replaceForCv(userId, cvId, document) {
        const cv = findCv(userId, cvId);
        if (!cv) return null;
        const replacedKeys = takeDocuments(userId, cvId);
        const row: DocumentRow = { id: randomUUID(), cvId, userId, ...document, createdAt: now() };
        db.documents.push(row);
        cv.updatedAt = now();
        return { document: toDocument(row), replacedKeys };
      },
      async removeForCv(userId, cvId) {
        const cv = findCv(userId, cvId);
        if (!cv) return null;
        const removedKeys = takeDocuments(userId, cvId);
        if (removedKeys.length > 0) cv.updatedAt = now();
        return removedKeys;
      },
    },

    generation: {
      async findForUser(userId, jobId) {
        const job = db.jobs.find((row) => row.id === jobId && row.userId === userId);
        return job ? toJob(job) : null;
      },
      async startJob(userId, cvId, buildInput): Promise<StartJobResult> {
        const cv = findCv(userId, cvId);
        if (!cv) return { kind: 'not_found' };
        const active = db.jobs.find(
          (job) => job.cvId === cvId && (job.status === 'QUEUED' || job.status === 'RUNNING'),
        );
        if (active) return { kind: 'busy', jobId: active.id };

        const document = latest(db.documents, cvId);
        const input = buildInput({
          targetRole: cv.targetRole,
          sourceText: cv.sourceText,
          sourceDocument: document
            ? {
                id: document.id,
                originalName: document.originalName,
                pageCount: document.pageCount,
                extractedText: document.extractedText,
              }
            : null,
        });
        const job: JobRow = {
          id: randomUUID(),
          cvId,
          userId,
          status: 'QUEUED',
          input,
          result: null,
          attempts: 0,
          progressStep: 0,
          errorCode: null,
          errorMessage: null,
          startedAt: null,
          heartbeatAt: null,
          finishedAt: null,
          createdAt: now(),
        };
        db.jobs.push(job);
        return { kind: 'created', job: toJob(job) };
      },
      async recoverStale(staleBefore, maxAttempts) {
        let requeued = 0;
        let failed = 0;
        for (const job of db.jobs) {
          const stale =
            job.status === 'RUNNING' && (!job.heartbeatAt || job.heartbeatAt < staleBefore);
          if (!stale) continue;
          if (job.attempts >= maxAttempts) {
            Object.assign(job, { status: 'FAILED', errorCode: 'WORKER_LOST', finishedAt: now() });
            failed += 1;
          } else {
            Object.assign(job, { status: 'QUEUED', heartbeatAt: null, progressStep: 0 });
            requeued += 1;
          }
        }
        return { requeued, failed };
      },
      async claimNext() {
        const job = db.jobs
          .filter((row) => row.status === 'QUEUED')
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
        if (!job) return null;
        const startedAt = now();
        Object.assign(job, {
          status: 'RUNNING',
          attempts: job.attempts + 1,
          progressStep: 0,
          startedAt,
          heartbeatAt: startedAt,
        });
        return {
          jobId: job.id,
          attempts: job.attempts,
          cvId: job.cvId,
          userId: job.userId,
          input: job.input,
        };
      },
      async heartbeat(lease, step) {
        const job = held(lease);
        if (!job) return false;
        job.heartbeatAt = now();
        if (step !== undefined) job.progressStep = step;
        return true;
      },
      async succeed(lease, content) {
        const job = held(lease);
        if (!job) return false;
        const finishedAt = now();
        Object.assign(job, {
          status: 'SUCCEEDED',
          result: content,
          progressStep: GENERATION_STEP_COUNT,
          finishedAt,
        });
        const cv = findCv(job.userId, job.cvId);
        if (cv) Object.assign(cv, { content, contentVersion: cv.contentVersion + 1 });
        return true;
      },
      async fail(lease, failure) {
        const job = held(lease);
        if (!job) return false;
        Object.assign(job, {
          status: 'FAILED',
          errorCode: failure.code,
          errorMessage: failure.message,
          finishedAt: now(),
        });
        return true;
      },
      async release(lease) {
        const job = held(lease);
        if (!job) return false;
        Object.assign(job, {
          status: 'QUEUED',
          attempts: job.attempts - 1,
          progressStep: 0,
          startedAt: null,
          heartbeatAt: null,
        });
        return true;
      },
    },
  };

  return { repositories, db };
}
