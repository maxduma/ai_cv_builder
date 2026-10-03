import { CvIdParamsSchema } from '@cv-builder/shared';
import { Router } from 'express';
import { requireUser } from '../../http/middleware/current-user';
import type { CvPdfService } from './cv-pdf.service';

/**
 * PDF export. The whole PDF is rendered before a header is sent, so a failure still answers with
 * the usual JSON error. The file is named "CV.pdf" here: response headers are logged, and a
 * person's name doesn't belong in logs. The web app names the download after the person.
 */
export function createCvPdfRouter(cvPdfService: CvPdfService): Router {
  const router = Router();

  router.get('/:cvId/pdf', async (req, res) => {
    const user = requireUser(req);
    const { cvId } = CvIdParamsSchema.parse(req.params);
    const pdf = await cvPdfService.render(user.id, cvId);
    res
      .attachment('CV.pdf')
      .set('Cache-Control', 'private, no-store')
      .set('X-Page-Count', String(pdf.pageCount))
      .send(Buffer.from(pdf.data.buffer, pdf.data.byteOffset, pdf.data.byteLength));
  });

  return router;
}
