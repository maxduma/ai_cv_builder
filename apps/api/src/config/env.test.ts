import { describe, expect, it } from 'vitest';
import { DEFAULT_UPLOAD_DIR, DEV_JWT_SECRET, parseEnv } from './env';

const DATABASE_URL = 'postgresql://user:pass@localhost:5432/app';
const JWT_SECRET = 'a-test-secret-that-is-long-enough-for-hs256';

describe('parseEnv', () => {
  it('applies defaults', () => {
    expect(parseEnv({ DATABASE_URL })).toEqual({
      nodeEnv: 'development',
      port: 4000,
      databaseUrl: DATABASE_URL,
      auth: { jwtSecret: DEV_JWT_SECRET, usingDevJwtSecret: true, secureCookies: false },
      anthropic: { apiKey: undefined },
      storage: { uploadDir: DEFAULT_UPLOAD_DIR },
    });
  });

  it('reads provided values', () => {
    const config = parseEnv({
      DATABASE_URL,
      NODE_ENV: 'production',
      PORT: '8080',
      JWT_SECRET,
      ANTHROPIC_API_KEY: 'sk-test',
      UPLOAD_DIR: '/data/uploads',
    });
    expect(config).toMatchObject({
      nodeEnv: 'production',
      port: 8080,
      auth: { jwtSecret: JWT_SECRET, usingDevJwtSecret: false, secureCookies: true },
      anthropic: { apiKey: 'sk-test' },
      storage: { uploadDir: '/data/uploads' },
    });
  });

  it('treats empty strings as not set, as Docker Compose passes unset variables', () => {
    const config = parseEnv({
      DATABASE_URL,
      PORT: '',
      JWT_SECRET: '',
      ANTHROPIC_API_KEY: '',
      UPLOAD_DIR: '',
    });
    expect(config.auth.jwtSecret).toBe(DEV_JWT_SECRET);
    expect(config.port).toBe(4000);
    expect(config.anthropic).toEqual({ apiKey: undefined });
    expect(config.storage.uploadDir).toBe(DEFAULT_UPLOAD_DIR);
  });

  it('ignores variables it no longer reads, instead of failing on them', () => {
    // An older .env may still set them.
    const config = parseEnv({
      DATABASE_URL,
      ANTHROPIC_MODEL: 'claude-sonnet-5-5',
      GENERATION_TIMEOUT_MS: '10',
      LOG_LEVEL: 'nonsense',
      MOCK_GENERATION_FAIL_RATE: '2',
    });
    expect(config.anthropic).toEqual({ apiKey: undefined });
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

  it('rejects a JWT secret shorter than 32 bytes', () => {
    expect(() => parseEnv({ DATABASE_URL, JWT_SECRET: 'too-short' })).toThrow(/JWT_SECRET/);
  });

  it('rejects an invalid port', () => {
    expect(() => parseEnv({ DATABASE_URL, PORT: 'not-a-port' })).toThrow(/PORT/);
  });

  it('requires a PostgreSQL DATABASE_URL', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ DATABASE_URL: 'mysql://user:pass@localhost/app' })).toThrow(
      /DATABASE_URL/,
    );
  });
});
