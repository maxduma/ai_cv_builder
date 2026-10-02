import {
  type ApiErrorBody,
  CvContentSchema,
  type CvDetail,
  type CvListResponse,
} from '@cv-builder/shared';
import { describe, expect, it } from 'vitest';
import {
  sendJson,
  startApp,
  startAppWithTwoAccounts,
  TEST_USER_HEADER,
  USER_A,
  USER_B,
} from '../../test/start-app';

const CONTENT = CvContentSchema.parse({
  version: 1,
  contact: {
    firstName: 'Alex',
    lastName: 'Morgan',
    headline: 'Machine Learning Engineer',
    email: '',
    phone: '',
    location: '',
    links: [],
  },
  summary: 'Builds retrieval pipelines and evaluation tooling.',
  experience: [],
  education: [],
  skills: [{ id: 'skill-1', name: 'Python' }],
});

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
  it('has no content while the CV is a draft', async () => {
    const { baseUrl } = await startApp();
    const cv = await createCv(baseUrl);

    const response = await fetch(`${baseUrl}/api/cvs/${cv.id}`);

    expect(await response.json()).toMatchObject({ status: 'draft', content: null });
  });

  it('includes the generated content once a generation has completed', async () => {
    const { baseUrl, repositories } = await startApp();
    const cv = await createCv(baseUrl, {
      targetRole: 'AI Engineer',
      sourceText: 'Built retrieval pipelines and evaluation tooling for three years.',
    });
    await fetch(`${baseUrl}/api/cvs/${cv.id}/generations`, { method: 'POST' });
    const job = await repositories.generation.claimNext();
    if (!job) throw new Error('no job to claim');
    await repositories.generation.succeed(job, CONTENT, []);

    const detail = await fetch(`${baseUrl}/api/cvs/${cv.id}`);
    const list = (await (await fetch(`${baseUrl}/api/cvs`)).json()) as CvListResponse;

    expect(await detail.json()).toMatchObject({ status: 'ready', content: CONTENT });
    // Lists never carry the content.
    expect(list.items[0]).not.toHaveProperty('content');
  });

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

describe('ownership with session cookies', () => {
  it('answers 404 when another account reads or changes a CV', async () => {
    const { baseUrl, db, owner, other } = await startAppWithTwoAccounts();
    const created = await sendJson(
      `${baseUrl}/api/cvs`,
      'POST',
      { targetRole: 'AI Engineer' },
      { cookie: owner.cookie },
    );
    const cv = (await created.json()) as CvDetail;
    const url = `${baseUrl}/api/cvs/${cv.id}`;

    const mine = await fetch(url, { headers: { cookie: owner.cookie } });
    const read = await fetch(url, { headers: { cookie: other.cookie } });
    const changed = await sendJson(
      url,
      'PATCH',
      { targetRole: 'Hijacked' },
      { cookie: other.cookie },
    );

    expect(mine.status).toBe(200);
    expect(read.status).toBe(404);
    expect(changed.status).toBe(404);
    expect(db.cvs).toMatchObject([{ userId: owner.user.id, targetRole: 'AI Engineer' }]);
  });
});
