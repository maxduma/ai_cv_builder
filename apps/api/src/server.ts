import { SOURCE_PDF_MAX_PAGES } from '@cv-builder/shared';
import { createApp } from './app';
import { InvalidEnvError, parseEnv } from './config/env';
import { createPrismaClient, pingDatabase } from './db/prisma';
import { createRepositories } from './db/repositories';
import { createUnpdfTextExtractor } from './integrations/extraction/unpdf-pdf-text-extractor';
import { createLocalFileStorage } from './integrations/storage/local-file-storage';
import { createLogger } from './lib/logger';
import { createPasswordHasher } from './modules/auth/password-hasher';
import { createSessionResolver } from './modules/auth/session-resolver';
import { createSessionTokens } from './modules/auth/session-tokens';
import { createGenerationWorker } from './modules/generation/generation.worker';
import { createMockCvGenerator } from './modules/generation/mock-cv-generator';

const SHUTDOWN_TIMEOUT_MS = 10_000;
const PDF_PARSE_TIMEOUT_MS = 15_000;

async function main(): Promise<void> {
  const config = parseEnv(process.env);
  const logger = createLogger(config);
  const prisma = createPrismaClient(config.databaseUrl);

  if (!config.anthropic.apiKey) {
    logger.warn('ANTHROPIC_API_KEY is not set: AI features are disabled until it is configured.');
  }
  if (config.auth.usingDevJwtSecret) {
    // Production refuses to start without JWT_SECRET (see config/env.ts).
    logger.warn('JWT_SECRET is not set: sessions are signed with the public development secret.');
  }

  const repositories = createRepositories(prisma);
  const sessionTokens = createSessionTokens({ secret: config.auth.jwtSecret });

  const app = createApp({
    config,
    logger,
    checkDatabase: () => pingDatabase(prisma),
    resolveCurrentUser: createSessionResolver({ tokens: sessionTokens, users: repositories.users }),
    auth: {
      passwordHasher: createPasswordHasher(),
      sessionTokens,
      secureCookies: config.auth.secureCookies,
    },
    repositories,
    fileStorage: createLocalFileStorage(config.storage.uploadDir),
    pdfTextExtractor: createUnpdfTextExtractor({
      maxPages: SOURCE_PDF_MAX_PAGES,
      timeoutMs: PDF_PARSE_TIMEOUT_MS,
    }),
  });

  // CV generation runs in this process; the jobs themselves live in PostgreSQL.
  logger.info('CV generation uses the mock generator until Claude is wired up.');
  const worker = createGenerationWorker({
    repository: repositories.generation,
    generator: createMockCvGenerator(config.mockGeneration),
    logger: logger.child({ module: 'generation-worker' }),
  });

  const server = app.listen(config.port, '0.0.0.0', (error) => {
    if (error) {
      logger.fatal({ err: error }, 'Failed to start the HTTP server');
      process.exit(1);
    }
    logger.info(`API listening on port ${config.port}`);
    worker.start();
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');

    setTimeout(() => {
      logger.error('Graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();

    // Stopping the worker hands a running job back to the queue instead of leaving it stale.
    const workerStopped = worker.stop();
    server.close(async (error) => {
      await workerStopped;
      await prisma.$disconnect();
      logger.info('Shutdown complete');
      process.exit(error ? 1 : 0);
    });
    server.closeIdleConnections();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error: unknown) => {
  // The logger may not exist yet (e.g. invalid env), so report to stderr directly.
  console.error(error instanceof InvalidEnvError ? error.message : error);
  process.exit(1);
});
