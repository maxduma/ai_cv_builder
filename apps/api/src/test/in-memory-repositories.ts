import { randomUUID } from 'node:crypto';
import {
  type AnswerOutcome,
  CvContentSchema,
  GENERATION_STEP_COUNT,
  type GenerationJobStatus,
} from '@cv-builder/shared';
import type { Repositories } from '../db/repositories';
import type { CvDetailRecord, CvSummaryRecord } from '../modules/cvs/cvs.repository';
import { JOB_FAILURES } from '../modules/generation/generation.failures';
import type {
  ClaimedJob,
  GenerationJobRecord,
  JobLease,
  StartJobResult,
} from '../modules/generation/generation.repository';
import type {
  CvQuestionRecord,
  QuestionWriteResult,
} from '../modules/questions/questions.repository';
import type { SourceDocumentRecord } from '../modules/source-documents/source-documents.repository';
import type { UserRecord } from '../modules/users/users.repository';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
}

export interface CvRow {
  id: string;
  userId: string;
  title: string;
  targetRole: string | null;
  sourceText: string | null;
  content: CvDetailRecord['content'];
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
  kind: 'GENERATE' | 'APPLY_ANSWER';
  questionId: string | null;
  status: GenerationJobStatus;
  input: unknown;
  result: unknown;
  issues: GenerationJobRecord['issues'];
  attempts: number;
  progressStep: number;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  heartbeatAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}

export interface QuestionRow {
  id: string;
  cvId: string;
  userId: string;
  position: number;
  section: string;
  kind: string;
  target: string;
  itemId: string | null;
  question: string;
  why: string;
  status: CvQuestionRecord['status'];
  answer: string | null;
  followUp: string | null;
  createdAt: Date;
}

/**
 * The repositories, backed by arrays: behaves like the Prisma implementation (unique emails,
 * scoping by user, one active job per CV, leases) without a database. `db` exposes the rows to
 * assertions.
 */
