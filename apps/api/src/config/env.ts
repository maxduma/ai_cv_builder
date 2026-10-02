import { z } from 'zod';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';
export const DEFAULT_UPLOAD_DIR = './storage/uploads';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** Docker Compose passes unset optional variables as empty strings; treat them as "not set". */
const unsetIfEmpty = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema);

const EnvSchema = z.object({
  NODE_ENV: unsetIfEmpty(z.enum(['development', 'test', 'production']).default('development')),
  PORT: unsetIfEmpty(z.coerce.number().int().min(1).max(65_535).default(4000)),
  LOG_LEVEL: unsetIfEmpty(z.enum(LOG_LEVELS).default('info')),
  DATABASE_URL: unsetIfEmpty(z.url({ protocol: /^postgres(ql)?$/ })),
  ANTHROPIC_API_KEY: unsetIfEmpty(z.string().trim().min(1).optional()),
  ANTHROPIC_MODEL: unsetIfEmpty(z.string().trim().min(1).default(DEFAULT_ANTHROPIC_MODEL)),
  UPLOAD_DIR: unsetIfEmpty(z.string().trim().min(1).default(DEFAULT_UPLOAD_DIR)),
  MOCK_GENERATION_STEP_MS: unsetIfEmpty(z.coerce.number().int().min(0).max(60_000).default(2_500)),
  MOCK_GENERATION_FAIL_RATE: unsetIfEmpty(z.coerce.number().min(0).max(1).default(0)),
});

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: LogLevel;
  databaseUrl: string;
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
