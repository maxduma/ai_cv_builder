import type { CvContent } from '@cv-builder/shared';

export interface RenderedPdf {
  data: Uint8Array;
  pageCount: number;
}

/** Renders a CV's content as an A4 PDF with real, selectable text. */
export interface CvPdfRenderer {
  render(content: CvContent): Promise<RenderedPdf>;
}
