import {
  AnswerQuestionRequestSchema,
  type CvQuestionDto,
  QuestionParamsSchema,
  UpdateQuestionRequestSchema,
} from '@cv-builder/shared';
import { Router } from 'express';
import { requireUser } from '../../http/middleware/current-user';
import { toCvQuestionDto } from './questions.mapper';
import type { QuestionsService } from './questions.service';

/** HTTP layer for the AI's questions about a CV. The CV's detail lists them. */
export function createQuestionsRouter(service: QuestionsService): Router {
  const router = Router();

  router.post('/cvs/:cvId/questions/:questionId/answers', async (req, res) => {
    const user = requireUser(req);
    const { cvId, questionId } = QuestionParamsSchema.parse(req.params);
    const input = AnswerQuestionRequestSchema.parse(req.body ?? {});
    const question = await service.answer(user.id, cvId, questionId, input);
    const dto = toCvQuestionDto(question);
    // Accepted: the CV is updated in the background; the job reports how it went.
    res
      .status(202)
      .location(`/api/generation-jobs/${dto.update?.jobId}`)
      .json(dto satisfies CvQuestionDto);
  });

  router.patch('/cvs/:cvId/questions/:questionId', async (req, res) => {
    const user = requireUser(req);
    const { cvId, questionId } = QuestionParamsSchema.parse(req.params);
    const input = UpdateQuestionRequestSchema.parse(req.body ?? {});
    const question = await service.setStatus(user.id, cvId, questionId, input);
    res.json(toCvQuestionDto(question) satisfies CvQuestionDto);
  });

  return router;
}
