import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Read directly instead of via `env()`, which throws when the variable is missing:
    // `prisma generate` must work without a database (e.g. on the host, for editor types).
    url: process.env.DATABASE_URL ?? '',
  },
});
