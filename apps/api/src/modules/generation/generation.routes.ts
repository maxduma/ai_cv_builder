import {
  CvIdParamsSchema,
  GenerationJobIdParamsSchema,
  type GenerationJobDto,
} from '@cv-builder/shared';
import { Router } from 'express';
import { requireUser } from '../../http/middleware/current-user';
import { toGenerationJobDto } from './generation.mapper';
import type { GenerationService } from './generation.service';

/** HTTP layer for generations: starting one for a CV, and reading a job's progress. */
export function createGenerationRouter(service: GenerationService): Router {
  const router = Router();

  router.post('/cvs/:cvId/generations', async (req, res) => {
    const user = requireUser(req);
    const { cvId } = CvIdParamsSchema.parse(req.params);
    const job = await service.start(user.id, cvId);
    // Accepted: the job runs in the background and the response doesn't wait for it.
    res
      .status(202)
      .location(`/api/generation-jobs/${job.id}`)
      .json(toGenerationJobDto(job) satisfies GenerationJobDto);
  });

  router.get('/generation-jobs/:jobId', async (req, res) => {
    const user = requireUser(req);
    const { jobId } = GenerationJobIdParamsSchema.parse(req.params);
    const job = await service.get(user.id, jobId);
    res.json(toGenerationJobDto(job) satisfies GenerationJobDto);
  });

  return router;
}
