import {
  type ApiErrorBody,
  changedPaths,
  type CvContent,
  CvContentSchema,
  type CvDetail,
  type CvQuestionDto,
  type GenerationIssue,
} from '@cv-builder/shared';
import { describe, expect, it } from 'vitest';
import type { Repositories } from '../../db/repositories';
import { sendJson, startApp, TEST_USER_HEADER, USER_B } from '../../test/start-app';
import type { AnswerResolution } from '../generation/answers/answer-changes';
import { JOB_FAILURES } from '../generation/generation.failures';

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
  summary: 'Builds payment APIs in Go.',
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
  education: [],
  skills: [{ id: 'skill-1', name: 'Go' }],
});

/** One question about the role in `CONTENT`, one about a whole section. */
const ISSUES: GenerationIssue[] = [
  {
    section: 'experience',
    kind: 'incomplete',
    target: 'Experience · Northpay',
    itemId: 'experience-1',
    question: 'How many people were on the team you led at Northpay?',
    why: 'A team size shows the scope of the role.',
  },
  {
    section: 'education',
    kind: 'missing',
    target: 'Education',
    question: 'Do you have a degree or certificate to add?',
    why: 'Your draft has no Education section yet. Most recruiters look for one.',
  },
];

const FOLLOW_UP = 'How many engineers were on the team?';

type App = Awaited<ReturnType<typeof startApp>>;

async function readCv(baseUrl: string, cvId: string) {
  return (await (await fetch(`${baseUrl}/api/cvs/${cvId}`)).json()) as CvDetail;
}

/** Creates a CV and completes its generation with `CONTENT`: a question per issue. */
async function createGeneratedCv({ baseUrl, repositories }: App) {
  const created = await sendJson(`${baseUrl}/api/cvs`, 'POST', {
    targetRole: 'Senior Backend Engineer',
    sourceText: NOTES,
  });
  const { id } = (await created.json()) as CvDetail;
  await fetch(`${baseUrl}/api/cvs/${id}/generations`, { method: 'POST' });
  const job = await repositories.generation.claimNext();
  if (job?.kind !== 'GENERATE') throw new Error('no generation to claim');
  await repositories.generation.succeed(job, CONTENT, ISSUES);
  return readCv(baseUrl, id);
}

/** Claims the queued answer job, as the worker would. */
async function claimAnswer(repositories: Repositories) {
  const job = await repositories.generation.claimNext();
  if (job?.kind !== 'APPLY_ANSWER') throw new Error('no answer job to claim');
  return job;
}

/** Runs the queued answer job to completion, `resolve` standing in for the worker's changes. */
async function applyAnswer(
  repositories: Repositories,
  resolve: (current: CvContent) => AnswerResolution,
) {
  const job = await claimAnswer(repositories);
  const result = await repositories.generation.completeAnswer(job, resolve);
  if (result !== 'completed') throw new Error(`answer job ended as ${result}`);
}

/** An answer that put the team size into the role's bullet. */
function addTeamSize(current: CvContent): AnswerResolution {
  const content = structuredClone(current);
  content.experience[0]!.bullets[0]!.text = 'Led a team of six behind the payments API.';
  return { kind: 'content', content, applied: changedPaths(current, content) };
}

async function errorCode(response: Response) {
  return ((await response.json()) as ApiErrorBody).error.code;
}

/** A generated CV with two open questions: `teamSize` (about its role) and `degree`. */
async function setup() {
  const app = await startApp();
  const cv = await createGeneratedCv(app);
  const [teamSize, degree] = cv.questions as [CvQuestionDto, CvQuestionDto];
  const url = (questionId: string, cvId = cv.id) =>
    `${app.baseUrl}/api/cvs/${cvId}/questions/${questionId}`;
  const answer = (questionId: string, body: unknown, headers: Record<string, string> = {}) =>
    sendJson(`${url(questionId)}/answers`, 'POST', body, headers);
  const setStatus = (questionId: string, body: unknown, headers: Record<string, string> = {}) =>
    sendJson(url(questionId), 'PATCH', body, headers);
  /** The question as the CV's detail shows it now. */
  const read = async (questionId: string) =>
    (await readCv(app.baseUrl, cv.id)).questions.find((question) => question.id === questionId);
  const row = (questionId: string) =>
    app.db.questions.find((question) => question.id === questionId);
  const answerJobs = () => app.db.jobs.filter((job) => job.kind === 'APPLY_ANSWER');
  return { ...app, cv, teamSize, degree, url, answer, setStatus, read, row, answerJobs };
}

