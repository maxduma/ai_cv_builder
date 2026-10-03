import {
  type ApiErrorBody,
  type CvContent,
  CvContentSchema,
  type CvDetail,
  type CvListResponse,
  type GenerationIssue,
  type GenerationJobDto,
} from '@cv-builder/shared';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import type { Repositories } from '../../db/repositories';
import {
  sendJson,
  startApp,
  startAppWithTwoAccounts,
  TEST_USER_HEADER,
  USER_B,
} from '../../test/start-app';
import { JOB_FAILURES } from './generation.failures';
import { createGenerationWorker } from './generation.worker';

const NOTES = 'Six years building payment APIs in Go; led a team of four engineers.';

const CONTENT = CvContentSchema.parse({
  version: 1,
  contact: {
    firstName: 'Alex',
    lastName: 'Morgan',
    headline: 'Backend Engineer',
    email: '',
    phone: '',
    location: '',
    links: [],
  },
  summary: 'Builds payment APIs in Go and leads a team of four engineers.',
  experience: [],
  education: [],
  skills: [],
});

const ISSUES: GenerationIssue[] = [
  {
    section: 'contact',
    kind: 'missing',
    target: 'Contact details',
    question: 'What email address should recruiters use?',
    why: 'Without one, recruiters have no way to reach you.',
  },
];

/** `CONTENT` with a role, and questions about it, a contact detail and a whole section. */
const WITH_ROLE = CvContentSchema.parse({
  ...CONTENT,
  experience: [
    {
      id: 'experience-1',
      title: 'Backend Engineer',
      company: 'Northpay',
      location: 'Berlin',
      start: '2019',
      end: '',
      current: true,
      bullets: [{ id: 'bullet-1', text: 'Led the team behind the payments API.' }],
    },
  ],
});

const QUESTIONS: GenerationIssue[] = [
  {
    section: 'experience',
    kind: 'incomplete',
    target: 'Experience · Northpay',
    itemId: 'experience-1',
    question: 'How many people were on the team you led at Northpay?',
    why: 'A team size shows the scope of the role.',
  },
  ...ISSUES,
  {
    section: 'education',
    kind: 'missing',
    target: 'Education',
    question: 'Do you have a degree or certificate to add?',
    why: 'Your draft has no Education section yet. Most recruiters look for one.',
  },
];

/** Completes the queued generation with `content` and `issues`, as the worker would. */
async function completeGeneration(
  repositories: Repositories,
  content: CvContent = CONTENT,
  issues: GenerationIssue[] = ISSUES,
) {
  const job = await repositories.generation.claimNext();
  if (job?.kind !== 'GENERATE') throw new Error('no generation to claim');
  await repositories.generation.succeed(job, content, issues);
}

async function setup(body: unknown = { targetRole: 'Senior Backend Engineer', sourceText: NOTES }) {
  const app = await startApp();
  const response = await sendJson(`${app.baseUrl}/api/cvs`, 'POST', body);
  const cv = (await response.json()) as CvDetail;
  const start = (headers: Record<string, string> = {}) =>
    fetch(`${app.baseUrl}/api/cvs/${cv.id}/generations`, { method: 'POST', headers });
  return { ...app, cv, start };
}

