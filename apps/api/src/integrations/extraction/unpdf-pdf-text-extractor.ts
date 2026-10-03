import { extractText, getDocumentProxy } from 'unpdf';
import {
  type PdfText,
  type PdfTextExtractor,
  PdfTooManyPagesError,
  PdfUnreadableError,
} from './pdf-text-extractor';

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

interface Options {
  /** Checked before any text is extracted. */
  maxPages: number;
  /**
   * pdf.js parses on the event loop (there is no worker). When the deadline passes, the document
   * is destroyed, which stops pdf.js the next time it yields (e.g. between pages or streams). It
   * can't interrupt one long synchronous stretch, so a crafted file can still hold the event loop
   * for a while (see the README).
   */
  timeoutMs: number;
}

/** Extracts text with unpdf, a serverless build of Mozilla's pdf.js. */
export function createUnpdfTextExtractor({ maxPages, timeoutMs }: Options): PdfTextExtractor {
  return {
    async extract(pdfBytes) {
      let document: PdfDocument | undefined;

      const parse = async (): Promise<PdfText> => {
        // pdf.js may take over the buffer it is given, so it gets a copy, and it rejects Node
        // Buffers (which uploads are; `Buffer#slice` would return another Buffer): `new
        // Uint8Array(...)` makes a plain copy. Uploads are untrusted: cap image sizes as unpdf
        // recommends, so one declared image can't allocate gigabytes.
        document = await getDocumentProxy(new Uint8Array(pdfBytes), {
          maxImageSize: 16_777_216,
          verbosity: 0,
        });
        if (document.numPages > maxPages) {
          throw new PdfTooManyPagesError(document.numPages);
        }
        const { text } = await extractText(document, { mergePages: true });
        return { pageCount: document.numPages, text: text.replaceAll('\u0000', '') };
      };

      // Stops pdf.js and frees the document: when parsing ends, or at the deadline.
      const destroy = () => void document?.loadingTask.destroy().catch(() => {});
      const work = parse().finally(destroy);

      try {
        return await withTimeout(work, timeoutMs, destroy);
      } catch (error) {
        if (error instanceof PdfTooManyPagesError || error instanceof PdfUnreadableError) {
          throw error;
        }
        const needsPassword = error instanceof Error && error.name === 'PasswordException';
        throw new PdfUnreadableError(needsPassword ? 'password' : 'invalid', { cause: error });
      }
    },
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new PdfUnreadableError('timeout'));
    }, timeoutMs);
  });
  // A rejection that arrives after the timeout has nobody waiting for it.
  promise.catch(() => {});
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
