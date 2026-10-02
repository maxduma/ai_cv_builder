import { createApp } from './app';
import { InvalidEnvError, parseEnv } from './config/env';
import { createPrismaClient, pingDatabase } from './db/prisma';
import { createLogger } from './lib/logger';
import { createUsersRepository } from './modules/users/users.repository';

/** Until authentication exists, every request acts as this user. */
const DEMO_USER = { email: 'demo@cv-builder.local', name: 'Demo User' };

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  const config = parseEnv(process.env);
  const logger = createLogger(config);
  const prisma = createPrismaClient(config.databaseUrl);

  if (!config.anthropic.apiKey) {
    logger.warn('ANTHROPIC_API_KEY is not set: AI features are disabled until it is configured.');
  }

  const demoUser = await createUsersRepository(prisma).upsertByEmail(
    DEMO_USER.email,
    DEMO_USER.name,
  );

  const app = createApp({
    config,
    logger,
    prisma,
    checkDatabase: () => pingDatabase(prisma),
    resolveCurrentUser: async () => demoUser,
  });

  const server = app.listen(config.port, '0.0.0.0', (error) => {
    if (error) {
      logger.fatal({ err: error }, 'Failed to start the HTTP server');
      process.exit(1);
    }
    logger.info(`API listening on port ${config.port}`);
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

    server.close(async (error) => {
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
