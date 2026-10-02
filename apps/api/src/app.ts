import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Config } from './config/env';
import type { Repositories } from './db/repositories';
import type { CurrentUserResolver } from './http/middleware/current-user';
import { errorHandler } from './http/middleware/error-handler';
import { notFound } from './http/middleware/not-found';
import { createApiRouter } from './http/router';
import type { PdfTextExtractor } from './integrations/extraction/pdf-text-extractor';
import type { FileStorage } from './integrations/storage/file-storage';
import type { Logger } from './lib/logger';
import type { PasswordHasher } from './modules/auth/password-hasher';
import type { SessionTokens } from './modules/auth/session-tokens';

export interface AppDeps {
  config: Config;
  logger: Logger;
  checkDatabase: () => Promise<void>;
  resolveCurrentUser: CurrentUserResolver;
  auth: {
    passwordHasher: PasswordHasher;
    sessionTokens: SessionTokens;
    /** Marks the session cookie `Secure` (sent over HTTPS only). */
    secureCookies: boolean;
  };
  repositories: Repositories;
  fileStorage: FileStorage;
  pdfTextExtractor: PdfTextExtractor;
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
      // Health checks and generation progress are polled; don't flood the logs with them.
      autoLogging: {
        ignore: (req) =>
          req.url === '/api/health' ||
          (req.method === 'GET' && req.url?.startsWith('/api/generation-jobs/') === true),
      },
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', createApiRouter(deps));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
