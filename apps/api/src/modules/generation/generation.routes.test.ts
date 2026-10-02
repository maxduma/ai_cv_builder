import type { ApiErrorBody, CvDetail, GenerationJobDto } from '@cv-builder/shared';
import { describe, expect, it } from 'vitest';
import {
  sendJson,
  startApp,
  startAppWithTwoAccounts,
  TEST_USER_HEADER,
  USER_B,
} from '../../test/start-app';

const NOTES = 'Six years building payment APIs in Go; led a team of four engineers.';

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
    expect(job).toMatchObject({ cvId: cv.id, status: 'QUEUED', step: 0, errorCode: null });
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
    expect(await mine.json()).toMatchObject({ id: job.id, status: 'QUEUED' });
    expect(theirs.status).toBe(404);
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
