import type { ApiErrorBody, AuthResponse } from '@cv-builder/shared';
import { parseSetCookie } from 'cookie';
import { describe, expect, it } from 'vitest';
import {
  sendJson,
  sessionCookieFrom,
  signUp,
  startApp,
  TEST_JWT_SECRET,
  TEST_PASSWORD,
} from '../../test/start-app';
import { createPasswordHasher } from './password-hasher';
import { SESSION_COOKIE } from './session-cookie';
import { createSessionTokens, SESSION_TTL_MS } from './session-tokens';

const ACCOUNT = { name: 'Alex Morgan', email: 'alex@example.com', password: TEST_PASSWORD };

async function setup() {
  const app = await startApp({ sessions: 'real' });
  const url = (path: string) => `${app.baseUrl}/api/auth${path}`;
  const me = (cookie?: string) => fetch(url('/me'), { headers: cookie ? { cookie } : {} });
  return { ...app, url, me };
}

function setCookies(response: Response) {
  return response.headers.getSetCookie().map((header) => parseSetCookie(header));
}

/** The JWT's three parts, from a `cvb_session=…` cookie. */
function tokenParts(cookie: string) {
  return cookie.slice(`${SESSION_COOKIE}=`.length).split('.');
}

describe('POST /api/auth/signup', () => {
  it('creates the account and starts a session in an HttpOnly cookie', async () => {
    const { url, me, db } = await setup();

    const response = await sendJson(url('/signup'), 'POST', ACCOUNT);
    const body = (await response.json()) as AuthResponse;

    expect(response.status).toBe(201);
    expect(body).toEqual({
      user: { id: db.users[0]?.id, name: 'Alex Morgan', email: 'alex@example.com' },
    });
    // Not `Secure` here: tests run with the development settings.
    expect(setCookies(response)).toEqual([
      {
        name: SESSION_COOKIE,
        value: expect.any(String),
        httpOnly: true,
        sameSite: 'lax',
        path: '/api',
        maxAge: SESSION_TTL_MS / 1000,
        expires: expect.any(Date),
      },
    ]);

    const session = await me(sessionCookieFrom(response));
    expect(session.status).toBe(200);
    expect(await session.json()).toEqual(body);
  });

  it('stores the email trimmed and lowercased, so logging in ignores case', async () => {
    const { url, db } = await setup();

    await sendJson(url('/signup'), 'POST', { ...ACCOUNT, email: '  Alex@Example.COM ' });
    const login = await sendJson(url('/login'), 'POST', {
      email: 'ALEX@example.com',
      password: TEST_PASSWORD,
    });

    expect(db.users.map((user) => user.email)).toEqual(['alex@example.com']);
    expect(login.status).toBe(200);
  });

  it('refuses an email that already has an account', async () => {
    const { url, baseUrl, db } = await setup();
    await signUp(baseUrl, ACCOUNT);

    const response = await sendJson(url('/signup'), 'POST', {
      ...ACCOUNT,
      name: 'Someone Else',
      email: 'ALEX@example.com',
    });
    const body = (await response.json()) as ApiErrorBody;

    expect(response.status).toBe(409);
    expect(body.error).toMatchObject({
      code: 'EMAIL_TAKEN',
      details: [{ path: 'email', message: 'An account with this email already exists.' }],
    });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(db.users).toHaveLength(1);
  });

  it('explains every invalid field', async () => {
    const { url, db } = await setup();

    const response = await sendJson(url('/signup'), 'POST', {
      name: '   ',
      email: 'alex@',
      password: 'short',
    });
    const body = (await response.json()) as ApiErrorBody;

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toEqual([
      { path: 'name', message: 'Enter your full name.' },
      { path: 'email', message: 'Enter a valid email address.' },
      { path: 'password', message: 'Use at least 8 characters.' },
    ]);
    expect(db.users).toHaveLength(0);
  });

  it('rejects control characters in the name (PostgreSQL text cannot store U+0000)', async () => {
    const { url, db } = await setup();

    const response = await sendJson(url('/signup'), 'POST', {
      ...ACCOUNT,
      name: 'Alex\u0000Morgan',
    });
    const body = (await response.json()) as ApiErrorBody;

    expect(response.status).toBe(400);
    expect(body.error.details).toEqual([{ path: 'name', message: 'Enter your full name.' }]);
    expect(db.users).toHaveLength(0);
  });

  it('only accepts JSON, which a cross-site form cannot send', async () => {
    const { url, db } = await setup();

    const response = await fetch(url('/signup'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(ACCOUNT).toString(),
    });

    expect(response.status).toBe(400);
    expect(db.users).toHaveLength(0);
  });
});

