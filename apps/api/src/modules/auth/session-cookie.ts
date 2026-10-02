import { parseCookie } from 'cookie';
import type { CookieOptions, Request, Response } from 'express';
import { SESSION_TTL_MS } from './session-tokens';

export const SESSION_COOKIE = 'cvb_session';

/** The session token sent with the request, if any. */
export function readSessionCookie(req: Request): string | undefined {
  return parseCookie(req.headers.cookie ?? '')[SESSION_COOKIE];
}

/**
 * Sets and clears the session cookie. Both use the same options, because a browser only removes
 * a cookie when the clearing `Set-Cookie` has the same name and path.
 */
export function createSessionCookie({ secure }: { secure: boolean }) {
  // HttpOnly keeps the token away from page scripts; SameSite=Lax keeps it off cross-site POSTs
  // (CSRF); the path keeps it off everything but the API.
  const options: CookieOptions = { httpOnly: true, sameSite: 'lax', secure, path: '/api' };

  return {
    set(res: Response, token: string) {
      // Express takes `maxAge` in milliseconds.
      res.cookie(SESSION_COOKIE, token, { ...options, maxAge: SESSION_TTL_MS });
    },

    clear(res: Response) {
      res.clearCookie(SESSION_COOKIE, options);
    },
  };
}

export type SessionCookie = ReturnType<typeof createSessionCookie>;
