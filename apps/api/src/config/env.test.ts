import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_GENERATION_TIMEOUT_MS,
  DEFAULT_UPLOAD_DIR,
  DEV_JWT_SECRET,
  parseEnv,
} from './env';

const DATABASE_URL = 'postgresql://user:pass@localhost:5432/app';
const JWT_SECRET = 'a-test-secret-that-is-long-enough-for-hs256';

describe('parseEnv', () => {
  it('applies defaults', () => {
    expect(parseEnv({ DATABASE_URL })).toEqual({
      nodeEnv: 'development',
      port: 4000,
      logLevel: 'info',
      databaseUrl: DATABASE_URL,
      auth: { jwtSecret: DEV_JWT_SECRET, usingDevJwtSecret: true, secureCookies: false },
      anthropic: { apiKey: undefined, model: DEFAULT_ANTHROPIC_MODEL },
      storage: { uploadDir: DEFAULT_UPLOAD_DIR },
      generation: { timeoutMs: DEFAULT_GENERATION_TIMEOUT_MS },
      mockGeneration: { stepMs: 2_500, failRate: 0 },
    });
  });

  it('reads provided values', () => {
    const config = parseEnv({
      DATABASE_URL,
      NODE_ENV: 'production',
      PORT: '8080',
      LOG_LEVEL: 'debug',
      JWT_SECRET,
      ANTHROPIC_API_KEY: 'sk-test',
      ANTHROPIC_MODEL: 'claude-sonnet-5-5',
      UPLOAD_DIR: '/data/uploads',
      GENERATION_TIMEOUT_MS: '60000',
      MOCK_GENERATION_STEP_MS: '0',
      MOCK_GENERATION_FAIL_RATE: '0.5',
    });
    expect(config).toMatchObject({
      nodeEnv: 'production',
      port: 8080,
      logLevel: 'debug',
      auth: { jwtSecret: JWT_SECRET, usingDevJwtSecret: false, secureCookies: true },
      anthropic: { apiKey: 'sk-test', model: 'claude-sonnet-5-5' },
      storage: { uploadDir: '/data/uploads' },
      generation: { timeoutMs: 60_000 },
      mockGeneration: { stepMs: 0, failRate: 0.5 },
    });
  });

  it('treats empty strings as not set', () => {
    const config = parseEnv({
      DATABASE_URL,
      PORT: '',
      LOG_LEVEL: '',
      JWT_SECRET: '',
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_MODEL: '',
    });
    expect(config.auth.jwtSecret).toBe(DEV_JWT_SECRET);
    expect(config.port).toBe(4000);
    expect(config.logLevel).toBe('info');
    expect(config.anthropic).toEqual({ apiKey: undefined, model: DEFAULT_ANTHROPIC_MODEL });
  });

  it('requires a private JWT secret in production', () => {
    const production = { DATABASE_URL, NODE_ENV: 'production', ANTHROPIC_API_KEY: 'sk-test' };
    expect(() => parseEnv(production)).toThrow(/JWT_SECRET/);
    expect(() => parseEnv({ ...production, JWT_SECRET: DEV_JWT_SECRET })).toThrow(/JWT_SECRET/);
  });

  it('requires an Anthropic API key in production only', () => {
    expect(() => parseEnv({ DATABASE_URL, NODE_ENV: 'production', JWT_SECRET })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
    expect(parseEnv({ DATABASE_URL }).anthropic.apiKey).toBeUndefined();
  });

  it('keeps the generation timeout within bounds', () => {
    expect(() => parseEnv({ DATABASE_URL, GENERATION_TIMEOUT_MS: '10' })).toThrow(
      /GENERATION_TIMEOUT_MS/,
    );
  });

  it('rejects a JWT secret shorter than 32 bytes', () => {
    expect(() => parseEnv({ DATABASE_URL, JWT_SECRET: 'too-short' })).toThrow(/JWT_SECRET/);
  });

  it('rejects an invalid port', () => {
    expect(() => parseEnv({ DATABASE_URL, PORT: 'not-a-port' })).toThrow(/PORT/);
  });

  it('keeps the mock failure rate between 0 and 1', () => {
    expect(() => parseEnv({ DATABASE_URL, MOCK_GENERATION_FAIL_RATE: '2' })).toThrow(
      /MOCK_GENERATION_FAIL_RATE/,
    );
  });

  it('requires a PostgreSQL DATABASE_URL', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ DATABASE_URL: 'mysql://user:pass@localhost/app' })).toThrow(
      /DATABASE_URL/,
    );
  });
});
