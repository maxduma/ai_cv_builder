import type { HealthResponse } from '@cv-builder/shared';
import type { Config } from '../../config/env';
import type { Logger } from '../../lib/logger';

export interface HealthServiceDeps {
  checkDatabase: () => Promise<void>;
  anthropic: Config['anthropic'];
  logger: Logger;
}

export function createHealthService({ checkDatabase, anthropic, logger }: HealthServiceDeps) {
  async function getDatabaseHealth(): Promise<HealthResponse['checks']['database']> {
    const startedAt = performance.now();
    try {
      await checkDatabase();
      return { status: 'ok', latencyMs: Math.round(performance.now() - startedAt) };
    } catch (err) {
      logger.warn({ err }, 'Health check: database is unreachable');
      return { status: 'error' };
    }
  }

  return {
    async check(): Promise<HealthResponse> {
      const database = await getDatabaseHealth();
      const aiConfigured = anthropic.apiKey !== undefined;

      return {
        status: database.status === 'error' ? 'error' : aiConfigured ? 'ok' : 'degraded',
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
        checks: {
          database,
          ai: { status: aiConfigured ? 'configured' : 'not_configured', model: anthropic.model },
        },
      };
    },
  };
}

export type HealthService = ReturnType<typeof createHealthService>;
