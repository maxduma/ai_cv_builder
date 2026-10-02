import { Router } from 'express';
import type { AppDeps } from '../app';
import { createCvsRepository } from '../modules/cvs/cvs.repository';
import { createCvsRouter } from '../modules/cvs/cvs.routes';
import { createCvsService } from '../modules/cvs/cvs.service';
import { createHealthRouter } from '../modules/health/health.routes';
import { createHealthService } from '../modules/health/health.service';
import { currentUser } from './middleware/current-user';

/**
 * Composition root for the `/api` routes: builds repositories → services → routers.
 * Plain factory functions instead of a DI container; everything is wired here.
 */
export function createApiRouter(deps: AppDeps): Router {
  const healthService = createHealthService({
    checkDatabase: deps.checkDatabase,
    anthropic: deps.config.anthropic,
    logger: deps.logger,
  });
  const cvsService = createCvsService(createCvsRepository(deps.prisma));

  const router = Router();

  // Public routes.
  router.use('/health', createHealthRouter(healthService));

  // Everything below acts on behalf of a user.
  router.use(currentUser(deps.resolveCurrentUser));
  router.use('/cvs', createCvsRouter(cvsService));

  return router;
}
