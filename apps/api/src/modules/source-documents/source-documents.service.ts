import { randomUUID } from 'node:crypto';
import { SOURCE_PDF_MAX_PAGES, SOURCE_TEXT_MIN_LENGTH } from '@cv-builder/shared';
import {
  type PdfTextExtractor,
  PdfTooManyPagesError,
  PdfUnreadableError,
} from '../../integrations/extraction/pdf-text-extractor';
import type { FileStorage } from '../../integrations/storage/file-storage';
import { AppError, NotFoundError } from '../../lib/errors';
import type { Logger } from '../../lib/logger';
import type { CvsRepository } from '../cvs/cvs.repository';
import type { SourceDocumentsRepository } from './source-documents.repository';

export interface UploadedPdf {
  /** As sent by the client: only ever displayed, never used as a path. */
  originalName: string;
  bytes: Uint8Array;
}

const PDF_SIGNATURE = Buffer.from('%PDF-');
/** PDF readers accept the header anywhere in the first 1024 bytes. */
const SIGNATURE_WINDOW = 1024;

/** True if the bytes look like a PDF, whatever the client claimed the file type was. */
export function hasPdfSignature(bytes: Uint8Array): boolean {
  const head = Buffer.from(
    bytes.buffer,
    bytes.byteOffset,
    Math.min(bytes.byteLength, SIGNATURE_WINDOW),
  );
  return head.includes(PDF_SIGNATURE);
}

/** A file name that is safe to store and show: no path, no control characters, bounded length. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return cleaned.slice(0, 255) || 'CV.pdf';
}

interface Dependencies {
  cvs: CvsRepository;
  documents: SourceDocumentsRepository;
  storage: FileStorage;
  extractor: PdfTextExtractor;
  logger: Logger;
}

/** Source PDFs: validation, text extraction, storage, and the CV's single source-document slot. */
export function createSourceDocumentsService({
  cvs,
  documents,
  storage,
  extractor,
  logger,
}: Dependencies) {
  /** Best effort: a file left behind wastes space but never breaks anything. */
  async function deleteFiles(keys: string[]) {
    const results = await Promise.allSettled(keys.map((key) => storage.delete(key)));
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        logger.warn(
          { err: result.reason, storageKey: keys[index] },
          'Could not delete a stored file',
        );
      }
    });
  }

  async function readText(bytes: Uint8Array) {
    try {
      return await extractor.extract(bytes);
    } catch (error) {
      if (error instanceof PdfTooManyPagesError) {
        throw new AppError(
          422,
          'PDF_TOO_MANY_PAGES',
          `The PDF has ${error.pageCount} pages; the limit is ${SOURCE_PDF_MAX_PAGES}`,
        );
      }
      if (error instanceof PdfUnreadableError) {
        // Usually the user's file; logged in case it's a parser problem on our side.
        logger.info({ reason: error.reason, err: error.cause }, 'Uploaded PDF could not be read');
        throw new AppError(
          422,
          'PDF_UNREADABLE',
          error.reason === 'password'
            ? 'The PDF is password-protected'
            : 'The PDF could not be read',
        );
      }
      throw error;
    }
  }

  return {
    async assertCvExists(userId: string, cvId: string) {
      if (!(await cvs.existsForUser(userId, cvId))) {
        throw new NotFoundError('CV not found');
      }
    },

    /** Validates and stores a PDF as the CV's source document, replacing the previous one. */
    async upload(userId: string, cvId: string, file: UploadedPdf) {
      if (!hasPdfSignature(file.bytes)) {
        throw new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'The file is not a PDF');
      }

      const { pageCount, text } = await readText(file.bytes);
      const extractedText = text.trim();
      if (extractedText.length < SOURCE_TEXT_MIN_LENGTH) {
        throw new AppError(422, 'PDF_NO_TEXT', 'The PDF has no selectable text (it may be a scan)');
      }

      // The key never contains anything the client chose.
      const storageKey = `${userId}/${cvId}/${randomUUID()}.pdf`;
      await storage.put(storageKey, file.bytes);

      let saved;
      try {
        saved = await documents.replaceForCv(userId, cvId, {
          originalName: cleanFileName(file.originalName),
          mimeType: 'application/pdf',
          sizeBytes: file.bytes.byteLength,
          pageCount,
          storageKey,
          extractedText,
        });
      } catch (error) {
        await deleteFiles([storageKey]);
        throw error;
      }
      if (!saved) {
        await deleteFiles([storageKey]);
        throw new NotFoundError('CV not found');
      }

      await deleteFiles(saved.replacedKeys);
      return saved.document;
    },

    async remove(userId: string, cvId: string) {
      const removedKeys = await documents.removeForCv(userId, cvId);
      if (!removedKeys) {
        throw new NotFoundError('CV not found');
      }
      await deleteFiles(removedKeys);
    },
  };
}

export type SourceDocumentsService = ReturnType<typeof createSourceDocumentsService>;
