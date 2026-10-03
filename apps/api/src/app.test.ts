import type { ApiErrorBody, HealthResponse } from '@cv-builder/shared';
import { describe, expect, it } from 'vitest';
import { sendJson, startApp } from './test/start-app';

describe('GET /api/health', () => {
  it('reports a degraded status while the AI key is missing', async () => {
    const { baseUrl } = await startApp();

    const response = await fetch(`${baseUrl}/api/health`);
    const body = (await response.json()) as HealthResponse;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: 'degraded',
      checks: {
        database: { status: 'ok' },
        ai: { status: 'not_configured', model: 'claude-opus-5-5' },
      },
    });
  });

  it('returns 503 when the database is unreachable', async () => {
    const { baseUrl } = await startApp({
      checkDatabase: () => Promise.reject(new Error('connection refused')),
    });

    const response = await fetch(`${baseUrl}/api/health`);
    const body = (await response.json()) as HealthResponse;

    expect(response.status).toBe(503);
    expect(body.status).toBe('error');
    expect(body.checks.database).toEqual({ status: 'error' });
  });
});

describe('error handling', () => {
  it('returns a JSON 404 for unknown routes', async () => {
    const { baseUrl } = await startApp();

    const response = await fetch(`${baseUrl}/api/does-not-exist`);
    const body = (await response.json()) as ApiErrorBody;

    expect(response.status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBe(response.headers.get('x-request-id'));
  });

  it('rejects malformed JSON', async () => {
    const { baseUrl } = await startApp();

    const response = await fetch(`${baseUrl}/api/cvs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"targetRole":',
    });
    const body = (await response.json()) as ApiErrorBody;

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('INVALID_JSON');
  });

  it('validates request bodies', async () => {
    const { baseUrl } = await startApp();

    const response = await sendJson(`${baseUrl}/api/cvs`, 'POST', { targetRole: 'x' });
    const body = (await response.json()) as ApiErrorBody;

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toEqual([
      { path: 'targetRole', message: 'Use at least 2 characters' },
    ]);
  });

  it.each([
    [
      'a body too large',
      { 'Content-Type': 'application/json' },
      JSON.stringify({ sourceText: 'x'.repeat(1_100_000) }),
      413,
      'PAYLOAD_TOO_LARGE',
    ],
    [
      'a charset it can’t read',
      { 'Content-Type': 'application/json; charset=latin1' },
      '{}',
      415,
      'VALIDATION_ERROR',
    ],
    [
      'an unknown encoding',
      { 'Content-Type': 'application/json', 'Content-Encoding': 'compress' },
      '{}',
      415,
      'VALIDATION_ERROR',
    ],
  ])('answers a request with %s as the client’s error', async (_, headers, body, status, code) => {
    const { baseUrl } = await startApp();

    const response = await fetch(`${baseUrl}/api/cvs`, { method: 'POST', headers, body });

    expect(response.status).toBe(status);
    expect(((await response.json()) as ApiErrorBody).error.code).toBe(code);
  });

  it('answers a malformed %-escape in the URL with 400', async () => {
    const { baseUrl } = await startApp();

    const response = await fetch(`${baseUrl}/api/cvs/%E0%A4%A`);
    const body = (await response.json()) as ApiErrorBody;

    expect(response.status).toBe(400);
    expect(body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'The request could not be read',
    });
  });

  it('keeps API responses out of the browser’s cache', async () => {
    const { baseUrl } = await startApp();

    const ok = await fetch(`${baseUrl}/api/cvs`);
    const failed = await fetch(`${baseUrl}/api/cvs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });

    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(failed.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects requests without a current user', async () => {
    const { baseUrl } = await startApp({ resolveCurrentUser: async () => null });

    const response = await fetch(`${baseUrl}/api/cvs`);
    const body = (await response.json()) as ApiErrorBody;

    expect(response.status).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});