describe('POST /api/cvs/:cvId/questions/:questionId/answers', () => {
  it('saves the answer and queues its update of the CV, answering 202', async () => {
    const { answer, teamSize, cv, baseUrl, read, answerJobs } = await setup();

    const response = await answer(teamSize.id, { answer: '  Six engineers.\n' });
    const question = (await response.json()) as CvQuestionDto;

    expect(response.status).toBe(202);
    expect(question).toEqual({
      ...teamSize,
      status: 'answered',
      answer: 'Six engineers.',
      update: { jobId: expect.any(String), status: 'PENDING', outcome: null, errorCode: null },
    });
    expect(response.headers.get('location')).toBe(`/api/generation-jobs/${question.update?.jobId}`);
    expect(await read(teamSize.id)).toEqual(question);
    expect(answerJobs()).toMatchObject([
      { id: question.update?.jobId, cvId: cv.id, questionId: teamSize.id, status: 'PENDING' },
    ]);
    // A snapshot of the question only: the job reads the CV when it starts.
    expect(answerJobs()[0]?.input).toEqual({
      targetRole: 'Senior Backend Engineer',
      question: ISSUES[0],
      answer: 'Six engineers.',
      followUp: null,
      previousAnswer: null,
    });

    // The update's progress is read where the Location points.
    const job = await fetch(`${baseUrl}${response.headers.get('location')}`);
    expect(await job.json()).toMatchObject({ id: question.update?.jobId, status: 'PENDING' });
  });

  it('takes an answer to a skipped question', async () => {
    const { answer, setStatus, degree } = await setup();
    await setStatus(degree.id, { status: 'skipped' });

    const response = await answer(degree.id, { answer: 'BSc Computer Science, TU Berlin.' });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: 'answered' });
  });

  it('sends the AI’s follow-up and the answer before it along with the next answer', async () => {
    const { answer, teamSize, repositories, read, answerJobs } = await setup();
    await answer(teamSize.id, { answer: 'A few.' });
    await applyAnswer(repositories, () => ({ kind: 'follow_up', followUp: FOLLOW_UP }));
    expect(await read(teamSize.id)).toMatchObject({
      status: 'open',
      answer: 'A few.',
      followUp: FOLLOW_UP,
      update: { status: 'COMPLETED', outcome: 'needs_more_info' },
    });

    const response = await answer(teamSize.id, { answer: 'Six engineers.' });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      status: 'answered',
      answer: 'Six engineers.',
      followUp: null,
      update: { status: 'PENDING', outcome: null },
    });
    expect(answerJobs()[1]?.input).toMatchObject({
      answer: 'Six engineers.',
      followUp: FOLLOW_UP,
      previousAnswer: 'A few.',
    });
  });

  it('refuses another answer while the last one is still being applied', async () => {
    const { answer, teamSize, repositories, row, answerJobs } = await setup();
    await answer(teamSize.id, { answer: 'Six engineers.' });

    const pending = await answer(teamSize.id, { answer: 'Seven engineers.' });
    await claimAnswer(repositories);
    const processing = await answer(teamSize.id, { answer: 'Seven engineers.' });

    expect(pending.status).toBe(409);
    expect(await errorCode(pending)).toBe('QUESTION_BUSY');
    expect(processing.status).toBe(409);
    expect(await errorCode(processing)).toBe('QUESTION_BUSY');
    expect(row(teamSize.id)).toMatchObject({ status: 'ANSWERED', answer: 'Six engineers.' });
    expect(answerJobs()).toHaveLength(1);
  });

  it('refuses an answer to a dismissed question', async () => {
    const { answer, setStatus, teamSize, row, answerJobs } = await setup();
    await setStatus(teamSize.id, { status: 'dismissed' });

    const response = await answer(teamSize.id, { answer: 'Six engineers.' });

    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe('QUESTION_CLOSED');
    expect(row(teamSize.id)).toMatchObject({ status: 'DISMISSED', answer: null });
    expect(answerJobs()).toHaveLength(0);
  });

  it('refuses another answer once the last one was applied', async () => {
    const { answer, teamSize, repositories, row, answerJobs } = await setup();
    await answer(teamSize.id, { answer: 'Six engineers.' });
    await applyAnswer(repositories, addTeamSize);

    const response = await answer(teamSize.id, { answer: 'Seven engineers.' });

    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe('QUESTION_CLOSED');
    expect(row(teamSize.id)).toMatchObject({ status: 'ANSWERED', answer: 'Six engineers.' });
    expect(answerJobs()).toHaveLength(1);
  });

  it('refuses an answer about a role the person has removed from the CV', async () => {
    const { answer, teamSize, degree, cv, baseUrl, row, answerJobs } = await setup();
    const saved = await sendJson(`${baseUrl}/api/cvs/${cv.id}/content`, 'PUT', {
      baseVersion: cv.contentVersion,
      content: { ...CONTENT, experience: [] },
    });
    expect(saved.status).toBe(200);

    const response = await answer(teamSize.id, { answer: 'Six engineers.' });
    // A question about a whole section still takes answers.
    const aboutSection = await answer(degree.id, { answer: 'BSc Computer Science, TU Berlin.' });

    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe('QUESTION_CLOSED');
    expect(row(teamSize.id)).toMatchObject({ status: 'OPEN', answer: null });
    expect(aboutSection.status).toBe(202);
    expect(answerJobs()).toMatchObject([{ questionId: degree.id }]);
  });

  it('takes the answer again after its update failed', async () => {
    const { answer, teamSize, repositories, read, answerJobs } = await setup();
    const answered = await answer(teamSize.id, { answer: 'Six engineers.' });
    const first = (await answered.json()) as CvQuestionDto;
    await repositories.generation.fail(await claimAnswer(repositories), JOB_FAILURES.aiTimeout);
    expect(await read(teamSize.id)).toMatchObject({
      status: 'answered',
      update: { jobId: first.update?.jobId, status: 'FAILED', errorCode: 'AI_TIMEOUT' },
    });

    const response = await answer(teamSize.id, { answer: 'Six engineers, two of them juniors.' });
    const retried = (await response.json()) as CvQuestionDto;

    expect(response.status).toBe(202);
    expect(retried).toMatchObject({
      status: 'answered',
      answer: 'Six engineers, two of them juniors.',
      update: { status: 'PENDING', outcome: null, errorCode: null },
    });
    expect(retried.update?.jobId).not.toBe(first.update?.jobId);
    expect(answerJobs()).toHaveLength(2);
  });

  it('keeps the follow-up exchange when a reply to a follow-up is tried again', async () => {
    const { answer, teamSize, repositories, answerJobs } = await setup();
    await answer(teamSize.id, { answer: 'A few.' });
    await applyAnswer(repositories, () => ({ kind: 'follow_up', followUp: FOLLOW_UP }));
    await answer(teamSize.id, { answer: 'Six.' });
    await repositories.generation.fail(await claimAnswer(repositories), JOB_FAILURES.aiTimeout);

    const response = await answer(teamSize.id, { answer: 'Six.' });

    expect(response.status).toBe(202);
    // The question no longer holds the follow-up; the failed update's input did.
    expect(answerJobs()[2]?.input).toMatchObject({
      answer: 'Six.',
      followUp: FOLLOW_UP,
      previousAnswer: 'A few.',
    });
  });

  it.each([
    ['empty', { answer: '' }, 'Write an answer, or skip this question.'],
    ['only spaces', { answer: ' \n\t ' }, 'Write an answer, or skip this question.'],
    ['missing', {}, 'Write an answer, or skip this question.'],
    ['over 1,000 characters', { answer: 'x'.repeat(1_001) }, 'Use at most 1000 characters.'],
    [
      'holding U+0000',
      { answer: 'Six\u0000 engineers.' },
      'Remove the invisible character from this text.',
    ],
  ])('rejects an answer that is %s', async (_case, body, message) => {
    const { answer, teamSize, row, answerJobs } = await setup();

    const response = await answer(teamSize.id, body);
    const { error } = (await response.json()) as ApiErrorBody;

    expect(response.status).toBe(400);
    expect(error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ path: 'answer', message }],
    });
    expect(row(teamSize.id)).toMatchObject({ status: 'OPEN', answer: null });
    expect(answerJobs()).toHaveLength(0);
  });

  it('takes 1,000 characters, counted without the spaces around them', async () => {
    const { answer, teamSize } = await setup();

    const response = await answer(teamSize.id, { answer: ` ${'x'.repeat(1_000)} ` });

    expect(response.status).toBe(202);
    expect(((await response.json()) as CvQuestionDto).answer).toHaveLength(1_000);
  });

  it('rejects keys other than the answer', async () => {
    const { answer, teamSize, answerJobs } = await setup();

    const response = await answer(teamSize.id, { answer: 'Six engineers.', status: 'answered' });

    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('VALIDATION_ERROR');
    expect(answerJobs()).toHaveLength(0);
  });
});

