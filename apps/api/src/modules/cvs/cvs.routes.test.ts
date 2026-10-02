import type { ApiErrorBody, CvDetail, CvListResponse } from '@cv-builder/shared';
import { describe, expect, it } from 'vitest';
import { sendJson, startApp, TEST_USER_HEADER, USER_A, USER_B } from '../../test/start-app';

async function createCv(baseUrl: string, body: unknown = { targetRole: 'AI Engineer' }) {
  const response = await sendJson(`${baseUrl}/api/cvs`, 'POST', body);
  expect(response.status).toBe(201);
  return (await response.json()) as CvDetail;
}

describe('POST /api/cvs', () => {
  it('creates a draft named after the target role', async () => {
    const { baseUrl, db } = await startApp();

    const response = await sendJson(`${baseUrl}/api/cvs`, 'POST', {
      targetRole: '  Senior Backend Engineer ',
      sourceText: 'Built payment APIs in Go for seven years.',
    });
    const cv = (await response.json()) as CvDetail;

    expect(response.status).toBe(201);
    expect(response.headers.get('location')).toBe(`/api/cvs/${cv.id}`);
    expect(cv).toMatchObject({
      title: 'Senior Backend Engineer',
      targetRole: 'Senior Backend Engineer',
      status: 'draft',
      sourceText: 'Built payment APIs in Go for seven years.',
      sourceDocument: null,
      latestGeneration: null,
    });
    expect(db.cvs[0]?.userId).toBe(USER_A);
  });

  it('creates an untitled draft when no role is given yet', async () => {
    const { baseUrl } = await startApp();

    const cv = await createCv(baseUrl, {});

    expect(cv).toMatchObject({ title: 'Untitled CV', targetRole: null, sourceText: null });
  });

  it('never takes the owner from the request body', async () => {
    const { baseUrl, db } = await startApp();

    const response = await sendJson(`${baseUrl}/api/cvs`, 'POST', {
      targetRole: 'AI Engineer',
      userId: USER_B,
    });
    const body = (await response.json()) as ApiErrorBody;

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(db.cvs).toHaveLength(0);
  });
});

describe('GET /api/cvs', () => {
  it("lists only the current user's CVs, newest first", async () => {
    const { baseUrl } = await startApp();
    await createCv(baseUrl, { targetRole: 'First' });
    await createCv(baseUrl, { targetRole: 'Second' });
    await sendJson(
      `${baseUrl}/api/cvs`,
      'POST',
      { targetRole: 'Not mine' },
      {
        [TEST_USER_HEADER]: USER_B,
      },
    );

    const response = await fetch(`${baseUrl}/api/cvs`);
    const body = (await response.json()) as CvListResponse;

    expect(body.items.map((cv) => cv.title)).toEqual(['Second', 'First']);
    expect(body.items.every((cv) => cv.status === 'draft')).toBe(true);
  });
});

describe('GET /api/cvs/:cvId', () => {
  it("reports another user's CV as not found", async () => {
    const { baseUrl } = await startApp();
    const cv = await createCv(baseUrl);

    const response = await fetch(`${baseUrl}/api/cvs/${cv.id}`, {
      headers: { [TEST_USER_HEADER]: USER_B },
    });

    expect(response.status).toBe(404);
  });
});

describe('PATCH /api/cvs/:cvId', () => {
  it('saves the role and the free-text source, renaming the CV after the role', async () => {
    const { baseUrl } = await startApp();
    const cv = await createCv(baseUrl);

    const response = await sendJson(`${baseUrl}/api/cvs/${cv.id}`, 'PATCH', {
      targetRole: 'Data Engineer',
      sourceText: 'Six years with Spark and Airflow.',
    });
    const updated = (await response.json()) as CvDetail;

    expect(response.status).toBe(200);
    expect(updated).toMatchObject({
      title: 'Data Engineer',
      targetRole: 'Data Engineer',
      sourceText: 'Six years with Spark and Airflow.',
    });
  });

  it('clears fields sent as empty or null and leaves absent fields alone', async () => {
    const { baseUrl } = await startApp();
    const cv = await createCv(baseUrl, { targetRole: 'AI Engineer', sourceText: 'Some notes' });

    const cleared = await sendJson(`${baseUrl}/api/cvs/${cv.id}`, 'PATCH', { sourceText: '  ' });
    expect(await cleared.json()).toMatchObject({ targetRole: 'AI Engineer', sourceText: null });

    const untitled = await sendJson(`${baseUrl}/api/cvs/${cv.id}`, 'PATCH', { targetRole: null });
    expect(await untitled.json()).toMatchObject({ title: 'Untitled CV', targetRole: null });
  });

  it('rejects text over the limit', async () => {
    const { baseUrl } = await startApp();
    const cv = await createCv(baseUrl);

    const response = await sendJson(`${baseUrl}/api/cvs/${cv.id}`, 'PATCH', {
      sourceText: 'x'.repeat(5_001),
    });

    expect(response.status).toBe(400);
  });

  it("can't change another user's CV", async () => {
    const { baseUrl, db } = await startApp();
    const cv = await createCv(baseUrl);

    const response = await sendJson(
      `${baseUrl}/api/cvs/${cv.id}`,
      'PATCH',
      { targetRole: 'Hijacked' },
      { [TEST_USER_HEADER]: USER_B },
    );

    expect(response.status).toBe(404);
    expect(db.cvs[0]?.targetRole).toBe('AI Engineer');
  });
});
