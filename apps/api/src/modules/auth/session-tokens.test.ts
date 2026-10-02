import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createSessionTokens, SESSION_TTL_MS } from './session-tokens';

const SECRET = 'a-test-secret-that-is-long-enough-for-hs256';
const USER_ID = '0199a000-0000-7000-8000-00000000000a';
const NOW = new Date('2026-10-02T12:00:00Z');

const at = (date: Date) => createSessionTokens({ secret: SECRET, now: () => date });
const later = (ms: number) => new Date(NOW.getTime() + ms);

/** Signs claims with the test secret, bypassing the service's own defaults. */
function sign(claims: Record<string, unknown>, alg = 'HS256') {
  const nowSeconds = Math.floor(NOW.getTime() / 1000);
  return new SignJWT({
    sub: USER_ID,
    iss: 'cv-builder-api',
    aud: 'cv-builder-web',
    iat: nowSeconds,
    exp: nowSeconds + 60,
    ...claims,
  })
    .setProtectedHeader({ alg })
    .sign(new TextEncoder().encode(SECRET));
}

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('createSessionTokens', () => {
  it('issues a token that names the user', async () => {
    const token = await at(NOW).issue(USER_ID);

    expect(await at(NOW).verify(token)).toBe(USER_ID);
  });

  it('expires tokens after seven days', async () => {
    const token = await at(NOW).issue(USER_ID);

    expect(SESSION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(await at(later(SESSION_TTL_MS - 1_000)).verify(token)).toBe(USER_ID);
    expect(await at(later(SESSION_TTL_MS)).verify(token)).toBeNull();
  });

  it('rejects tokens signed with another secret', async () => {
    const token = await createSessionTokens({
      secret: 'another-secret-that-is-also-long-enough',
      now: () => NOW,
    }).issue(USER_ID);

    expect(await at(NOW).verify(token)).toBeNull();
  });

  it('rejects unsigned tokens', async () => {
    const [, payload] = (await at(NOW).issue(USER_ID)).split('.');
    const unsigned = `${base64url({ alg: 'none', typ: 'JWT' })}.${payload}.`;

    expect(await at(NOW).verify(unsigned)).toBeNull();
  });

  it('rejects tokens whose claims were changed after signing', async () => {
    const [header, , signature] = (await at(NOW).issue(USER_ID)).split('.');
    const nowSeconds = Math.floor(NOW.getTime() / 1000);
    const payload = base64url({
      sub: '0199a000-0000-7000-8000-00000000000b',
      iss: 'cv-builder-api',
      aud: 'cv-builder-web',
      iat: nowSeconds,
      exp: nowSeconds + 60,
    });

    expect(await at(NOW).verify(`${header}.${payload}.${signature}`)).toBeNull();
  });

  it('accepts only HS256', async () => {
    expect(await at(NOW).verify(await sign({}))).toBe(USER_ID);
    expect(await at(NOW).verify(await sign({}, 'HS512'))).toBeNull();
  });

  it.each([
    ['another issuer', { iss: 'someone-else' }],
    ['another audience', { aud: 'someone-else' }],
    ['no expiry', { exp: undefined }],
    ['no subject', { sub: undefined }],
    ['a subject that is not a user id', { sub: 'admin' }],
  ])('rejects a token with %s', async (_case, claims) => {
    expect(await at(NOW).verify(await sign(claims))).toBeNull();
  });

  it('rejects strings that are not tokens', async () => {
    for (const token of ['', 'not-a-token', 'a.b.c', '...']) {
      expect(await at(NOW).verify(token), token).toBeNull();
    }
  });
});
