import {
  type ApiErrorBody,
  type CvDetail,
  SOURCE_PDF_MAX_BYTES,
  type SourceDocumentDto,
} from '@cv-builder/shared';
import { describe, expect, it } from 'vitest';
import {
  PdfTooManyPagesError,
  PdfUnreadableError,
} from '../../integrations/extraction/pdf-text-extractor';
import {
  createFakeExtractor,
  sendJson,
  startApp,
  TEST_USER_HEADER,
  USER_B,
} from '../../test/start-app';

const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n% a stand-in PDF body\n%%EOF\n');

function pdfForm(
  bytes: Uint8Array = PDF_BYTES,
  name = 'Alex_Morgan_CV.pdf',
  type = 'application/pdf',
) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), name);
  return form;
}

async function setup(...args: Parameters<typeof startApp>) {
  const app = await startApp(...args);
  const response = await sendJson(`${app.baseUrl}/api/cvs`, 'POST', { targetRole: 'AI Engineer' });
  const cv = (await response.json()) as CvDetail;
  const url = `${app.baseUrl}/api/cvs/${cv.id}/source-document`;
  const upload = (form: FormData, headers: Record<string, string> = {}) =>
    fetch(url, { method: 'PUT', body: form, headers });
  return { ...app, cv, url, upload };
}

async function errorCode(response: Response) {
  return ((await response.json()) as ApiErrorBody).error.code;
}

describe('PUT /api/cvs/:cvId/source-document', () => {
  it('stores a valid PDF with its page count and extracted text', async () => {
    const { upload, db, files, baseUrl, cv } = await setup();

    const response = await upload(pdfForm());
    const document = (await response.json()) as SourceDocumentDto;

    expect(response.status).toBe(200);
    expect(document).toMatchObject({
      originalName: 'Alex_Morgan_CV.pdf',
      sizeBytes: PDF_BYTES.byteLength,
      pageCount: 2,
    });
    const [row] = db.documents;
    expect(row).toMatchObject({
      mimeType: 'application/pdf',
      storageKey: expect.stringMatching(/\.pdf$/),
    });
    expect(row?.storageKey).not.toContain('Alex_Morgan');
    expect(files.has(row?.storageKey ?? '')).toBe(true);

    const detail = (await (await fetch(`${baseUrl}/api/cvs/${cv.id}`)).json()) as CvDetail;
    expect(detail.sourceDocument?.id).toBe(document.id);
  });

  it('replaces the previous PDF and deletes its file', async () => {
    const { upload, db, files } = await setup();
    await upload(pdfForm());
    const firstKey = db.documents[0]?.storageKey ?? '';

    await upload(pdfForm(PDF_BYTES, 'Alex_Morgan_CV_2026.pdf'));

    expect(db.documents).toHaveLength(1);
    expect(db.documents[0]?.originalName).toBe('Alex_Morgan_CV_2026.pdf');
    expect(files.has(firstKey)).toBe(false);
    expect(files.size).toBe(1);
  });

  it('keeps non-ASCII file names intact', async () => {
    const { upload } = await setup();

    const response = await upload(pdfForm(PDF_BYTES, 'Résumé — Олекса.pdf'));

    expect(((await response.json()) as SourceDocumentDto).originalName).toBe('Résumé — Олекса.pdf');
  });

  it('rejects files that are not PDFs', async () => {
    const { upload, files } = await setup();

    const response = await upload(
      pdfForm(new TextEncoder().encode('hello'), 'notes.txt', 'text/plain'),
    );

    expect(response.status).toBe(415);
    expect(await errorCode(response)).toBe('UNSUPPORTED_FILE_TYPE');
    expect(files.size).toBe(0);
  });

  it('checks the content, not just the declared type', async () => {
    const { upload, extractorCalls } = await setup();

    const response = await upload(pdfForm(new TextEncoder().encode('MZ not really a PDF')));

    expect(response.status).toBe(415);
    expect(extractorCalls).toHaveLength(0);
  });

  it('rejects files over 10 MB', async () => {
    const { upload } = await setup();
    const tooBig = new Uint8Array(SOURCE_PDF_MAX_BYTES + 1);
    tooBig.set(PDF_BYTES);

    const response = await upload(pdfForm(tooBig));

    expect(response.status).toBe(413);
    expect(await errorCode(response)).toBe('FILE_TOO_LARGE');
  });

  it('requires a file', async () => {
    const { url } = await setup();

    const response = await fetch(url, { method: 'PUT', body: new FormData() });

    expect(response.status).toBe(400);
  });

  it.each([
    [new PdfUnreadableError('password'), 'PDF_UNREADABLE'],
    [new PdfUnreadableError('invalid'), 'PDF_UNREADABLE'],
    [new PdfTooManyPagesError(42), 'PDF_TOO_MANY_PAGES'],
    [{ pageCount: 1, text: '  ' }, 'PDF_NO_TEXT'],
  ] as const)('reports unusable PDFs (%s)', async (result, code) => {
    const { upload, files } = await setup({
      pdfTextExtractor: createFakeExtractor(result).extractor,
    });

    const response = await upload(pdfForm());

    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe(code);
    expect(files.size).toBe(0);
  });

  it("doesn't read uploads for another user's CV", async () => {
    const { upload, extractorCalls, files } = await setup();

    const response = await upload(pdfForm(), { [TEST_USER_HEADER]: USER_B });

    expect(response.status).toBe(404);
    expect(extractorCalls).toHaveLength(0);
    expect(files.size).toBe(0);
  });
});

describe('DELETE /api/cvs/:cvId/source-document', () => {
  it('removes the PDF and its file', async () => {
    const { upload, url, db, files } = await setup();
    await upload(pdfForm());

    const response = await fetch(url, { method: 'DELETE' });

    expect(response.status).toBe(204);
    expect(db.documents).toHaveLength(0);
    expect(files.size).toBe(0);
  });

  it("can't remove another user's PDF", async () => {
    const { upload, url, db } = await setup();
    await upload(pdfForm());

    const response = await fetch(url, {
      method: 'DELETE',
      headers: { [TEST_USER_HEADER]: USER_B },
    });

    expect(response.status).toBe(404);
    expect(db.documents).toHaveLength(1);
  });
});
