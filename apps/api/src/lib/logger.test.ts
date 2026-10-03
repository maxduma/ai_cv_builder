import { describe, expect, it, vi } from 'vitest';
import { signUp, startApp } from '../test/start-app';
import { createLogger } from './logger';

interface RequestLog {
  req: { url: string; headers: Record<string, unknown> };
  res: { headers: Record<string, unknown> };
}

describe('createLogger', () => {
  it('keeps session tokens out of the request logs', async () => {
    const lines: string[] = [];
    const logger = createLogger({ nodeEnv: 'test' }, { write: (line) => lines.push(line) });
    const { baseUrl } = await startApp({ sessions: 'real', logger });

    const { cookie } = await signUp(baseUrl);
    const token = cookie.slice(cookie.indexOf('=') + 1);
    await fetch(`${baseUrl}/api/auth/me`, {
      headers: { cookie, authorization: `Bearer ${token}` },
    });

    // pino-http writes a request's line once its response has finished.
    await vi.waitFor(() => expect(lines).toHaveLength(2));
    const logs = lines.map((line) => JSON.parse(line) as RequestLog);
    const signup = logs.find((log) => log.req.url === '/api/auth/signup');
    const me = logs.find((log) => log.req.url === '/api/auth/me');

    expect(signup?.res.headers['set-cookie']).toBe('[Redacted]');
    expect(me?.req.headers).toMatchObject({ cookie: '[Redacted]', authorization: '[Redacted]' });
    expect(lines.join('\n')).not.toContain(token);
  });
});
