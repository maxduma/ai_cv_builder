import { Router } from 'express';
import type { AppDeps } from '../app';
import { createAuthRouter, createCurrentUserRouter } from '../modules/auth/auth.routes';
import { createAuthService } from '../modules/auth/auth.service';
import { createSessionCookie } from '../modules/auth/session-cookie';
import { createCvPdfRouter } from '../modules/cv-pdf/cv-pdf.routes';
import { createCvPdfService } from '../modules/cv-pdf/cv-pdf.service';
import { createCvsRouter } from '../modules/cvs/cvs.routes';
import { createCvsService } from '../modules/cvs/cvs.service';
import { createGenerationRouter } from '../modules/generation/generation.routes';
import { createGenerationService } from '../modules/generation/generation.service';
import { createHealthRouter } from '../modules/health/health.routes';
import { createHealthService } from '../modules/health/health.service';
import { createQuestionsRouter } from '../modules/questions/questions.routes';
import { createQuestionsService } from '../modules/questions/questions.service';
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
  const authService = createAuthService({
    users: repositories.users,
    passwordHasher: deps.auth.passwordHasher,
    sessionTokens: deps.auth.sessionTokens,
  });
  const sessionCookie = createSessionCookie({ secure: deps.auth.secureCookies });
  const cvsService = createCvsService(repositories.cvs);
  const sourceDocumentsService = createSourceDocumentsService({
    cvs: repositories.cvs,
    documents: repositories.sourceDocuments,
    storage: deps.fileStorage,
    extractor: deps.pdfTextExtractor,
    logger: deps.logger,
  });
  const cvPdfService = createCvPdfService({
    cvs: repositories.cvs,
    renderer: deps.cvPdfRenderer,
  });
  const generationService = createGenerationService(repositories.generation);
  const questionsService = createQuestionsService(repositories.questions);

  const router = Router();

  // Public routes.
  router.use('/health', createHealthRouter(healthService));
  router.use('/auth', createAuthRouter(authService, sessionCookie));

  // Everything below acts on behalf of a user. Without a session, any other path (even an
  // unknown one) answers 401.
  router.use(currentUser(deps.resolveCurrentUser));
  router.use('/auth', createCurrentUserRouter());
  router.use('/cvs', createCvsRouter(cvsService));
  router.use('/cvs', createSourceDocumentsRouter(sourceDocumentsService));
  router.use('/cvs', createCvPdfRouter(cvPdfService));
  router.use(createGenerationRouter(generationService));
  router.use(createQuestionsRouter(questionsService));

  return router;
}
