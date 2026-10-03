import {
  type ApiErrorBody,
  type ContentConflictDetails,
  CV_LIMITS,
  type CvContent,
  CvContentSchema,
  type CvDetail,
  type CvListResponse,
  type GenerationIssue,
  SOURCE_TEXT_MAX_LENGTH,
} from '@cv-builder/shared';
import { describe, expect, it } from 'vitest';
import { largestCv } from '../../test/largest-cv';
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

/** `CONTENT` with a role, for questions about one. */
const WITH_ROLE = CvContentSchema.parse({
  ...CONTENT,
  experience: [
    {
      id: 'experience-1',
      title: 'Machine Learning Engineer',
      company: 'Northpay',
      location: 'Berlin',
      start: '2022',
      end: '',
      current: true,
      bullets: [{ id: 'bullet-1', text: 'Built the retrieval pipeline behind support search.' }],
    },
  ],
});

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

async function createCv(baseUrl: string, body: unknown = { targetRole: 'AI Engineer' }) {
  const response = await sendJson(`${baseUrl}/api/cvs`, 'POST', body);
  expect(response.status).toBe(201);
  return (await response.json()) as CvDetail;
}

/** A CV whose generation completed with `content` (its version 1) and `issues`. */
async function createGeneratedCv(
  { baseUrl, repositories }: Awaited<ReturnType<typeof startApp>>,
  content: CvContent = CONTENT,
  issues: GenerationIssue[] = [],
) {
  const cv = await createCv(baseUrl, {
    targetRole: 'AI Engineer',
    sourceText: 'Built retrieval pipelines and evaluation tooling for three years.',
  });
  await fetch(`${baseUrl}/api/cvs/${cv.id}/generations`, { method: 'POST' });
  const job = await repositories.generation.claimNext();
  if (!job) throw new Error('no job to claim');
  await repositories.generation.succeed(job, content, issues);
  return cv;
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

  it.each([
    ['a target role', { targetRole: 'x'.repeat(121) }, 'targetRole'],
    ['notes', { sourceText: 'x'.repeat(SOURCE_TEXT_MAX_LENGTH + 1) }, 'sourceText'],
  ])('rejects %s over the limit, creating nothing', async (_, body, path) => {
    const { baseUrl, db } = await startApp();

    const response = await sendJson(`${baseUrl}/api/cvs`, 'POST', body);
    const { error } = (await response.json()) as ApiErrorBody;

    expect(response.status).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details).toEqual([expect.objectContaining({ path })]);
    expect(db.cvs).toHaveLength(0);
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

  it('includes the content version and the AI’s questions once generated', async () => {
    const app = await startApp();
    const cv = await createGeneratedCv(app, WITH_ROLE, ISSUES);

    const response = await fetch(`${app.baseUrl}/api/cvs/${cv.id}`);
    const detail = (await response.json()) as CvDetail;

    expect(detail).toMatchObject({ status: 'ready', content: WITH_ROLE, contentVersion: 1 });
    // In the order the AI asked them, none answered yet.
    expect(detail.questions).toEqual(
      ISSUES.map((issue) => ({
        id: expect.any(String),
        ...issue,
        itemId: issue.itemId ?? null,
        status: 'open',
        answer: null,
        followUp: null,
        update: null,
      })),
    );
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

  // PostgreSQL text can't hold U+0000 (the in-memory rows can, so the test checks it never arrives).
  it.each([
    ['POST', 'targetRole', 'Backend\u0000 Engineer', 'Backend Engineer'],
    [
      'POST',
      'sourceText',
      'Six years\u0000 with Spark and Airflow.',
      'Six years with Spark and Airflow.',
    ],
    ['PATCH', 'targetRole', 'Backend\u0000 Engineer', 'Backend Engineer'],
    [
      'PATCH',
      'sourceText',
      'Six years\u0000 with Spark and Airflow.',
      'Six years with Spark and Airflow.',
    ],
  ])('%s removes U+0000 from %s', async (method, field, sent, saved) => {
    const { baseUrl, db } = await startApp();
    const response =
      method === 'POST'
        ? await sendJson(`${baseUrl}/api/cvs`, 'POST', { [field]: sent })
        : await sendJson(`${baseUrl}/api/cvs/${(await createCv(baseUrl)).id}`, 'PATCH', {
            [field]: sent,
          });

    expect(response.ok).toBe(true);
    expect(db.cvs[0]).toMatchObject({ [field]: saved });
  });

  it('rejects text over the limit', async () => {
    const { baseUrl } = await startApp();
    const cv = await createCv(baseUrl);

    const response = await sendJson(`${baseUrl}/api/cvs/${cv.id}`, 'PATCH', {
      sourceText: 'x'.repeat(SOURCE_TEXT_MAX_LENGTH + 1),
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

describe('PUT /api/cvs/:cvId/content', () => {
  const EDITED = CvContentSchema.parse({
    ...CONTENT,
    summary: 'Ships retrieval pipelines and the tooling to evaluate them.',
    skills: [...CONTENT.skills, { id: 'skill-2', name: 'PyTorch' }],
  });

  /** A generated CV (version 1), and a way to save content over it. */
  async function setup(content: CvContent = CONTENT) {
    const app = await startApp();
    const cv = await createGeneratedCv(app, content);
    const save = (body: unknown, headers: Record<string, string> = {}) =>
      sendJson(`${app.baseUrl}/api/cvs/${cv.id}/content`, 'PUT', body, headers);
    const read = async () =>
      (await (await fetch(`${app.baseUrl}/api/cvs/${cv.id}`)).json()) as CvDetail;
    return { ...app, cv, save, read };
  }

  it('saves the edited content as the next version', async () => {
    const { save, read } = await setup();

    const response = await save({ baseVersion: 1, content: EDITED });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ contentVersion: 2 });
    expect(await read()).toMatchObject({ status: 'ready', content: EDITED, contentVersion: 2 });
  });

  it('refuses a save over a stale version and returns what the CV holds now', async () => {
    const { save, db } = await setup();
    await save({ baseVersion: 1, content: EDITED });

    // Another tab, still on version 1.
    const response = await save({
      baseVersion: 1,
      content: { ...CONTENT, summary: 'An edit made in another tab.' },
    });
    const body = (await response.json()) as ApiErrorBody;

    expect(response.status).toBe(409);
    expect(body.error).toMatchObject({
      code: 'CONTENT_CONFLICT',
      details: { content: EDITED, contentVersion: 2 } satisfies ContentConflictDetails,
    });
    expect(db.cvs[0]).toMatchObject({ content: EDITED, contentVersion: 2 });
  });

  it('refuses a base version ahead of the stored one', async () => {
    const { save, read } = await setup();

    const response = await save({ baseVersion: 7, content: EDITED });
    const body = (await response.json()) as ApiErrorBody;

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('CONTENT_CONFLICT');
    expect(await read()).toMatchObject({ content: CONTENT, contentVersion: 1 });
  });

  it.each([
    ['a field', 'summary', { ...CONTENT, summary: 'x'.repeat(CV_LIMITS.summary + 1) }],
    [
      'a list',
      'skills',
      {
        ...CONTENT,
        skills: Array.from({ length: CV_LIMITS.skills + 1 }, (_, i) => ({
          id: `s${i}`,
          name: 'Go',
        })),
      },
    ],
    [
      'a list inside an entry',
      'experience.0.bullets',
      {
        ...WITH_ROLE,
        experience: [
          {
            ...WITH_ROLE.experience[0]!,
            bullets: Array.from({ length: CV_LIMITS.bullets + 1 }, (_, i) => ({
              id: `b${i}`,
              text: 'Shipped it.',
            })),
          },
        ],
      },
    ],
  ])('refuses content with %s over its limit', async (_, path, content) => {
    const { save, read } = await setup();

    const response = await save({ baseVersion: 1, content });
    const { error } = (await response.json()) as ApiErrorBody;

    expect(response.status).toBe(400);
    expect(error.details).toEqual([expect.objectContaining({ path: `content.${path}` })]);
    expect((await read()).contentVersion).toBe(1);
  });

  it('saves the largest CV the limits allow, even in 3-byte characters', async () => {
    const { save, read } = await setup();
    // Letters become '中' (3 bytes in UTF-8, as many characters): the JSON is near its 1 MB limit.
    const wide = JSON.parse(
      JSON.stringify(largestCv(CONTENT), (key, value: unknown) =>
        typeof value === 'string' && key !== 'id' ? value.replace(/[a-z]/g, '中') : value,
      ),
    ) as CvContent;
    expect(Buffer.byteLength(JSON.stringify({ baseVersion: 1, content: wide }))).toBeGreaterThan(
      700_000,
    );

    const response = await save({ baseVersion: 1, content: wide });

    expect(response.status).toBe(200);
    expect((await read()).content).toEqual(wide);
  });

  it('answers 500, not 400, when the stored content no longer fits the schema', async () => {
    const { save, db } = await setup();
    // E.g. saved before a limit was lowered: the server's fault, not the request's.
    db.cvs[0]!.content = { ...CONTENT, summary: 'x'.repeat(CV_LIMITS.summary + 1) };

    const response = await save({ baseVersion: 1, content: EDITED });

    expect(response.status).toBe(500);
    expect(((await response.json()) as ApiErrorBody).error.code).toBe('INTERNAL_ERROR');
  });

  it('can’t save content before the CV has been generated', async () => {
    const { baseUrl, db } = await startApp();
    const cv = await createCv(baseUrl);
    const url = `${baseUrl}/api/cvs/${cv.id}/content`;

    const response = await sendJson(url, 'PUT', { baseVersion: 1, content: CONTENT });
    // No saved content has version 0, so that base is invalid input.
    const versionZero = await sendJson(url, 'PUT', { baseVersion: 0, content: CONTENT });

    expect(response.status).toBe(409);
    expect(((await response.json()) as ApiErrorBody).error.code).toBe('CV_NOT_GENERATED');
    expect(versionZero.status).toBe(400);
    expect(((await versionZero.json()) as ApiErrorBody).error.code).toBe('VALIDATION_ERROR');
    expect(db.cvs[0]).toMatchObject({ content: null, contentVersion: 0 });
  });

  it('rejects an edited email that isn’t a full address, naming the field', async () => {
    const { save, db } = await setup();

    const response = await save({
      baseVersion: 1,
      content: { ...CONTENT, contact: { ...CONTENT.contact, email: 'alex@example' } },
    });
    const body = (await response.json()) as ApiErrorBody;

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toEqual([
      {
        path: 'content.contact.email',
        message: 'Enter a full email address, like name@example.com.',
      },
    ]);
    expect(db.cvs[0]).toMatchObject({ content: CONTENT, contentVersion: 1 });
  });

  it('saves other changes while an email stored earlier is still invalid', async () => {
    // The sources gave the address in an odd form; only an edit of it is checked.
    const stored = CvContentSchema.parse({
      ...CONTENT,
      contact: { ...CONTENT.contact, email: 'alex at example dot com' },
    });
    const { save, db } = await setup(stored);

    const response = await save({
      baseVersion: 1,
      content: { ...stored, summary: 'Ships retrieval pipelines.' },
    });

    expect(response.status).toBe(200);
    expect(db.cvs[0]?.content).toMatchObject({
      contact: { email: 'alex at example dot com' },
      summary: 'Ships retrieval pipelines.',
    });
  });

  it.each([
    [
      'text with U+0000 in it',
      { baseVersion: 1, content: { ...CONTENT, summary: 'Builds\u0000 pipelines.' } },
      { path: 'content.summary', message: 'Remove the invisible character from this text.' },
    ],
    [
      'keys other than the content and its version',
      { baseVersion: 1, content: CONTENT, contentVersion: 1 },
      { path: '', message: expect.stringContaining('contentVersion') },
    ],
    [
      'a list with an id used twice',
      {
        baseVersion: 1,
        content: {
          ...CONTENT,
          skills: [
            { id: 'skill-1', name: 'Python' },
            { id: 'skill-1', name: 'SQL' },
          ],
        },
      },
      { path: 'content.skills.1.id', message: 'Duplicate id.' },
    ],
  ])('rejects %s', async (_case, body, issue) => {
    const { save, db } = await setup();

    const response = await save(body);
    const { error } = (await response.json()) as ApiErrorBody;

    expect(response.status).toBe(400);
    expect(error).toMatchObject({ code: 'VALIDATION_ERROR', details: [issue] });
    expect(db.cvs[0]).toMatchObject({ content: CONTENT, contentVersion: 1 });
  });

  it('can’t save another user’s CV', async () => {
    const { save, db } = await setup();

    const response = await save(
      { baseVersion: 1, content: EDITED },
      { [TEST_USER_HEADER]: USER_B },
    );

    expect(response.status).toBe(404);
    expect(db.cvs[0]).toMatchObject({ content: CONTENT, contentVersion: 1 });
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
