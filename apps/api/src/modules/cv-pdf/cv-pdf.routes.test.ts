import {
  type ApiErrorBody,
  type CvContent,
  CvContentSchema,
  type CvDetail,
} from '@cv-builder/shared';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { createReactPdfCvRenderer } from '../../integrations/pdf/react-pdf-cv-renderer';
import {
  createFakePdfRenderer,
  SAMPLE_RENDERED_PDF,
  sendJson,
  startApp,
  TEST_USER_HEADER,
  USER_B,
} from '../../test/start-app';

const CONTENT = CvContentSchema.parse({
  version: 1,
  contact: {
    firstName: 'Alex',
    lastName: 'Morgan',
    headline: 'Machine Learning Engineer',
    email: 'alex@example.com',
    phone: '',
    location: '',
    links: [],
  },
  summary: 'Builds retrieval pipelines and evaluation tooling.',
  experience: [],
  education: [],
  skills: [{ id: 'skill-1', name: 'Python' }],
});

type App = Awaited<ReturnType<typeof startApp>>;

async function createCv(baseUrl: string) {
  const response = await sendJson(`${baseUrl}/api/cvs`, 'POST', {
    targetRole: 'AI Engineer',
    sourceText: 'Built retrieval pipelines and evaluation tooling for three years.',
  });
  expect(response.status).toBe(201);
  return (await response.json()) as CvDetail;
}

/** A CV whose generation completed with `content` (its version 1). */
async function createGeneratedCv({ baseUrl, repositories }: App, content: CvContent = CONTENT) {
  const cv = await createCv(baseUrl);
  await fetch(`${baseUrl}/api/cvs/${cv.id}/generations`, { method: 'POST' });
  const job = await repositories.generation.claimNext();
  if (!job) throw new Error('no job to claim');
  await repositories.generation.succeed(job, content, []);
  return cv;
}

async function errorOf(response: Response) {
  return ((await response.json()) as ApiErrorBody).error;
}

describe('GET /api/cvs/:cvId/pdf', () => {
  it('downloads the CV as a PDF', async () => {
    const app = await startApp({ cvPdfRenderer: createReactPdfCvRenderer() });
    const cv = await createGeneratedCv(app);

    const response = await fetch(`${app.baseUrl}/api/cvs/${cv.id}/pdf`);
    const body = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="CV.pdf"');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-page-count')).toBe('1');
    expect(response.headers.get('content-length')).toBe(String(body.byteLength));
    expect(new TextDecoder().decode(body.slice(0, 5))).toBe('%PDF-');
  });

  it('renders the content as it is saved now', async () => {
    const app = await startApp();
    const cv = await createGeneratedCv(app);
    const edited = { ...CONTENT, summary: 'Edited by hand just before downloading.' };
    const saved = await sendJson(`${app.baseUrl}/api/cvs/${cv.id}/content`, 'PUT', {
      baseVersion: 1,
      content: edited,
    });
    expect(saved.status).toBe(200);

    const response = await fetch(`${app.baseUrl}/api/cvs/${cv.id}/pdf`);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-page-count')).toBe(String(SAMPLE_RENDERED_PDF.pageCount));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(SAMPLE_RENDERED_PDF.data);
    expect(app.pdfRenderCalls).toEqual([edited]);
  });

  it('refuses a CV that has no content yet', async () => {
    const app = await startApp();
    const cv = await createCv(app.baseUrl);

    const response = await fetch(`${app.baseUrl}/api/cvs/${cv.id}/pdf`);

    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe('CV_NOT_GENERATED');
    expect(app.pdfRenderCalls).toEqual([]);
  });

  it("reports another user's CV, or an unknown one, as not found", async () => {
    const app = await startApp();
    const cv = await createGeneratedCv(app);

    const foreign = await fetch(`${app.baseUrl}/api/cvs/${cv.id}/pdf`, {
      headers: { [TEST_USER_HEADER]: USER_B },
    });
    const unknown = await fetch(`${app.baseUrl}/api/cvs/0199a000-0000-7000-8000-0000000000ff/pdf`);
    const malformed = await fetch(`${app.baseUrl}/api/cvs/not-a-uuid/pdf`);

    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(malformed.status).toBe(400);
    expect(app.pdfRenderCalls).toEqual([]);
  });

  it('needs a session', async () => {
    const { baseUrl } = await startApp({ sessions: 'real' });

    const response = await fetch(`${baseUrl}/api/cvs/0199a000-0000-7000-8000-0000000000ff/pdf`);

    expect(response.status).toBe(401);
  });

  it('answers a failed render with a JSON error and logs its cause', async () => {
    const lines: string[] = [];
    const logger = pino({ level: 'error' }, { write: (line: string) => lines.push(line) });
    const { renderer } = createFakePdfRenderer(new Error('font table is corrupt'));
    const app = await startApp({ cvPdfRenderer: renderer, logger });
    const cv = await createGeneratedCv(app);

    const response = await fetch(`${app.baseUrl}/api/cvs/${cv.id}/pdf`);
    const error = await errorOf(response);

    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    expect(error.code).toBe('PDF_RENDER_FAILED');
    expect(error.message).not.toContain('font table');
    await vi.waitFor(() => expect(lines.join('\n')).toContain('caused by'));
    expect(lines.join('\n')).toContain('font table is corrupt');
  });
});
