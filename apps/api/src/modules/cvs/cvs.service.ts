import {
  type ContentConflictDetails,
  type CreateCvRequest,
  contentEditIssues,
  type CvContent,
  type UpdateCvRequest,
} from '@cv-builder/shared';
import { deleteStoredFiles } from '../../integrations/storage/delete-files';
import type { FileStorage } from '../../integrations/storage/file-storage';
import { AppError, NotFoundError } from '../../lib/errors';
import type { Logger } from '../../lib/logger';
import type { CvChanges, CvsRepository } from './cvs.repository';

/** A CV is named after its target role until it is renamed. */
const UNTITLED_CV = 'Untitled CV';

function titleFor(targetRole: string | null): string {
  return targetRole ?? UNTITLED_CV;
}

interface Dependencies {
  cvs: CvsRepository;
  storage: FileStorage;
  logger: Logger;
}

/** CV business logic. HTTP-agnostic: it takes the acting user's id and validated input. */
export function createCvsService({ cvs, storage, logger }: Dependencies) {
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

    /**
     * Renames the CV and/or saves the target role and the free-text source. Absent fields stay as
     * they are. A new role renames the CV too, unless the person has given it a name of their own.
     */
    async update(userId: string, cvId: string, input: UpdateCvRequest) {
      const changes: CvChanges = {};
      if (input.targetRole !== undefined) {
        changes.targetRole = input.targetRole;
        const current = await cvs.findNames(userId, cvId);
        if (current && current.title === titleFor(current.targetRole)) {
          changes.title = titleFor(input.targetRole);
        }
      }
      if (input.title !== undefined) {
        changes.title = input.title;
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
     * Deletes the CV with everything that belongs to it, and then its uploaded files: the rows go
     * in one transaction, and a file that can't be removed is only logged, never a failed request.
     */
    async remove(userId: string, cvId: string) {
      const storageKeys = await cvs.removeForUser(userId, cvId);
      if (!storageKeys) {
        throw new NotFoundError('CV not found');
      }
      await deleteStoredFiles(storage, storageKeys, logger);
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