describe('POST /api/cvs/:cvId/generations', () => {
  it('queues a job with a snapshot of the sources and answers 202', async () => {
    const { start, baseUrl, cv, db } = await setup();

    const response = await start();
    const job = (await response.json()) as GenerationJobDto;

    expect(response.status).toBe(202);
    expect(response.headers.get('location')).toBe(`/api/generation-jobs/${job.id}`);
    expect(job).toMatchObject({
      cvId: cv.id,
      status: 'PENDING',
      step: 0,
      errorCode: null,
      issues: [],
    });
    expect(db.jobs[0]?.input).toEqual({
      targetRole: 'Senior Backend Engineer',
      sourceText: NOTES,
      sourceDocument: null,
    });

    const detail = (await (await fetch(`${baseUrl}/api/cvs/${cv.id}`)).json()) as CvDetail;
    expect(detail.status).toBe('generating');
    expect(detail.latestGeneration?.id).toBe(job.id);
  });

  it('explains what is missing', async () => {
    const { start, db } = await setup({ sourceText: 'Too short' });

    const response = await start();
    const body = (await response.json()) as ApiErrorBody;

    expect(response.status).toBe(422);
    expect(body.error.code).toBe('CV_NOT_READY');
    expect(body.error.details).toEqual([
      { path: 'targetRole', message: 'Add the role you’re applying for.' },
      { path: 'source', message: 'Upload your CV or describe your experience.' },
    ]);
    expect(db.jobs).toHaveLength(0);
  });

  it('accepts an uploaded PDF as the only source', async () => {
    const { start, baseUrl, cv, db } = await setup({ targetRole: 'AI Engineer' });
    const form = new FormData();
    form.append('file', new Blob(['%PDF-1.7 body'], { type: 'application/pdf' }), 'cv.pdf');
    await fetch(`${baseUrl}/api/cvs/${cv.id}/source-document`, { method: 'PUT', body: form });

    const response = await start();

    expect(response.status).toBe(202);
    expect(db.jobs[0]?.input).toMatchObject({
      sourceText: null,
      sourceDocument: { originalName: 'cv.pdf', text: expect.stringContaining('payment APIs') },
    });
  });

  it('refuses a second generation while one is running', async () => {
    const { start } = await setup();
    const first = (await (await start()).json()) as GenerationJobDto;

    const response = await start();
    const body = (await response.json()) as ApiErrorBody;

    expect(response.status).toBe(409);
    expect(body.error).toMatchObject({
      code: 'GENERATION_IN_PROGRESS',
      details: { jobId: first.id },
    });
  });

  it('won’t generate a CV again once it has content', async () => {
    const { start, repositories, db } = await setup();
    await start();
    await completeGeneration(repositories);

    // That would overwrite the person's edits.
    const response = await start();
    const body = (await response.json()) as ApiErrorBody;

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('CV_ALREADY_GENERATED');
    expect(db.jobs).toHaveLength(1);
  });

  it('starts again after a failed generation, from the sources as they are now', async () => {
    const { start, baseUrl, cv, repositories, db } = await setup();
    const detail = async () =>
      (await (await fetch(`${baseUrl}/api/cvs/${cv.id}`)).json()) as CvDetail;
    const listed = async () =>
      ((await (await fetch(`${baseUrl}/api/cvs`)).json()) as CvListResponse).items[0];
    const failed = (await (await start()).json()) as GenerationJobDto;
    const lease = await repositories.generation.claimNext();
    await repositories.generation.fail(lease!, JOB_FAILURES.aiTimeout);

    expect(await listed()).toMatchObject({ status: 'failed' });
    expect(await detail()).toMatchObject({
      status: 'failed',
      latestGeneration: { id: failed.id, status: 'FAILED', errorCode: 'AI_TIMEOUT' },
      content: null,
      contentVersion: 0,
    });

    // "Edit details" saves the sources, then starts again.
    const notes = `${NOTES} Also mentored two juniors.`;
    await sendJson(`${baseUrl}/api/cvs/${cv.id}`, 'PATCH', { sourceText: notes });
    const response = await start();
    const retry = (await response.json()) as GenerationJobDto;

    expect(response.status).toBe(202);
    expect(retry.id).not.toBe(failed.id);
    expect(db.jobs[1]?.input).toMatchObject({ sourceText: notes });
    expect(await detail()).toMatchObject({
      status: 'generating',
      latestGeneration: { id: retry.id },
    });

    await completeGeneration(repositories);

    expect(await detail()).toMatchObject({
      status: 'ready',
      contentVersion: 1,
      questions: [expect.objectContaining({ question: ISSUES[0]!.question })],
    });
  });

  it('keeps a queued generation’s sources when the PDF is replaced or removed', async () => {
    const { start, baseUrl, cv, db } = await setup({ targetRole: 'AI Engineer' });
    const upload = (name: string) => {
      const form = new FormData();
      form.append('file', new Blob(['%PDF-1.7 body'], { type: 'application/pdf' }), name);
      return fetch(`${baseUrl}/api/cvs/${cv.id}/source-document`, { method: 'PUT', body: form });
    };
    await upload('first.pdf');
    await start();
    const snapshot = structuredClone(db.jobs[0]!.input);

    await upload('second.pdf');
    await fetch(`${baseUrl}/api/cvs/${cv.id}/source-document`, { method: 'DELETE' });

    expect(db.documents).toHaveLength(0);
    expect(db.jobs[0]!.input).toEqual(snapshot);
    expect(snapshot).toMatchObject({ sourceDocument: { originalName: 'first.pdf' } });
  });

  it('moves a CV to the top of My CVs once it is generated', async () => {
    const { start, baseUrl, cv, repositories } = await setup();
    await sendJson(`${baseUrl}/api/cvs`, 'POST', { targetRole: 'Data Engineer' });
    await start();

    await completeGeneration(repositories);
    const list = (await (await fetch(`${baseUrl}/api/cvs`)).json()) as CvListResponse;

    expect(list.items.map((item) => item.id)[0]).toBe(cv.id);
  });

  it("can't start a generation for another user's CV", async () => {
    const { start, db } = await setup();

    const response = await start({ [TEST_USER_HEADER]: USER_B });

    expect(response.status).toBe(404);
    expect(db.jobs).toHaveLength(0);
  });
});

