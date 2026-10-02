import { CvIdParamsSchema, type SourceDocumentDto } from '@cv-builder/shared';
import { type RequestHandler, Router } from 'express';
import { requireUser } from '../../http/middleware/current-user';
import { AppError } from '../../lib/errors';
import { receivePdf } from './pdf-upload';
import { toSourceDocumentDto } from './source-documents.mapper';
import type { SourceDocumentsService } from './source-documents.service';

/** HTTP layer for a CV's uploaded PDF, mounted below `/cvs`. */
export function createSourceDocumentsRouter(service: SourceDocumentsService): Router {
  const router = Router();

  // Ownership is checked before the body is read: nobody can make the API buffer an upload for
  // a CV that isn't theirs.
  const requireOwnedCv: RequestHandler = async (req, _res, next) => {
    const user = requireUser(req);
    const { cvId } = CvIdParamsSchema.parse(req.params);
    await service.assertCvExists(user.id, cvId);
    next();
  };

  router.put('/:cvId/source-document', requireOwnedCv, receivePdf, async (req, res) => {
    const user = requireUser(req);
    const { cvId } = CvIdParamsSchema.parse(req.params);
    if (!req.file) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Send a single PDF in the "file" field');
    }

    const document = await service.upload(user.id, cvId, {
      originalName: req.file.originalname,
      bytes: req.file.buffer,
    });
    res.json(toSourceDocumentDto(document) satisfies SourceDocumentDto);
  });

  router.delete('/:cvId/source-document', async (req, res) => {
    const user = requireUser(req);
    const { cvId } = CvIdParamsSchema.parse(req.params);
    await service.remove(user.id, cvId);
    res.status(204).end();
  });

  return router;
}
