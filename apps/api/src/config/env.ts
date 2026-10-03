import { z } from 'zod';

export const DEFAULT_UPLOAD_DIR = './storage/uploads';
/**
 * Signs session tokens in development and tests when `JWT_SECRET` is not set. It is public (it is
 * in the repository), so production refuses to start with it.
 */
export const DEV_JWT_SECRET = 'cv-builder-development-only-jwt-secret-not-for-production';
const JWT_SECRET_MIN_BYTES = 32;

/** Docker Compose passes unset optional variables as empty strings; treat them as "not set". */
const unsetIfEmpty = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema);

// Only what changes from one machine to the next, or is secret, is read from the environment.
// Everything else is a constant next to the code it tunes: the Claude model and effort
// (integrations/ai/claude-client.ts), the job deadlines (generation.worker.ts), the mocks'
// pace (mock-cv-generator.ts), the log level (lib/logger.ts).
const EnvSchema = z
  .object({
    NODE_ENV: unsetIfEmpty(z.enum(['development', 'test', 'production']).default('development')),
    PORT: unsetIfEmpty(z.coerce.number().int().min(1).max(65_535).default(4000)),
    DATABASE_URL: unsetIfEmpty(z.url({ protocol: /^postgres(ql)?$/ })),
    JWT_SECRET: unsetIfEmpty(
      z
        .string()
        .refine((value) => new TextEncoder().encode(value).length >= JWT_SECRET_MIN_BYTES, {
          error: `Use at least ${JWT_SECRET_MIN_BYTES} bytes, e.g. \`openssl rand -base64 48\``,
        })
        .optional(),
    ),
    ANTHROPIC_API_KEY: unsetIfEmpty(z.string().trim().min(1).optional()),
    UPLOAD_DIR: unsetIfEmpty(z.string().trim().min(1).default(DEFAULT_UPLOAD_DIR)),
  })
  .superRefine((vars, ctx) => {
    if (vars.NODE_ENV !== 'production') return;
    if (vars.JWT_SECRET === undefined || vars.JWT_SECRET === DEV_JWT_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: 'Set a private secret in production, e.g. `openssl rand -base64 48`',
      });
    }
    // Without a key, development falls back to the mock generator; production must not.
    if (vars.ANTHROPIC_API_KEY === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['ANTHROPIC_API_KEY'],
        message: 'Required in production: CV generation runs on Claude',
      });
    }
  });

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  auth: {
    /** HMAC key for session tokens (HS256). */
    jwtSecret: string;
    /** True when `JWT_SECRET` was not set and the public development secret is used. */
    usingDevJwtSecret: boolean;
    /** Session cookies are `Secure` (HTTPS only) in production. */
    secureCookies: boolean;
  };
  anthropic: {
    /** Required in production. Without it, development generates CVs with the mock generator. */
    apiKey: string | undefined;
  };
  storage: {
    /** Directory for uploaded source files (relative paths resolve against the working directory). */
    uploadDir: string;
  };
}

export class InvalidEnvError extends Error {
  override name = 'InvalidEnvError';
}

/** Validates environment variables and maps them to typed config. Throws `InvalidEnvError`. */
export function parseEnv(env: Record<string, string | undefined>): Config {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    throw new InvalidEnvError(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }

  const vars = result.data;
  return {
    nodeEnv: vars.NODE_ENV,
    port: vars.PORT,
    databaseUrl: vars.DATABASE_URL,
    auth: {
      jwtSecret: vars.JWT_SECRET ?? DEV_JWT_SECRET,
      usingDevJwtSecret: vars.JWT_SECRET === undefined,
      secureCookies: vars.NODE_ENV === 'production',
    },
    anthropic: {
      apiKey: vars.ANTHROPIC_API_KEY,
    },
    storage: {
      uploadDir: vars.UPLOAD_DIR,
    },
  };
}