describe('GET /api/generation-jobs/:jobId', () => {
  it("returns the job's progress to its owner only", async () => {
    const { start, baseUrl } = await setup();
    const job = (await (await start()).json()) as GenerationJobDto;

    const mine = await fetch(`${baseUrl}/api/generation-jobs/${job.id}`);
    const theirs = await fetch(`${baseUrl}/api/generation-jobs/${job.id}`, {
      headers: { [TEST_USER_HEADER]: USER_B },
    });

    expect(mine.status).toBe(200);
    expect(await mine.json()).toMatchObject({ id: job.id, status: 'PENDING' });
    expect(theirs.status).toBe(404);
  });

  it('includes what the AI found missing once the job has completed', async () => {
    const { start, baseUrl, repositories } = await setup();
    const job = (await (await start()).json()) as GenerationJobDto;
    const worker = createGenerationWorker({
      repository: repositories.generation,
      generator: {
        async generate() {
          return { content: CONTENT, issues: ISSUES };
        },
      },
      answerUpdater: {
        async apply() {
          throw new Error('No answer jobs expected');
        },
      },
      logger: pino({ level: 'silent' }),
    });

    await worker.tick();
    const response = await fetch(`${baseUrl}/api/generation-jobs/${job.id}`);

    expect(await response.json()).toMatchObject({
      id: job.id,
      status: 'COMPLETED',
      step: 4,
      errorCode: null,
      issues: ISSUES,
    });
  });
});

describe('questions from a generation', () => {
  it('turns the issues into open questions, in the order the AI asked them', async () => {
    const { start, baseUrl, cv, repositories, db } = await setup();
    await start();

    await completeGeneration(repositories, WITH_ROLE, QUESTIONS);
    const detail = (await (await fetch(`${baseUrl}/api/cvs/${cv.id}`)).json()) as CvDetail;

    expect(detail.questions).toEqual(
      QUESTIONS.map((issue) => ({
        id: expect.any(String),
        ...issue,
        itemId: issue.itemId ?? null,
        status: 'open',
        answer: null,
        followUp: null,
        update: null,
      })),
    );
    expect(db.questions.map(({ cvId, position }) => ({ cvId, position }))).toEqual(
      [0, 1, 2].map((position) => ({ cvId: cv.id, position })),
    );
  });
});

describe('CV status with answers', () => {
  it('stays ready while an answer is applied, and after that failed', async () => {
    const { start, baseUrl, cv, repositories } = await setup();
    const generation = (await (await start()).json()) as GenerationJobDto;
    await completeGeneration(repositories);
    const detail = (await (await fetch(`${baseUrl}/api/cvs/${cv.id}`)).json()) as CvDetail;
    /** The CV's status in the list and in its detail, and the generation the detail reports. */
    const status = async () => {
      const list = (await (await fetch(`${baseUrl}/api/cvs`)).json()) as CvListResponse;
      const read = (await (await fetch(`${baseUrl}/api/cvs/${cv.id}`)).json()) as CvDetail;
      return {
        list: list.items[0]?.status,
        detail: read.status,
        generation: read.latestGeneration,
      };
    };
    const ready = {
      list: 'ready',
      detail: 'ready',
      generation: expect.objectContaining({ id: generation.id, status: 'COMPLETED' }),
    };

    const answered = await sendJson(
      `${baseUrl}/api/cvs/${cv.id}/questions/${detail.questions[0]?.id}/answers`,
      'POST',
      { answer: 'alex.morgan@example.com' },
    );
    expect(answered.status).toBe(202);
    const pending = await status();
    const job = await repositories.generation.claimNext();
    if (job?.kind !== 'APPLY_ANSWER') throw new Error('no answer job to claim');
    const processing = await status();
    await repositories.generation.fail(job, JOB_FAILURES.aiTimeout);
    const failed = await status();

    expect(pending).toEqual(ready);
    expect(processing).toEqual(ready);
    expect(failed).toEqual(ready);
  });
});

describe('ownership with session cookies', () => {
  async function setupAccounts() {
    const app = await startAppWithTwoAccounts();
    const created = await sendJson(
      `${app.baseUrl}/api/cvs`,
      'POST',
      { targetRole: 'Senior Backend Engineer', sourceText: NOTES },
      { cookie: app.owner.cookie },
    );
    const cv = (await created.json()) as CvDetail;
    const start = (cookie: string) =>
      fetch(`${app.baseUrl}/api/cvs/${cv.id}/generations`, { method: 'POST', headers: { cookie } });
    return { ...app, start };
  }

  it("can't start a generation for another account's CV", async () => {
    const { start, other, db } = await setupAccounts();

    const response = await start(other.cookie);

    expect(response.status).toBe(404);
    expect(db.jobs).toHaveLength(0);
  });

  it("can't read another account's generation", async () => {
    const { start, owner, other, baseUrl } = await setupAccounts();
    const job = (await (await start(owner.cookie)).json()) as GenerationJobDto;

    const mine = await fetch(`${baseUrl}/api/generation-jobs/${job.id}`, {
      headers: { cookie: owner.cookie },
    });
    const theirs = await fetch(`${baseUrl}/api/generation-jobs/${job.id}`, {
      headers: { cookie: other.cookie },
    });

    expect(mine.status).toBe(200);
    expect(theirs.status).toBe(404);
  });
});
