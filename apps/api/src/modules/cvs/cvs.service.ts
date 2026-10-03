import {
  type ContentConflictDetails,
  type CreateCvRequest,
  contentEditIssues,
  type CvContent,
  type UpdateCvRequest,
} from '@cv-builder/shared';
import { AppError, NotFoundError } from '../../lib/errors';
import type { CvChanges, CvsRepository } from './cvs.repository';

/** CVs are named after their target role until renaming exists. */
const UNTITLED_CV = 'Untitled CV';

function titleFor(targetRole: string | null): string {
  return targetRole ?? UNTITLED_CV;
}

/** CV business logic. HTTP-agnostic: it takes the acting user's id and validated input. */
export function createCvsService(cvs: CvsRepository) {
  return {
    list(userId: string) {
      return cvs.listForUser(userId);
    },

    async get(userId: string, cvId: string) {
      const cv = await cvs.findForUser(userId, cvId);
      // CVs owned by someone else are reported as missing, so their existence doesn't leak.
      if (!cv) {
        throw new NotFoundError('CV not found');
      }
      return cv;
    },

    create(userId: string, input: CreateCvRequest) {
      const targetRole = input.targetRole ?? null;
      return cvs.create(userId, {
        title: titleFor(targetRole),
        targetRole,
        sourceText: input.sourceText ?? null,
      });
    },

    /** Saves the target role and/or the free-text source. Absent fields stay as they are. */
    async update(userId: string, cvId: string, input: UpdateCvRequest) {
      const changes: CvChanges = {};
      if (input.targetRole !== undefined) {
        changes.targetRole = input.targetRole;
        changes.title = titleFor(input.targetRole);
      }
      if (input.sourceText !== undefined) {
        changes.sourceText = input.sourceText;
      }

      const cv = await cvs.update(userId, cvId, changes);
      if (!cv) {
        throw new NotFoundError('CV not found');
      }
      return cv;
    },

    /**
     * Saves the edited content over version `baseVersion`. The rules for what people type (see
     * `contentEditIssues`) apply to what changed since the stored version only.
     */
    async saveContent(userId: string, cvId: string, content: CvContent, baseVersion: number) {
      const result = await cvs.saveContent(userId, cvId, content, baseVersion, (stored) =>
        contentEditIssues(stored, content),
      );
      switch (result.kind) {
        case 'not_found':
          throw new NotFoundError('CV not found');
        case 'not_generated':
          throw new AppError(409, 'CV_NOT_GENERATED', 'This CV has no content to edit yet');
        case 'conflict':
          throw new AppError(409, 'CONTENT_CONFLICT', 'The CV changed since it was loaded', {
            content: result.content,
            contentVersion: result.contentVersion,
          } satisfies ContentConflictDetails);
        case 'invalid':
          // Shaped like the error handler's validation errors, paths as in the request body.
          throw new AppError(
            400,
            'VALIDATION_ERROR',
            'Request validation failed',
            result.issues.map(({ path, message }) => ({
              path: ['content', ...path].join('.'),
              message,
            })),
          );
        case 'saved':
          return result.contentVersion;
      }
    },
  };
}

export type CvsService = ReturnType<typeof createCvsService>;
