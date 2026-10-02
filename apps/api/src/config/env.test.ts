import { describe, expect, it } from 'vitest';
import { DEFAULT_ANTHROPIC_MODEL, parseEnv } from './env';

const DATABASE_URL = 'postgresql://user:pass@localhost:5432/app';

describe('parseEnv', () => {
  it('applies defaults', () => {
    expect(parseEnv({ DATABASE_URL })).toEqual({
      nodeEnv: 'development',
      port: 4000,
      logLevel: 'info',
      databaseUrl: DATABASE_URL,
      anthropic: { apiKey: undefined, model: DEFAULT_ANTHROPIC_MODEL },
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
    });
    expect(config).toMatchObject({
      nodeEnv: 'production',
      port: 8080,
      logLevel: 'debug',
      anthropic: { apiKey: 'sk-test', model: 'claude-sonnet-5-5' },
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

  it('requires a PostgreSQL DATABASE_URL', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ DATABASE_URL: 'mysql://user:pass@localhost/app' })).toThrow(
      /DATABASE_URL/,
    );
  });
});
