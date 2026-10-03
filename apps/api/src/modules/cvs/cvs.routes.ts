import {
  CreateCvRequestSchema,
  CvIdParamsSchema,
  SaveCvContentRequestSchema,
  type SaveCvContentResponse,
  UpdateCvRequestSchema,
  type CvDetail,
  type CvListResponse,
} from '@cv-builder/shared';
import { Router } from 'express';
import { requireUser } from '../../http/middleware/current-user';
import { toCvDetail, toCvSummary } from './cvs.mapper';
import type { CvsService } from './cvs.service';

/** HTTP layer for CVs: validates input, calls the service, maps results to DTOs. */
export function createCvsRouter(cvsService: CvsService): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const user = requireUser(req);
    const cvs = await cvsService.list(user.id);
    res.json({ items: cvs.map(toCvSummary) } satisfies CvListResponse);
  });

  router.post('/', async (req, res) => {
    const user = requireUser(req);
    const input = CreateCvRequestSchema.parse(req.body ?? {});
    const cv = await cvsService.create(user.id, input);
    res
      .status(201)
      .location(`/api/cvs/${cv.id}`)
      .json(toCvDetail(cv) satisfies CvDetail);
  });

  router.get('/:cvId', async (req, res) => {
    const user = requireUser(req);
    const { cvId } = CvIdParamsSchema.parse(req.params);
    const cv = await cvsService.get(user.id, cvId);
    res.json(toCvDetail(cv) satisfies CvDetail);
  });

  // Renames the CV, and stores the target role and the free-text source ("describe your experience").
  router.patch('/:cvId', async (req, res) => {
    const user = requireUser(req);
    const { cvId } = CvIdParamsSchema.parse(req.params);
    const input = UpdateCvRequestSchema.parse(req.body ?? {});
    const cv = await cvsService.update(user.id, cvId, input);
    res.json(toCvDetail(cv) satisfies CvDetail);
  });

  // Deletes the CV with its generations, questions and uploaded PDF.
  router.delete('/:cvId', async (req, res) => {
    const user = requireUser(req);
    const { cvId } = CvIdParamsSchema.parse(req.params);
    await cvsService.remove(user.id, cvId);
    res.status(204).end();
  });

  // The editor's autosave: the whole document, over the version it was edited from.
  router.put('/:cvId/content', async (req, res) => {
    const user = requireUser(req);
    const { cvId } = CvIdParamsSchema.parse(req.params);
    const { content, baseVersion } = SaveCvContentRequestSchema.parse(req.body ?? {});
    const contentVersion = await cvsService.saveContent(user.id, cvId, content, baseVersion);
    res.json({ contentVersion } satisfies SaveCvContentResponse);
  });

  return router;
}