describe('PATCH /api/cvs/:cvId/questions/:questionId', () => {
  it('skips an open question, and skipping it again changes nothing', async () => {
    const { setStatus, teamSize, row } = await setup();

    const first = await setStatus(teamSize.id, { status: 'skipped' });
    const again = await setStatus(teamSize.id, { status: 'skipped' });

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ...teamSize, status: 'skipped' });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ...teamSize, status: 'skipped' });
    expect(row(teamSize.id)?.status).toBe('SKIPPED');
  });

  it('can’t skip a question once it has been answered', async () => {
    const { answer, setStatus, teamSize, repositories, row } = await setup();
    await answer(teamSize.id, { answer: 'Six engineers.' });
    await applyAnswer(repositories, addTeamSize);

    const response = await setStatus(teamSize.id, { status: 'skipped' });

    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe('QUESTION_CLOSED');
    expect(row(teamSize.id)?.status).toBe('ANSWERED');
  });

  it('dismisses a question, answered or not', async () => {
    const { answer, setStatus, teamSize, degree, repositories, row } = await setup();
    await answer(teamSize.id, { answer: 'Six engineers.' });
    await applyAnswer(repositories, addTeamSize);

    const open = await setStatus(degree.id, { status: 'dismissed' });
    const answered = await setStatus(teamSize.id, { status: 'dismissed' });

    expect(open.status).toBe(200);
    expect(await open.json()).toEqual({ ...degree, status: 'dismissed' });
    expect(answered.status).toBe(200);
    expect(await answered.json()).toMatchObject({
      status: 'dismissed',
      answer: 'Six engineers.',
      update: { status: 'COMPLETED', outcome: 'updated' },
    });
    expect([row(degree.id)?.status, row(teamSize.id)?.status]).toEqual(['DISMISSED', 'DISMISSED']);
  });

  it('can’t dismiss a question while its answer is being applied', async () => {
    const { answer, setStatus, teamSize, row } = await setup();
    await answer(teamSize.id, { answer: 'Six engineers.' });

    const response = await setStatus(teamSize.id, { status: 'dismissed' });

    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe('QUESTION_BUSY');
    expect(row(teamSize.id)?.status).toBe('ANSWERED');
  });

  it.each([
    { status: 'open' },
    { status: 'answered' },
    { status: 'skipped', answer: 'Later.' },
    {},
  ])('rejects the change %j', async (body) => {
    const { setStatus, teamSize, row } = await setup();

    const response = await setStatus(teamSize.id, body);

    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('VALIDATION_ERROR');
    expect(row(teamSize.id)?.status).toBe('OPEN');
  });
});

