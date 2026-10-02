import { Router } from 'express';
import type { HealthService } from './health.service';

export function createHealthRouter(healthService: HealthService): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const health = await healthService.check();
    res
      .status(health.status === 'error' ? 503 : 200)
      .set('Cache-Control', 'no-store')
      .json(health);
  });

  return router;
}
