import type { CurrentUser } from '../http/middleware/current-user';

declare global {
  namespace Express {
    interface Request {
      /** The user the request acts on behalf of. Set by the `currentUser` middleware. */
      user?: CurrentUser;
    }
  }
}

export {};
