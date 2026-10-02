import { Router } from 'express';
import type { AppDeps } from '../app';
import { createCvsRouter } from '../modules/cvs/cvs.routes';
import { createCvsService } from '../modules/cvs/cvs.service';
import { createGenerationRouter } from '../modules/generation/generation.routes';
import { createGenerationService } from '../modules/generation/generation.service';
import { createHealthRouter } from '../modules/health/health.routes';
import { createHealthService } from '../modules/health/health.service';
import { createSourceDocumentsRouter } from '../modules/source-documents/source-documents.routes';
import { createSourceDocumentsService } from '../modules/source-documents/source-documents.service';
import { currentUser } from './middleware/current-user';

/**
 * Composition root for the `/api` routes: builds services from the repositories and integrations,
 * then the routers. Plain factory functions instead of a DI container; everything is wired here.
 */
export function createApiRouter(deps: AppDeps): Router {
  const { repositories } = deps;

  const healthService = createHealthService({
    checkDatabase: deps.checkDatabase,
    anthropic: deps.config.anthropic,
    logger: deps.logger,
  });
  const cvsService = createCvsService(repositories.cvs);
  const sourceDocumentsService = createSourceDocumentsService({
    cvs: repositories.cvs,
    documents: repositories.sourceDocuments,
    storage: deps.fileStorage,
    extractor: deps.pdfTextExtractor,
    logger: deps.logger,
  });
  const generationService = createGenerationService(repositories.generation);

  const router = Router();

  // Public routes.
  router.use('/health', createHealthRouter(healthService));

  // Everything below acts on behalf of a user.
  router.use(currentUser(deps.resolveCurrentUser));
  router.use('/cvs', createCvsRouter(cvsService));
  router.use('/cvs', createSourceDocumentsRouter(sourceDocumentsService));
  router.use(createGenerationRouter(generationService));

  return router;
}
