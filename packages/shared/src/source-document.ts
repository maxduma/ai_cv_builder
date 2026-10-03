/** Uploaded CVs: PDF only. */
export const SOURCE_PDF_MAX_BYTES = 10 * 1024 * 1024;
/** CVs are short; a longer PDF is almost certainly the wrong file (and slow to parse). */
export const SOURCE_PDF_MAX_PAGES = 20;
/** 20 dense pages of text: bounds what is stored and sent to Claude. */
export const SOURCE_PDF_MAX_TEXT_LENGTH = 100_000;

/** A PDF the user uploaded as source material for a CV. */
export interface SourceDocumentDto {
  id: string;
  originalName: string;
  sizeBytes: number;
  pageCount: number | null;
  createdAt: string;
}
