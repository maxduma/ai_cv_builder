/**
 * `ok`: everything works. `degraded`: the API works but AI features are not configured.
 * `error`: the database is unreachable (served with HTTP 503).
 */
export type HealthStatus = 'ok' | 'degraded' | 'error';

/** Response of `GET /api/health`. */
export interface HealthResponse {
  status: HealthStatus;
  uptimeSeconds: number;
  timestamp: string;
  checks: {
    database: { status: 'ok' | 'error'; latencyMs?: number };
    ai: { status: 'configured' | 'not_configured'; model: string };
  };
}
