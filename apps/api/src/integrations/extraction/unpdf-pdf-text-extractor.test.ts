import { describe, expect, it } from 'vitest';
import { PdfTooManyPagesError, PdfUnreadableError } from './pdf-text-extractor';
import { createUnpdfTextExtractor } from './unpdf-pdf-text-extractor';

/** Builds a minimal, valid PDF with one line of Helvetica text per page. */
function makePdf(pages: string[]): Uint8Array {
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((text, index) => {
    const pageId = 4 + index * 2;
    const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets.push(pdf.length);
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

const extractor = createUnpdfTextExtractor({ maxPages: 2, timeoutMs: 5_000 });

describe('unpdf text extractor', () => {
  it('returns the text and the page count', async () => {
    const result = await extractor.extract(
      makePdf(['Senior Backend Engineer', 'Skills: Go, PostgreSQL']),
    );

    expect(result.pageCount).toBe(2);
    expect(result.text).toContain('Senior Backend Engineer');
    expect(result.text).toContain('Skills: Go, PostgreSQL');
  });

  it('reads Node Buffers, as uploads arrive', async () => {
    const result = await extractor.extract(Buffer.from(makePdf(['From a multer upload'])));

    expect(result.text).toContain('From a multer upload');
  });

  it('leaves the caller’s bytes intact', async () => {
    const bytes = makePdf(['Hello']);
    const copy = bytes.slice();

    await extractor.extract(bytes);

    expect(bytes).toEqual(copy);
  });

  it('rejects PDFs with too many pages before reading them', async () => {
    await expect(extractor.extract(makePdf(['One', 'Two', 'Three']))).rejects.toBeInstanceOf(
      PdfTooManyPagesError,
    );
  });

  it('reports damaged files as unreadable', async () => {
    const result = extractor.extract(new TextEncoder().encode('%PDF-1.4 not really'));

    await expect(result).rejects.toBeInstanceOf(PdfUnreadableError);
    await expect(result).rejects.toMatchObject({ reason: 'invalid' });
  });
});