export function createInMemoryRepositories() {
  const db = {
    users: [] as UserRow[],
    cvs: [] as CvRow[],
    documents: [] as DocumentRow[],
    jobs: [] as JobRow[],
    questions: [] as QuestionRow[],
  };

  // A clock that always moves forward keeps "latest first" ordering deterministic, and follows
  // real time, as the worker's stale-job cutoff is based on `Date.now()`.
  let last = 0;
  const now = () => new Date((last = Math.max(Date.now(), last + 1)));

  const findCv = (userId: string, cvId: string) =>
    db.cvs.find((cv) => cv.id === cvId && cv.userId === userId);
  const latest = <T extends { cvId: string; createdAt: Date }>(rows: T[], cvId: string) =>
    rows
      .filter((row) => row.cvId === cvId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  /** A CV's status comes from its generation jobs only. */
  const generations = () => db.jobs.filter((job) => job.kind === 'GENERATE');
  const isActive = (job: JobRow | undefined) =>
    job?.status === 'PENDING' || job?.status === 'PROCESSING';
  const latestJobOf = (questionId: string) =>
    db.jobs
      .filter((job) => job.questionId === questionId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

  function toUser({ id, email, name }: UserRow): UserRecord {
    return { id, email, name };
  }

  function toSummary(cv: CvRow): CvSummaryRecord {
    const job = latest(generations(), cv.id);
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
    const { id, cvId, status, progressStep, errorCode, errorMessage, issues, createdAt } = job;
    return {
      id,
      cvId,
      status,
      progressStep,
      errorCode,
      errorMessage,
      issues,
      createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    };
  }

  function toQuestion(question: QuestionRow): CvQuestionRecord {
    const job = latestJobOf(question.id);
    const { id, section, kind, target, itemId, why, status, answer, followUp } = question;
    return {
      id,
      section,
      kind,
      target,
      itemId,
      question: question.question,
      why,
      status,
      answer,
      followUp,
      jobs: job
        ? [
            {
              id: job.id,
              status: job.status,
              errorCode: job.errorCode,
              result: job.result as never,
            },
          ]
        : [],
    };
  }

  function toDetail(cv: CvRow): CvDetailRecord {
    const document = latest(db.documents, cv.id);
    const job = latest(generations(), cv.id);
    return {
      ...toSummary(cv),
      sourceText: cv.sourceText,
      content: cv.content,
      contentVersion: cv.contentVersion,
      sourceDocuments: document ? [toDocument(document)] : [],
      generationJobs: job ? [toJob(job)] : [],
      questions: db.questions
        .filter((question) => question.cvId === cv.id)
        .sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime())
        .map(toQuestion),
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
        job.id === lease.jobId && job.status === 'PROCESSING' && job.attempts === lease.attempts,
    );

  const repositories: Repositories = {
    users: {
      async create(user) {
        if (db.users.some((row) => row.email === user.email)) return { kind: 'email_taken' };
        const row: UserRow = { id: randomUUID(), ...user };
        db.users.push(row);
        return { kind: 'created', user: toUser(row) };
      },
      async findCredentialsByEmail(email) {
        const row = db.users.find((user) => user.email === email);
        return row ? { ...toUser(row), passwordHash: row.passwordHash } : null;
      },
      async findById(id) {
        const row = db.users.find((user) => user.id === id);
        return row ? toUser(row) : null;
      },
    },

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
      async findNames(userId, cvId) {
        const cv = findCv(userId, cvId);
        return cv ? { title: cv.title, targetRole: cv.targetRole } : null;
      },
      async removeForUser(userId, cvId) {
        const cv = findCv(userId, cvId);
        if (!cv) return null;
        // What the foreign keys cascade to in the database.
        const storageKeys = takeDocuments(userId, cvId);
        db.jobs = db.jobs.filter((job) => job.cvId !== cvId);
        db.questions = db.questions.filter((question) => question.cvId !== cvId);
        db.cvs = db.cvs.filter((row) => row !== cv);
        return storageKeys;
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
      async saveContent(userId, cvId, content, baseVersion, check) {
        const cv = findCv(userId, cvId);
        if (!cv) return { kind: 'not_found' };
        if (cv.contentVersion === 0) return { kind: 'not_generated' };
        const parsed = CvContentSchema.safeParse(cv.content);
        if (!parsed.success) {
          throw new Error('The stored CV content does not match the schema', {
            cause: parsed.error,
          });
        }
        const stored = parsed.data;
        if (cv.contentVersion !== baseVersion) {
          return { kind: 'conflict', content: stored, contentVersion: cv.contentVersion };
        }
        const issues = check(stored);
        if (issues.length > 0) return { kind: 'invalid', issues };
        Object.assign(cv, { content, contentVersion: baseVersion + 1, updatedAt: now() });
        return { kind: 'saved', contentVersion: cv.contentVersion };
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
        if (cv.contentVersion > 0) return { kind: 'already_generated' };
        const active = generations().find((job) => job.cvId === cvId && isActive(job));
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
          kind: 'GENERATE',
          questionId: null,
          status: 'PENDING',
          input,
          result: null,
          issues: null,
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
            job.status === 'PROCESSING' && (!job.heartbeatAt || job.heartbeatAt < staleBefore);
          if (!stale) continue;
          if (job.attempts >= maxAttempts) {
            Object.assign(job, {
              status: 'FAILED',
              errorCode: JOB_FAILURES.workerLost.code,
              errorMessage: JOB_FAILURES.workerLost.message,
              finishedAt: now(),
            });
            failed += 1;
          } else {
            Object.assign(job, { status: 'PENDING', heartbeatAt: null, progressStep: 0 });
            requeued += 1;
          }
        }
        return { requeued, failed };
      },
      async claimNext(): Promise<ClaimedJob | null> {
        // Answers first, then the oldest; one answer at a time per CV.
        const answering = (cvId: string) =>
          db.jobs.some(
            (job) =>
              job.cvId === cvId && job.kind === 'APPLY_ANSWER' && job.status === 'PROCESSING',
          );
        const job = db.jobs
          .filter(
            (row) =>
              row.status === 'PENDING' && !(row.kind === 'APPLY_ANSWER' && answering(row.cvId)),
          )
          .sort(
            (a, b) =>
              Number(b.kind === 'APPLY_ANSWER') - Number(a.kind === 'APPLY_ANSWER') ||
              a.createdAt.getTime() - b.createdAt.getTime(),
          )[0];
        if (!job) return null;
        const startedAt = now();
        Object.assign(job, {
          status: 'PROCESSING',
          attempts: job.attempts + 1,
          progressStep: 0,
          startedAt,
          heartbeatAt: startedAt,
        });
        const claimed = {
          jobId: job.id,
          attempts: job.attempts,
          cvId: job.cvId,
          userId: job.userId,
          input: job.input,
        };
        if (job.kind === 'GENERATE' || !job.questionId) return { ...claimed, kind: 'GENERATE' };
        const cv = db.cvs.find((row) => row.id === job.cvId);
        return {
          ...claimed,
          kind: 'APPLY_ANSWER',
          questionId: job.questionId,
          base: structuredClone(cv?.content ?? null),
        };
      },
      async heartbeat(lease, step) {
        const job = held(lease);
        if (!job) return false;
        job.heartbeatAt = now();
        if (step !== undefined) job.progressStep = step;
        return true;
      },
      async succeed(lease, content, issues) {
        const job = held(lease);
        if (!job) return false;
        const finishedAt = now();
        Object.assign(job, {
          status: 'COMPLETED',
          result: content,
          issues,
          progressStep: GENERATION_STEP_COUNT,
          heartbeatAt: finishedAt,
          finishedAt,
        });
        const cv = findCv(job.userId, job.cvId);
        if (cv) {
          Object.assign(cv, {
            content,
            contentVersion: cv.contentVersion + 1,
            updatedAt: finishedAt,
          });
        }
        issues.forEach((issue, position) =>
          db.questions.push({
            id: randomUUID(),
            cvId: job.cvId,
            userId: job.userId,
            position,
            section: issue.section,
            kind: issue.kind,
            target: issue.target,
            itemId: issue.itemId ?? null,
            question: issue.question,
            why: issue.why,
            status: 'OPEN',
            answer: null,
            followUp: null,
            createdAt: now(),
          }),
        );
        return true;
      },
      async completeAnswer(lease, resolve) {
        const job = held(lease);
        if (!job?.questionId) return 'lost';
        const cv = db.cvs.find((row) => row.id === job.cvId);
        const current = CvContentSchema.safeParse(cv?.content);
        if (!cv || !current.success) return 'invalid';

        const resolution = resolve(current.data);
        if (resolution.kind === 'invalid') return 'invalid';
        const applied = resolution.kind === 'content' ? resolution.applied : [];
        const outcome: AnswerOutcome =
          resolution.kind === 'follow_up'
            ? 'needs_more_info'
            : applied.length > 0
              ? 'updated'
              : 'no_change';
        const finishedAt = now();
        Object.assign(job, {
          status: 'COMPLETED',
          result: { outcome, applied },
          heartbeatAt: finishedAt,
          finishedAt,
        });
        if (resolution.kind === 'content' && applied.length > 0) {
          Object.assign(cv, {
            content: resolution.content,
            contentVersion: cv.contentVersion + 1,
            updatedAt: finishedAt,
          });
        }
        const question = db.questions.find((row) => row.id === job.questionId);
        if (question && question.status !== 'DISMISSED') {
          Object.assign(
            question,
            resolution.kind === 'follow_up'
              ? { status: 'OPEN', followUp: resolution.followUp }
              : { status: 'ANSWERED', followUp: null },
          );
        }
        return 'completed';
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
          status: 'PENDING',
          attempts: job.attempts - 1,
          progressStep: 0,
          startedAt: null,
          heartbeatAt: null,
        });
        return true;
      },
    },

    questions: {
      async answer(userId, cvId, questionId, answer, buildInput): Promise<QuestionWriteResult> {
        const cv = findCv(userId, cvId);
        const question = db.questions.find(
          (row) => row.id === questionId && row.cvId === cvId && row.userId === userId,
        );
        if (!cv || !question) return { kind: 'not_found' };
        const job = latestJobOf(question.id);
        if (isActive(job)) return { kind: 'busy' };

        const answerable =
          question.status === 'OPEN' ||
          question.status === 'SKIPPED' ||
          (question.status === 'ANSWERED' && job?.status === 'FAILED');
        const content = CvContentSchema.safeParse(cv.content);
        const entries =
          question.section === 'experience'
            ? (content.data?.experience ?? [])
            : question.section === 'education'
              ? (content.data?.education ?? [])
              : [];
        const hasEntry = !question.itemId || entries.some((entry) => entry.id === question.itemId);
        if (!answerable || !content.success || !hasEntry) return { kind: 'closed' };

        const input = buildInput({
          targetRole: cv.targetRole,
          question: toQuestion(question),
          failedInput: job?.status === 'FAILED' ? job.input : null,
        });
        Object.assign(question, { status: 'ANSWERED', answer, followUp: null });
        db.jobs.push({
          id: randomUUID(),
          cvId,
          userId,
          kind: 'APPLY_ANSWER',
          questionId,
          status: 'PENDING',
          input,
          result: null,
          issues: null,
          attempts: 0,
          progressStep: 0,
          errorCode: null,
          errorMessage: null,
          startedAt: null,
          heartbeatAt: null,
          finishedAt: null,
          createdAt: now(),
        });
        return { kind: 'done', question: toQuestion(question) };
      },
      async setStatus(userId, cvId, questionId, status): Promise<QuestionWriteResult> {
        const question = db.questions.find(
          (row) => row.id === questionId && row.cvId === cvId && row.userId === userId,
        );
        if (!findCv(userId, cvId) || !question) return { kind: 'not_found' };
        if (isActive(latestJobOf(question.id))) return { kind: 'busy' };
        const allowed =
          status === 'DISMISSED' || question.status === 'OPEN' || question.status === 'SKIPPED';
        if (!allowed) return { kind: 'closed' };
        question.status = status;
        return { kind: 'done', question: toQuestion(question) };
      },
    },
  };

  return { repositories, db };
}
