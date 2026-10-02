import { describe, expect, it } from 'vitest';
import { DEFAULT_ANTHROPIC_MODEL, DEFAULT_UPLOAD_DIR, parseEnv } from './env';

const DATABASE_URL = 'postgresql://user:pass@localhost:5432/app';

describe('parseEnv', () => {
  it('applies defaults', () => {
    expect(parseEnv({ DATABASE_URL })).toEqual({
      nodeEnv: 'development',
      port: 4000,
      logLevel: 'info',
      databaseUrl: DATABASE_URL,
      anthropic: { apiKey: undefined, model: DEFAULT_ANTHROPIC_MODEL },
      storage: { uploadDir: DEFAULT_UPLOAD_DIR },
      mockGeneration: { stepMs: 2_500, failRate: 0 },
    });
  });

  it('reads provided values', () => {
    const config = parseEnv({
      DATABASE_URL,
      NODE_ENV: 'production',
      PORT: '8080',
      LOG_LEVEL: 'debug',
      ANTHROPIC_API_KEY: 'sk-test',
      ANTHROPIC_MODEL: 'claude-sonnet-5-5',
      UPLOAD_DIR: '/data/uploads',
      MOCK_GENERATION_STEP_MS: '0',
      MOCK_GENERATION_FAIL_RATE: '0.5',
    });
    expect(config).toMatchObject({
      nodeEnv: 'production',
      port: 8080,
      logLevel: 'debug',
      anthropic: { apiKey: 'sk-test', model: 'claude-sonnet-5-5' },
      storage: { uploadDir: '/data/uploads' },
      mockGeneration: { stepMs: 0, failRate: 0.5 },
    });
  });

  it('treats empty strings as not set', () => {
    const config = parseEnv({
      DATABASE_URL,
      PORT: '',
      LOG_LEVEL: '',
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_MODEL: '',
    });
    expect(config.port).toBe(4000);
    expect(config.logLevel).toBe('info');
    expect(config.anthropic).toEqual({ apiKey: undefined, model: DEFAULT_ANTHROPIC_MODEL });
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