describe('question ids and ownership', () => {
  it('reports another user’s question as not found', async () => {
    const { answer, setStatus, teamSize, row, answerJobs } = await setup();
    const asOther = { [TEST_USER_HEADER]: USER_B };

    const answered = await answer(teamSize.id, { answer: 'Six engineers.' }, asOther);
    const dismissed = await setStatus(teamSize.id, { status: 'dismissed' }, asOther);

    expect(answered.status).toBe(404);
    expect(dismissed.status).toBe(404);
    expect(row(teamSize.id)).toMatchObject({ status: 'OPEN', answer: null });
    expect(answerJobs()).toHaveLength(0);
  });

  it('reports a question as not found under another of the user’s CVs', async () => {
    const app = await setup();
    const other = await createGeneratedCv(app);
    const { url, teamSize, row, answerJobs } = app;

    const answered = await sendJson(`${url(teamSize.id, other.id)}/answers`, 'POST', {
      answer: 'Six engineers.',
    });
    const dismissed = await sendJson(url(teamSize.id, other.id), 'PATCH', { status: 'dismissed' });

    expect(answered.status).toBe(404);
    expect(dismissed.status).toBe(404);
    expect(row(teamSize.id)).toMatchObject({ status: 'OPEN', answer: null });
    expect(answerJobs()).toHaveLength(0);
  });

  it('rejects ids that aren’t UUIDs', async () => {
    const { baseUrl, cv, teamSize, answerJobs } = await setup();
    const urls = [
      `${baseUrl}/api/cvs/not-a-cv/questions/${teamSize.id}`,
      `${baseUrl}/api/cvs/${cv.id}/questions/42`,
    ];

    for (const url of urls) {
      const answered = await sendJson(`${url}/answers`, 'POST', { answer: 'Six engineers.' });
      const skipped = await sendJson(url, 'PATCH', { status: 'skipped' });

      expect(answered.status, url).toBe(400);
      expect(await errorCode(answered)).toBe('VALIDATION_ERROR');
      expect(skipped.status, url).toBe(400);
      expect(await errorCode(skipped)).toBe('VALIDATION_ERROR');
    }
    expect(answerJobs()).toHaveLength(0);
  });
});
