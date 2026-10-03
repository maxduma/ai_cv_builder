import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CvContent, CvContentSchema, type GenerationIssue } from '@cv-builder/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AnswerInput } from '../modules/generation/answers/answer-input';
import { toGenerationInput } from '../modules/generation/generation.service';
import { arrangeOwnedCv, expectEveryRequestRefused } from '../test/isolation';
import { sendJson, startAppWithTwoAccounts } from '../test/start-app';
import { createPrismaClient, type PrismaClient } from './prisma';
import { createRepositories, type Repositories } from './repositories';

/**
 * The Prisma repositories against a real PostgreSQL: the SQL, row locks and constraints the
 * in-memory stand-in (used by every other test) can only imitate. Opt-in: set TEST_DATABASE_URL
 * to a database whose name ends in `_test` (see the README, "Testing"). It is created and
 * migrated if needed, and emptied before every test.
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const API_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const CONTENT: CvContent = CvContentSchema.parse({
  version: 1,
  contact: {
    firstName: 'Alex',
    lastName: 'Morgan',
    headline: 'Backend Engineer',
    email: 'alex@example.com',
    phone: '',
    location: 'Lisbon',
    links: [],
  },
  summary: 'Builds payment APIs in Go.',
  experience: [],
  education: [],
  skills: [{ id: 'skill-1', name: 'Go' }],
});

const issue = (question: string): GenerationIssue => ({
  section: 'skills',
  kind: 'missing',
  target: 'Skills',
  question,
  why: 'Most backend roles ask for it.',
});

const ISSUES = ['Which cloud platforms?', 'Which databases?', 'Which languages?'].map(issue);

/** Answer jobs' input isn't read by the repository; the worker validates it. */
const answerInput = () => ({ stub: true }) as unknown as AnswerInput;

