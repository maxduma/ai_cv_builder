import { CvContentSchema } from '@cv-builder/shared';
import type { CvPdfRenderer, RenderedPdf } from '../../integrations/pdf/cv-pdf-renderer';
import { AppError, NotFoundError } from '../../lib/errors';
import type { CvsRepository } from '../cvs/cvs.repository';

/** PDF export: a CV's saved content, rendered as a PDF. */
export function createCvPdfService({
  cvs,
  renderer,
}: {
  cvs: CvsRepository;
  renderer: CvPdfRenderer;
}) {
  return {
    /** The PDF of the CV as it is saved now (the editor saves before asking for it). */
    async render(userId: string, cvId: string): Promise<RenderedPdf> {
      const cv = await cvs.findForUser(userId, cvId);
      // CVs owned by someone else are reported as missing, so their existence doesn't leak.
      if (!cv) {
        throw new NotFoundError('CV not found');
      }
      // Content exists from version 1 on (the first generation writes it).
      if (cv.contentVersion === 0) {
        throw new AppError(409, 'CV_NOT_GENERATED', 'This CV has no content to export yet');
      }
      // Stored content the schema refuses is a fault on our side (500), not a bad request (400).
      const content = CvContentSchema.safeParse(cv.content);
      if (!content.success) {
        throw new Error('The stored CV content does not match the schema', {
          cause: content.error,
        });
      }

      try {
        return await renderer.render(content.data);
      } catch (error) {
        throw new AppError(500, 'PDF_RENDER_FAILED', 'The PDF could not be created', undefined, {
          cause: error,
        });
      }
    },
  };
}

export type CvPdfService = ReturnType<typeof createCvPdfService>;
