import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Config } from './config/env';
import type { PrismaClient } from './db/prisma';
import type { CurrentUserResolver } from './http/middleware/current-user';
import { errorHandler } from './http/middleware/error-handler';
import { notFound } from './http/middleware/not-found';
import { createApiRouter } from './http/router';
import type { Logger } from './lib/logger';

export interface AppDeps {
  config: Config;
  logger: Logger;
  prisma: PrismaClient;
  checkDatabase: () => Promise<void>;
  resolveCurrentUser: CurrentUserResolver;
}

/** A client-supplied request id is reused only if it is short and safe to log. */
const SAFE_REQUEST_ID = /^[\w-]{1,128}$/;

/** Builds the Express app without starting a server, so tests can run it on any port. */
export function createApp(deps: AppDeps): Express {
  const app = express();

  app.use(helmet());
  app.use(
    pinoHttp({
      logger: deps.logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id =
          typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      // The web app polls the health endpoint; don't flood the logs with it.
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', createApiRouter(deps));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
