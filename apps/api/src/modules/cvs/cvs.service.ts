import type { CreateCvRequest } from '@cv-builder/shared';
import { NotFoundError } from '../../lib/errors';
import type { CvsRepository } from './cvs.repository';

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
      return cvs.create(userId, input);
    },
  };
}

export type CvsService = ReturnType<typeof createCvsService>;
