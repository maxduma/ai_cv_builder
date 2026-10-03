import { SOURCE_TEXT_MIN_LENGTH, TARGET_ROLE_MIN_LENGTH } from '@cv-builder/shared';
import { AppError, NotFoundError } from '../../lib/errors';
import { type GenerationInput, GenerationInputSchema } from './generation.input';
import type { GenerationDraft, GenerationRepository } from './generation.repository';

/**
 * Checks that a CV has what generation needs and snapshots it: a target role, plus an uploaded
 * PDF or a description of at least `SOURCE_TEXT_MIN_LENGTH` characters. Shorter notes still go
 * along with a PDF. Throws 422 `CV_NOT_READY` listing what is missing.
 */
export function toGenerationInput(draft: GenerationDraft): GenerationInput {
  const targetRole = draft.targetRole?.trim() ?? '';
  const sourceText = draft.sourceText?.trim() ?? '';
  const documentText = draft.sourceDocument?.extractedText?.trim() ?? '';

  const missing: { path: string; message: string }[] = [];
  if (targetRole.length < TARGET_ROLE_MIN_LENGTH) {
    missing.push({ path: 'targetRole', message: 'Add the role you’re applying for.' });
  }
  if (!documentText && sourceText.length < SOURCE_TEXT_MIN_LENGTH) {
    missing.push({ path: 'source', message: 'Upload your CV or describe your experience.' });
  }
  if (missing.length > 0) {
    throw new AppError(422, 'CV_NOT_READY', 'The CV is missing what generation needs', missing);
  }

  return GenerationInputSchema.parse({
    targetRole,
    sourceText: sourceText || null,
    sourceDocument:
      draft.sourceDocument && documentText
        ? {
            id: draft.sourceDocument.id,
            originalName: draft.sourceDocument.originalName,
            pageCount: draft.sourceDocument.pageCount,
            text: documentText,
          }
        : null,
  });
}

/** Starting and reading generations; the work itself happens in `generation.worker.ts`. */
export function createGenerationService(generation: GenerationRepository) {
  return {
    /** Queues a generation. Nothing waits for it: clients poll the job. */
    async start(userId: string, cvId: string) {
      const result = await generation.startJob(userId, cvId, toGenerationInput);
      switch (result.kind) {
        case 'not_found':
          throw new NotFoundError('CV not found');
        case 'already_generated':
          throw new AppError(
            409,
            'CV_ALREADY_GENERATED',
            'This CV has already been generated; edit it instead',
          );
        case 'busy':
          throw new AppError(409, 'GENERATION_IN_PROGRESS', 'This CV is already being generated', {
            jobId: result.jobId,
          });
        case 'created':
          return result.job;
      }
    },

    async get(userId: string, jobId: string) {
      const job = await generation.findForUser(userId, jobId);
      if (!job) {
        throw new NotFoundError('Generation not found');
      }
      return job;
    },
  };
}

export type GenerationService = ReturnType<typeof createGenerationService>;
