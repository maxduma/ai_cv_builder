import { SOURCE_PDF_MAX_BYTES } from '@cv-builder/shared';
import type { RequestHandler } from 'express';
import multer from 'multer';
import { AppError } from '../../lib/errors';

const MAX_MEGABYTES = SOURCE_PDF_MAX_BYTES / (1024 * 1024);

const upload = multer({
  storage: multer.memoryStorage(),
  // Busboy decodes file names as latin1 by default, which garbles names like "Résumé.pdf".
  defParamCharset: 'utf8',
  limits: { fileSize: SOURCE_PDF_MAX_BYTES, files: 1, fields: 0, parts: 1 },
  fileFilter: (_req, file, accept) => {
    // The declared type is only a first filter; the service checks the bytes themselves.
    if (file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname)) {
      accept(null, true);
    } else {
      accept(new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'The file is not a PDF'));
    }
  },
}).single('file');

/**
 * Reads one PDF from the multipart field `file` into memory (`req.file`). Upload problems become
 * `AppError`s, so the global error handler needs no knowledge of multer.
 */
export const receivePdf: RequestHandler = (req, res, next) => {
  upload(req, res, (error: unknown) => {
    next(error === undefined ? undefined : toUploadError(error));
  });
};

function toUploadError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return new AppError(413, 'FILE_TOO_LARGE', `The file is larger than ${MAX_MEGABYTES} MB`);
    }
    return new AppError(400, 'VALIDATION_ERROR', 'Send a single PDF in the "file" field', {
      reason: error.code,
    });
  }
  // Busboy reports malformed multipart bodies as plain errors.
  return new AppError(400, 'VALIDATION_ERROR', 'The upload could not be read');
}
