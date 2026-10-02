export interface PdfText {
  pageCount: number;
  /** All pages' text, merged; NUL characters removed (PostgreSQL rejects them). */
  text: string;
}

/** Turns an uploaded PDF into the plain text the AI works from. */
export interface PdfTextExtractor {
  extract(pdf: Uint8Array): Promise<PdfText>;
}

/** The PDF can't be read: it is damaged, needs a password, or took too long to parse. */
export class PdfUnreadableError extends Error {
  override name = 'PdfUnreadableError';

  constructor(
    readonly reason: 'invalid' | 'password' | 'timeout',
    options?: ErrorOptions,
  ) {
    super(`PDF could not be read (${reason})`, options);
  }
}

/** The PDF has more pages than a CV plausibly has. */
export class PdfTooManyPagesError extends Error {
  override name = 'PdfTooManyPagesError';

  constructor(readonly pageCount: number) {
    super(`PDF has ${pageCount} pages`);
  }
}
