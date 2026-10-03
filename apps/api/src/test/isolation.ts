import {
  type CvContent,
  CvContentSchema,
  type CvDetail,
  type CvQuestionDto,
  type GenerationIssue,
  type GenerationJobDto,
} from '@cv-builder/shared';
import { expect } from 'vitest';
import type { Repositories } from '../db/repositories';
import { sendJson } from './start-app';

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

const ISSUES: GenerationIssue[] = [
  {
    section: 'skills',
    kind: 'missing',
    target: 'Skills',
    question: 'Which cloud platforms have you used?',
    why: 'Most backend roles ask for one.',
  },
  {
    section: 'contact',
    kind: 'missing',
    target: 'Contact details',
    question: 'What phone number should your CV show?',
    why: 'Recruiters often call.',
  },
];

/** Everything a CV can have: its PDF, a finished generation, questions and a pending answer. */
export interface OwnedCv {
  cvId: string;
  generationJobId: string;
  answerJobId: string;
  questionId: string;
}

/**
 * Gives `owner` a ready CV with every kind of row the API serves: a source PDF, a completed
 * generation (completed through `repositories`, as no worker runs in tests), its questions, and
 * an answer whose job is still pending.
 */
export async function arrangeOwnedCv(
  baseUrl: string,
  owner: { cookie: string },
  repositories: Repositories,
): Promise<OwnedCv> {
  const as = { cookie: owner.cookie };
  const created = await sendJson(
    `${baseUrl}/api/cvs`,
    'POST',
    { targetRole: 'Backend Engineer', sourceText: 'Six years building payment APIs in Go.' },
    as,
  );
  expect(created.status).toBe(201);
  const { id: cvId } = (await created.json()) as CvDetail;

  const form = new FormData();
  form.append('file', new Blob(['%PDF-1.7 body'], { type: 'application/pdf' }), 'cv.pdf');
  const uploaded = await fetch(`${baseUrl}/api/cvs/${cvId}/source-document`, {
    method: 'PUT',
    body: form,
    headers: as,
  });
  expect(uploaded.status).toBe(200);

  const started = await fetch(`${baseUrl}/api/cvs/${cvId}/generations`, {
    method: 'POST',
    headers: as,
  });
  expect(started.status).toBe(202);
  const { id: generationJobId } = (await started.json()) as GenerationJobDto;
  const lease = await repositories.generation.claimNext();
  if (!lease) throw new Error('No generation to claim');
  expect(await repositories.generation.succeed(lease, CONTENT, ISSUES)).toBe(true);

  const detail = (await (
    await fetch(`${baseUrl}/api/cvs/${cvId}`, { headers: as })
  ).json()) as CvDetail;
  const [answered, open] = detail.questions;
  if (!answered || !open) throw new Error('Expected two questions');
  const answer = await sendJson(
    `${baseUrl}/api/cvs/${cvId}/questions/${answered.id}/answers`,
    'POST',
    { answer: 'AWS and GCP.' },
    as,
  );
  expect(answer.status).toBe(202);
  const { update } = (await answer.json()) as CvQuestionDto;
  if (!update) throw new Error('Expected an answer job');

  return { cvId, generationJobId, answerJobId: update.jobId, questionId: open.id };
}

/** Every request the API takes that names a CV, a job or a question, against `cv`. */
function requestsFor({ cvId, generationJobId, answerJobId, questionId }: OwnedCv) {
  const form = new FormData();
  form.append('file', new Blob(['%PDF-1.7 body'], { type: 'application/pdf' }), 'cv.pdf');
  const json = (body: unknown) => ({
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
  return [
    ['GET', `/api/cvs/${cvId}`, {}],
    ['PATCH', `/api/cvs/${cvId}`, json({ targetRole: 'Hijacked' })],
    ['PATCH', `/api/cvs/${cvId}`, json({ title: 'Hijacked' })],
    ['PUT', `/api/cvs/${cvId}/content`, json({ baseVersion: 1, content: CONTENT })],
    ['PUT', `/api/cvs/${cvId}/source-document`, { body: form }],
    ['DELETE', `/api/cvs/${cvId}/source-document`, {}],
    ['GET', `/api/cvs/${cvId}/pdf`, {}],
    ['POST', `/api/cvs/${cvId}/generations`, {}],
    ['GET', `/api/generation-jobs/${generationJobId}`, {}],
    ['GET', `/api/generation-jobs/${answerJobId}`, {}],
    ['POST', `/api/cvs/${cvId}/questions/${questionId}/answers`, json({ answer: 'Hijacked' })],
    ['PATCH', `/api/cvs/${cvId}/questions/${questionId}`, json({ status: 'dismissed' })],
    ['DELETE', `/api/cvs/${cvId}`, {}],
  ] as const;
}

/**
 * Sends every request that names `cv` as `cookie` (or without a session) and checks each gets
 * `status`: 404 for another account (the CV's existence isn't revealed), 401 without a session.
 * The list of CVs answers another account with an empty list.
 */
export async function expectEveryRequestRefused(
  baseUrl: string,
  cv: OwnedCv,
  cookie: string | null,
) {
  const status = cookie === null ? 401 : 404;
  const auth: Record<string, string> = cookie === null ? {} : { cookie };

  for (const [method, path, init] of requestsFor(cv)) {
    const headers = { ...('headers' in init ? init.headers : {}), ...auth };
    const response = await fetch(`${baseUrl}${path}`, { ...init, method, headers });
    expect(response.status, `${method} ${path}`).toBe(status);
  }

  const list = await fetch(`${baseUrl}/api/cvs`, { headers: auth });
  if (cookie === null) expect(list.status).toBe(401);
  else expect(await list.json()).toEqual({ items: [] });
}
