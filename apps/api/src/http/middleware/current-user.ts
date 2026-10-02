import type { Request, RequestHandler } from 'express';
import { UnauthorizedError } from '../../lib/errors';

export interface CurrentUser {
  id: string;
  email: string;
}

/** Works out which user a request acts on behalf of; `null` means unauthenticated. */
export type CurrentUserResolver = (req: Request) => Promise<CurrentUser | null>;

/**
 * Attaches the current user to `req.user`, or rejects the request with 401.
 *
 * This is the single seam for authentication: there is no auth yet, so server.ts passes a resolver
 * that always returns a demo user. Adding real auth means replacing only that resolver.
 */
export function currentUser(resolve: CurrentUserResolver): RequestHandler {
  return async (req, _res, next) => {
    const user = await resolve(req);
    if (!user) {
      throw new UnauthorizedError();
    }
    req.user = user;
    next();
  };
}

/** Returns the current user in handlers mounted behind `currentUser`. */
export function requireUser(req: Request): CurrentUser {
  if (!req.user) {
    throw new UnauthorizedError();
  }
  return req.user;
}