describe('POST /api/auth/login', () => {
  it('starts a session for the right password', async () => {
    const { url, me, baseUrl } = await setup();
    const { user } = await signUp(baseUrl, ACCOUNT);

    const response = await sendJson(url('/login'), 'POST', {
      email: ACCOUNT.email,
      password: TEST_PASSWORD,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user });
    const session = await me(sessionCookieFrom(response));
    expect(await session.json()).toEqual({ user });
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const { url, baseUrl } = await setup();
    await signUp(baseUrl, ACCOUNT);

    const wrongPassword = await sendJson(url('/login'), 'POST', {
      email: ACCOUNT.email,
      password: 'not the password',
    });
    const unknownEmail = await sendJson(url('/login'), 'POST', {
      email: 'nobody@example.com',
      password: TEST_PASSWORD,
    });

    for (const response of [wrongPassword, unknownEmail]) {
      const { error } = (await response.json()) as ApiErrorBody;
      expect(response.status).toBe(401);
      expect(response.headers.getSetCookie()).toEqual([]);
      // Everything but the request id.
      expect({ ...error, requestId: undefined }).toEqual({
        code: 'INVALID_CREDENTIALS',
        message: 'Incorrect email or password.',
        requestId: undefined,
      });
    }
  });

  it('refuses a password longer than any it could match, before hashing it', async () => {
    const { url, baseUrl } = await setup();
    await signUp(baseUrl, ACCOUNT);

    const response = await sendJson(url('/login'), 'POST', {
      email: ACCOUNT.email,
      password: 'x'.repeat(1_025),
    });

    expect(response.status).toBe(400);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('requires both fields', async () => {
    const { url } = await setup();

    const response = await sendJson(url('/login'), 'POST', { email: '', password: '' });
    const body = (await response.json()) as ApiErrorBody;

    expect(response.status).toBe(400);
    expect(body.error.details).toEqual([
      { path: 'email', message: 'Enter your email address.' },
      { path: 'password', message: 'Enter your password.' },
    ]);
  });
});

describe('POST /api/auth/logout', () => {
  it('expires the session cookie, on the path it was set for', async () => {
    const { url, baseUrl } = await setup();
    const { cookie } = await signUp(baseUrl, ACCOUNT);

    const response = await fetch(url('/logout'), { method: 'POST', headers: { cookie } });
    const [cleared] = setCookies(response);

    expect(response.status).toBe(204);
    expect(cleared).toMatchObject({ name: SESSION_COOKIE, value: '', path: '/api' });
    expect(cleared?.expires?.getTime()).toBeLessThan(Date.now());
  });

  // Sessions are stateless (see docs/architecture.md): logging out removes the cookie from the browser, but a
  // copy of the token stays valid until it expires. Pinned here so changing it is a decision.
  it('leaves a copied token valid until it expires', async () => {
    const { url, me, baseUrl } = await setup();
    const { cookie } = await signUp(baseUrl, ACCOUNT);

    await fetch(url('/logout'), { method: 'POST', headers: { cookie } });

    expect((await me(cookie)).status).toBe(200);
  });

  it('leaves cookies alone when the request has no session (a cross-site POST)', async () => {
    const { url } = await setup();

    const response = await fetch(url('/logout'), { method: 'POST' });

    expect(response.status).toBe(204);
    expect(setCookies(response)).toEqual([]);
  });
});

describe('GET /api/auth/me', () => {
  it('requires a session', async () => {
    const { me } = await setup();

    const response = await me();
    const body = (await response.json()) as ApiErrorBody;

    expect(response.status).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a token that was tampered with', async () => {
    const { me, baseUrl } = await setup();
    const alex = await signUp(baseUrl, ACCOUNT);
    const sam = await signUp(baseUrl, { ...ACCOUNT, email: 'sam@example.com' });
    // Alex's signature on a payload that names Sam.
    const [header, , signature] = tokenParts(alex.cookie);
    const [, samPayload] = tokenParts(sam.cookie);

    const response = await me(`${SESSION_COOKIE}=${header}.${samPayload}.${signature}`);

    expect(response.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const { me, baseUrl } = await setup();
    const { user } = await signUp(baseUrl, ACCOUNT);
    const issuedLongAgo = createSessionTokens({
      secret: TEST_JWT_SECRET,
      now: () => new Date(Date.now() - SESSION_TTL_MS - 1_000),
    });

    const response = await me(`${SESSION_COOKIE}=${await issuedLongAgo.issue(user.id)}`);

    expect(response.status).toBe(401);
  });

  it('treats a malformed cookie as no session', async () => {
    const { me } = await setup();

    const response = await me(`${SESSION_COOKIE}=%E0%A4%A`);

    expect(response.status).toBe(401);
  });

  it('answers 401, not 404, for an unknown API route without a session', async () => {
    const { baseUrl } = await setup();

    const response = await fetch(`${baseUrl}/api/does-not-exist`);

    expect(response.status).toBe(401);
  });

  it('rejects a valid token for an account that no longer exists', async () => {
    const { me, baseUrl, db } = await setup();
    const { cookie } = await signUp(baseUrl, ACCOUNT);
    db.users.splice(0);

    const response = await me(cookie);

    expect(response.status).toBe(401);
  });
});

it('marks the session cookie Secure when the app serves HTTPS', async () => {
  const { baseUrl } = await startApp({
    sessions: 'real',
    auth: {
      passwordHasher: createPasswordHasher({ log2N: 10, r: 8, p: 1 }),
      sessionTokens: createSessionTokens({ secret: TEST_JWT_SECRET }),
      secureCookies: true,
    },
  });

  const response = await sendJson(`${baseUrl}/api/auth/signup`, 'POST', ACCOUNT);

  expect(setCookies(response)).toEqual([
    expect.objectContaining({
      name: SESSION_COOKIE,
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
    }),
  ]);
});

it('never sends the password hash', async () => {
  const { url, me, db } = await setup();

  const signup = await sendJson(url('/signup'), 'POST', ACCOUNT);
  const login = await sendJson(url('/login'), 'POST', {
    email: ACCOUNT.email,
    password: TEST_PASSWORD,
  });
  const session = await me(sessionCookieFrom(login));
  const passwordHash = db.users[0]?.passwordHash ?? '';

  expect(passwordHash).toMatch(/^scrypt\$/);
  for (const response of [signup, login, session]) {
    const text = await response.text();
    expect(text).not.toContain(passwordHash);
    expect(text).not.toMatch(/scrypt|passwordHash/i);
    expect(Object.keys((JSON.parse(text) as AuthResponse).user).sort()).toEqual([
      'email',
      'id',
      'name',
    ]);
  }
});
