import { type AuthResponse, LoginRequestSchema, SignUpRequestSchema } from '@cv-builder/shared';
import { Router } from 'express';
import { requireUser } from '../../http/middleware/current-user';
import { toAuthUser } from './auth.mapper';
import type { AuthService } from './auth.service';
import { readSessionCookie, type SessionCookie } from './session-cookie';

/** Sign-up, login and logout. Public: mounted before the `currentUser` middleware. */
export function createAuthRouter(service: AuthService, sessionCookie: SessionCookie): Router {
  const router = Router();

  router.post('/signup', async (req, res) => {
    const input = SignUpRequestSchema.parse(req.body ?? {});
    const { user, token } = await service.signUp(input);
    sessionCookie.set(res, token);
    res.status(201).json({ user: toAuthUser(user) } satisfies AuthResponse);
  });

  router.post('/login', async (req, res) => {
    const input = LoginRequestSchema.parse(req.body ?? {});
    const { user, token } = await service.logIn(input);
    sessionCookie.set(res, token);
    res.json({ user: toAuthUser(user) } satisfies AuthResponse);
  });

  // Sessions are stateless, so logging out means removing the cookie from this browser. It is
  // cleared only when the request carries it: a cross-site form POST never does (SameSite=Lax),
  // so another site can't log the user out.
  router.post('/logout', (req, res) => {
    if (readSessionCookie(req) !== undefined) {
      sessionCookie.clear(res);
    }
    res.status(204).end();
  });

  return router;
}

/** `GET /auth/me`, mounted behind `currentUser`: the session has already been checked. */
export function createCurrentUserRouter(): Router {
  const router = Router();

  router.get('/me', (req, res) => {
    res.json({ user: toAuthUser(requireUser(req)) } satisfies AuthResponse);
  });

  return router;
}