describe.skipIf(!DATABASE_URL)('Prisma repositories on PostgreSQL', () => {
  let prisma: PrismaClient;
  let repositories: Repositories;

  beforeAll(() => {
    const url = new URL(DATABASE_URL!);
    const name = decodeURIComponent(url.pathname.slice(1));
    // Every test empties the tables: never let that touch a database that isn't for tests.
    if (!name.endsWith('_test')) {
      throw new Error(`TEST_DATABASE_URL must name a database ending in _test, not "${name}"`);
    }
    execFileSync(join(API_ROOT, 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
      cwd: API_ROOT,
      env: {
        ...process.env,
        DATABASE_URL,
        CHECKPOINT_DISABLE: '1',
        PRISMA_HIDE_UPDATE_MESSAGE: '1',
      },
      stdio: 'pipe',
    });
    prisma = createPrismaClient(DATABASE_URL!);
    repositories = createRepositories(prisma);
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE users, cvs, source_documents, cv_questions, generation_jobs`;
  });

  async function user(email: string) {
    const created = await repositories.users.create({ email, name: 'Test', passwordHash: 'x' });
    if (created.kind !== 'created') throw new Error('user not created');
    return created.user.id;
  }

  async function draftCv(userId: string) {
    const cv = await repositories.cvs.create(userId, {
      title: 'Backend Engineer',
      targetRole: 'Backend Engineer',
      sourceText: 'Six years building payment APIs in Go and PostgreSQL.',
    });
    return cv.id;
  }

  async function queued(userId: string) {
    const cvId = await draftCv(userId);
    const started = await repositories.generation.startJob(userId, cvId, toGenerationInput);
    if (started.kind !== 'created') throw new Error('job not created');
    return { cvId, jobId: started.job.id };
  }

  /** A CV whose generation completed with `CONTENT` and `issues` (its questions). */
  async function generated(userId: string, issues = ISSUES) {
    const { cvId } = await queued(userId);
    const lease = await repositories.generation.claimNext();
    expect(await repositories.generation.succeed(lease!, CONTENT, issues)).toBe(true);
    const questions = await prisma.cvQuestion.findMany({
      where: { cvId },
      orderBy: { position: 'asc' },
    });
    return { cvId, questionIds: questions.map((question) => question.id) };
  }

  const job = (id: string) => prisma.generationJob.findUniqueOrThrow({ where: { id } });
  const cvRow = (id: string) => prisma.cv.findUniqueOrThrow({ where: { id } });
  /** Makes every PROCESSING job look abandoned, without waiting for its heartbeat to age. */
  const recoverAll = (maxAttempts = 3) =>
    repositories.generation.recoverStale(new Date(Date.now() + 60_000), maxAttempts);

  describe('users', () => {
    it('gives one email one account, even for two sign-ups at once', async () => {
      const account = { email: 'alex@example.com', name: 'Alex', passwordHash: 'x' };

      const results = await Promise.all([
        repositories.users.create(account),
        repositories.users.create(account),
      ]);

      expect(results.map((result) => result.kind).sort()).toEqual(['created', 'email_taken']);
      expect(await prisma.user.count()).toBe(1);
    });
  });

  describe('ownership', () => {
    it('hides a CV from every read and write by another user', async () => {
      const owner = await user('alex@example.com');
      const other = await user('sam@example.com');
      const { cvId, questionIds } = await generated(owner);
      const [questionId] = questionIds as [string];
      const { job: queuedJob } = await prisma.generationJob
        .findFirstOrThrow({ where: { cvId } })
        .then((row) => ({ job: row }));
      await repositories.sourceDocuments.replaceForCv(owner, cvId, {
        originalName: 'cv.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        pageCount: 1,
        storageKey: `${owner}/${cvId}/file.pdf`,
        extractedText: 'Six years building payment APIs.',
      });
      const document = {
        originalName: 'other.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        pageCount: 1,
        storageKey: `${other}/${cvId}/file.pdf`,
        extractedText: 'Hijacked.',
      };

      expect(await repositories.cvs.listForUser(other)).toEqual([]);
      expect(await repositories.cvs.findForUser(other, cvId)).toBeNull();
      expect(await repositories.cvs.existsForUser(other, cvId)).toBe(false);
      expect(await repositories.cvs.update(other, cvId, { targetRole: 'Hijacked' })).toBeNull();
      expect(await repositories.cvs.saveContent(other, cvId, CONTENT, 1, () => [])).toEqual({
        kind: 'not_found',
      });
      expect(await repositories.sourceDocuments.replaceForCv(other, cvId, document)).toBeNull();
      expect(await repositories.sourceDocuments.removeForCv(other, cvId)).toBeNull();
      expect(await repositories.generation.findForUser(other, queuedJob.id)).toBeNull();
      expect(await repositories.generation.startJob(other, cvId, toGenerationInput)).toEqual({
        kind: 'not_found',
      });
      expect(
        await repositories.questions.answer(other, cvId, questionId, 'Hijacked', answerInput),
      ).toEqual({ kind: 'not_found' });
      expect(await repositories.questions.setStatus(other, cvId, questionId, 'DISMISSED')).toEqual({
        kind: 'not_found',
      });

      // The owner's CV is as it was.
      expect(await cvRow(cvId)).toMatchObject({
        targetRole: 'Backend Engineer',
        contentVersion: 1,
      });
      expect(await prisma.sourceDocument.count({ where: { cvId } })).toBe(1);
      expect(await prisma.generationJob.count({ where: { cvId } })).toBe(1);
      expect(
        await prisma.cvQuestion.findUniqueOrThrow({ where: { id: questionId } }),
      ).toMatchObject({ status: 'OPEN', answer: null });
    });

    it('answers 404 to another account and 401 without a session, over HTTP', async () => {
      const app = await startAppWithTwoAccounts({ repositories });
      const cv = await arrangeOwnedCv(app.baseUrl, app.owner, repositories);
      const snapshot = () =>
        Promise.all([
          prisma.cv.findMany({ orderBy: { id: 'asc' } }),
          prisma.generationJob.findMany({ orderBy: { id: 'asc' } }),
          prisma.cvQuestion.findMany({ orderBy: { id: 'asc' } }),
          prisma.sourceDocument.findMany({ orderBy: { id: 'asc' } }),
        ]);
      const before = await snapshot();

      await expectEveryRequestRefused(app.baseUrl, cv, app.other.cookie);
      await expectEveryRequestRefused(app.baseUrl, cv, null);

      expect(await snapshot()).toEqual(before);
    });

    it('stores text with U+0000 removed, instead of failing', async () => {
      const app = await startAppWithTwoAccounts({ repositories });

      const response = await sendJson(
        `${app.baseUrl}/api/cvs`,
        'POST',
        { targetRole: 'Backend\u0000 Engineer', sourceText: 'Six years\u0000 of Go.' },
        { cookie: app.owner.cookie },
      );

      expect(response.status).toBe(201);
      expect(await prisma.cv.findFirstOrThrow()).toMatchObject({
        targetRole: 'Backend Engineer',
        sourceText: 'Six years of Go.',
      });
    });
  });

  describe('saving content', () => {
    it('lets exactly one of two saves over the same version win', async () => {
      const owner = await user('alex@example.com');
      const { cvId } = await generated(owner);
      const edit = (summary: string) =>
        repositories.cvs.saveContent(owner, cvId, { ...CONTENT, summary }, 1, () => []);

      const results = await Promise.all([edit('First tab.'), edit('Second tab.')]);

      const saved = results.find((result) => result.kind === 'saved');
      const conflict = results.find((result) => result.kind === 'conflict');
      expect(saved).toEqual({ kind: 'saved', contentVersion: 2 });
      expect(conflict).toMatchObject({ kind: 'conflict', contentVersion: 2 });
      // The loser gets the winner's content back, to merge into its edits.
      const stored = await cvRow(cvId);
      expect(conflict && 'content' in conflict && conflict.content).toEqual(stored.content);
      expect(stored.contentVersion).toBe(2);
    });
  });

  describe('generation jobs', () => {
    it('queues one generation for two starts at once', async () => {
      const owner = await user('alex@example.com');
      const cvId = await draftCv(owner);

      const results = await Promise.all([
        repositories.generation.startJob(owner, cvId, toGenerationInput),
        repositories.generation.startJob(owner, cvId, toGenerationInput),
      ]);

      const created = results.find((result) => result.kind === 'created');
      expect(results.map((result) => result.kind).sort()).toEqual(['busy', 'created']);
      expect(results.find((result) => result.kind === 'busy')).toEqual({
        kind: 'busy',
        jobId: created && 'job' in created ? created.job.id : undefined,
      });
      expect(await prisma.generationJob.count()).toBe(1);
    });

    it('never hands one job to two workers', async () => {
      const owner = await user('alex@example.com');
      await queued(owner);
      await queued(owner);

      const claims = await Promise.all([1, 2, 3].map(() => repositories.generation.claimNext()));

      const ids = claims.filter((claim) => claim !== null).map((claim) => claim.jobId);
      expect(new Set(ids).size).toBe(2);
      expect(claims.filter((claim) => claim === null)).toHaveLength(1);
      expect(claims.filter((claim) => claim !== null).map((claim) => claim.attempts)).toEqual([
        1, 1,
      ]);
    });

    it('claims answers first, and one answer per CV at a time', async () => {
      const owner = await user('alex@example.com');
      const { cvId, questionIds } = await generated(owner);
      const { jobId: generation } = await queued(owner);
      for (const questionId of questionIds.slice(0, 2)) {
        await repositories.questions.answer(owner, cvId, questionId, 'AWS', answerInput);
      }
      const answers = await prisma.generationJob.findMany({
        where: { kind: 'APPLY_ANSWER' },
        orderBy: { createdAt: 'asc' },
      });

      const first = await repositories.generation.claimNext();
      // The second answer waits while the first runs: the older generation goes next.
      const second = await repositories.generation.claimNext();
      expect(await repositories.generation.claimNext()).toBeNull();

      expect(first).toMatchObject({ kind: 'APPLY_ANSWER', jobId: answers[0]!.id });
      expect(second).toMatchObject({ kind: 'GENERATE', jobId: generation });

      await repositories.generation.completeAnswer(first!, (current) => ({
        kind: 'content',
        content: current,
        applied: [],
      }));
      expect(await repositories.generation.claimNext()).toMatchObject({ jobId: answers[1]!.id });
    });

    it('ignores every write from a run whose job was taken over', async () => {
      const owner = await user('alex@example.com');
      const { cvId, jobId } = await queued(owner);
      const stale = (await repositories.generation.claimNext())!;

      expect(await recoverAll()).toEqual({ requeued: 1, failed: 0 });
      const current = (await repositories.generation.claimNext())!;
      expect(current.attempts).toBe(2);

      expect(await repositories.generation.heartbeat(stale, 2)).toBe(false);
      expect(await repositories.generation.succeed(stale, CONTENT, ISSUES)).toBe(false);
      expect(await repositories.generation.fail(stale, { code: 'X', message: 'x' })).toBe(false);
      expect(await repositories.generation.release(stale)).toBe(false);
      expect(await job(jobId)).toMatchObject({ status: 'PROCESSING', attempts: 2 });
      expect(await cvRow(cvId)).toMatchObject({ content: null, contentVersion: 0 });
      expect(await prisma.cvQuestion.count()).toBe(0);

      expect(await repositories.generation.succeed(current, CONTENT, [])).toBe(true);
      expect(await job(jobId)).toMatchObject({ status: 'COMPLETED', attempts: 2 });
    });

    it('fails a job whose worker kept disappearing, after three attempts', async () => {
      const owner = await user('alex@example.com');
      const { jobId } = await queued(owner);

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        expect(await repositories.generation.claimNext()).toMatchObject({ attempts: attempt });
        expect(await recoverAll()).toEqual(
          attempt < 3 ? { requeued: 1, failed: 0 } : { requeued: 0, failed: 1 },
        );
      }

      expect(await job(jobId)).toMatchObject({ status: 'FAILED', errorCode: 'WORKER_LOST' });
      expect(await repositories.generation.claimNext()).toBeNull();
    });

    it('saves a generation’s CV and questions together, and moves the CV to the top', async () => {
      const owner = await user('alex@example.com');
      const { cvId, jobId } = await queued(owner);
      const later = await draftCv(owner);
      expect((await repositories.cvs.listForUser(owner))[0]?.id).toBe(later);

      const lease = (await repositories.generation.claimNext())!;
      expect(await repositories.generation.succeed(lease, CONTENT, ISSUES)).toBe(true);

      expect(await job(jobId)).toMatchObject({ status: 'COMPLETED', progressStep: 4 });
      expect(await cvRow(cvId)).toMatchObject({ content: CONTENT, contentVersion: 1 });
      const questions = await prisma.cvQuestion.findMany({
        where: { cvId },
        orderBy: { position: 'asc' },
      });
      expect(questions.map((question) => question.question)).toEqual(
        ISSUES.map((item) => item.question),
      );
      expect((await repositories.cvs.listForUser(owner))[0]?.id).toBe(cvId);
    });

    it('writes nothing when one of a generation’s questions can’t be stored', async () => {
      const owner = await user('alex@example.com');
      const { cvId, jobId } = await queued(owner);
      const lease = (await repositories.generation.claimNext())!;

      // The worker filters such questions out (see validIssues); this is why.
      await expect(
        repositories.generation.succeed(lease, CONTENT, [issue('Which one?\u0000')]),
      ).rejects.toThrow();

      expect(await job(jobId)).toMatchObject({ status: 'PROCESSING', result: null });
      expect(await cvRow(cvId)).toMatchObject({ content: null, contentVersion: 0 });
      expect(await prisma.cvQuestion.count()).toBe(0);
    });
  });

  describe('applying answers', () => {
    async function answering() {
      const owner = await user('alex@example.com');
      const { cvId, questionIds } = await generated(owner);
      const answer = async (index: number) => {
        const questionId = questionIds[index]!;
        await repositories.questions.answer(owner, cvId, questionId, 'AWS', answerInput);
        const lease = await repositories.generation.claimNext();
        if (lease?.kind !== 'APPLY_ANSWER') throw new Error('no answer to claim');
        return { questionId, lease };
      };
      const question = (id: string) => prisma.cvQuestion.findUniqueOrThrow({ where: { id } });
      return { cvId, answer, question };
    }

    it('writes the new content as the next version and closes the question', async () => {
      const { cvId, answer, question } = await answering();
      const { questionId, lease } = await answer(0);
      const updated = { ...CONTENT, skills: [...CONTENT.skills, { id: 'skill-2', name: 'AWS' }] };

      const result = await repositories.generation.completeAnswer(lease, () => ({
        kind: 'content',
        content: updated,
        applied: ['skills'],
      }));

      expect(result).toBe('completed');
      expect(await cvRow(cvId)).toMatchObject({ content: updated, contentVersion: 2 });
      expect(await question(questionId)).toMatchObject({ status: 'ANSWERED', followUp: null });
      expect(await job(lease.jobId)).toMatchObject({
        status: 'COMPLETED',
        result: { outcome: 'updated', applied: ['skills'] },
      });
    });

    it('reopens the question with a follow-up, leaving the CV as it is', async () => {
      const { cvId, answer, question } = await answering();
      const { questionId, lease } = await answer(0);

      await repositories.generation.completeAnswer(lease, () => ({
        kind: 'follow_up',
        followUp: 'On which projects?',
      }));

      expect(await question(questionId)).toMatchObject({
        status: 'OPEN',
        followUp: 'On which projects?',
      });
      expect(await cvRow(cvId)).toMatchObject({ content: CONTENT, contentVersion: 1 });
    });

    it('never reopens a question dismissed while its answer ran', async () => {
      const { answer, question } = await answering();
      const { questionId, lease } = await answer(0);
      await prisma.cvQuestion.update({ where: { id: questionId }, data: { status: 'DISMISSED' } });

      await repositories.generation.completeAnswer(lease, () => ({
        kind: 'follow_up',
        followUp: 'On which projects?',
      }));

      expect(await question(questionId)).toMatchObject({ status: 'DISMISSED' });
    });

    it('drops the result of a run whose job was taken over', async () => {
      const { cvId, answer } = await answering();
      const { lease: stale } = await answer(0);
      await recoverAll();
      await repositories.generation.claimNext();

      const result = await repositories.generation.completeAnswer(stale, () => ({
        kind: 'content',
        content: { ...CONTENT, summary: 'Written by the stale run.' },
        applied: ['summary'],
      }));

      expect(result).toBe('lost');
      expect(await cvRow(cvId)).toMatchObject({ content: CONTENT, contentVersion: 1 });
    });
  });
});
