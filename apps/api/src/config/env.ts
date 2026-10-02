import { z } from 'zod';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';
export const DEFAULT_UPLOAD_DIR = './storage/uploads';
/**
 * Signs session tokens in development and tests when `JWT_SECRET` is not set. It is public (it is
 * in the repository), so production refuses to start with it.
 */
export const DEV_JWT_SECRET = 'cv-builder-development-only-jwt-secret-not-for-production';
const JWT_SECRET_MIN_BYTES = 32;

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** Docker Compose passes unset optional variables as empty strings; treat them as "not set". */
const unsetIfEmpty = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema);

const EnvSchema = z
  .object({
    NODE_ENV: unsetIfEmpty(z.enum(['development', 'test', 'production']).default('development')),
    PORT: unsetIfEmpty(z.coerce.number().int().min(1).max(65_535).default(4000)),
    LOG_LEVEL: unsetIfEmpty(z.enum(LOG_LEVELS).default('info')),
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
    ANTHROPIC_MODEL: unsetIfEmpty(z.string().trim().min(1).default(DEFAULT_ANTHROPIC_MODEL)),
    UPLOAD_DIR: unsetIfEmpty(z.string().trim().min(1).default(DEFAULT_UPLOAD_DIR)),
    MOCK_GENERATION_STEP_MS: unsetIfEmpty(
      z.coerce.number().int().min(0).max(60_000).default(2_500),
    ),
    MOCK_GENERATION_FAIL_RATE: unsetIfEmpty(z.coerce.number().min(0).max(1).default(0)),
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
  });

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: LogLevel;
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
    /** Undefined until the user configures it; AI features are disabled without it. */
    apiKey: string | undefined;
    model: string;
  };
  storage: {
    /** Directory for uploaded source files (relative paths resolve against the working directory). */
    uploadDir: string;
  };
  /** Until Claude is wired up, CVs are "generated" by a mock that walks through the real steps. */
  mockGeneration: {
    stepMs: number;
    /** Share of runs that fail (0–1), to exercise the failure screen. */
    failRate: number;
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
    logLevel: vars.LOG_LEVEL,
    databaseUrl: vars.DATABASE_URL,
    auth: {
      jwtSecret: vars.JWT_SECRET ?? DEV_JWT_SECRET,
      usingDevJwtSecret: vars.JWT_SECRET === undefined,
      secureCookies: vars.NODE_ENV === 'production',
    },
    anthropic: {
      apiKey: vars.ANTHROPIC_API_KEY,
      model: vars.ANTHROPIC_MODEL,
    },
    storage: {
      uploadDir: vars.UPLOAD_DIR,
    },
    mockGeneration: {
      stepMs: vars.MOCK_GENERATION_STEP_MS,
      failRate: vars.MOCK_GENERATION_FAIL_RATE,
    },
  };
}
