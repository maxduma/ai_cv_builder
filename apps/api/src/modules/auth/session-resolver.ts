import type { CurrentUserResolver } from '../../http/middleware/current-user';
import type { UsersRepository } from '../users/users.repository';
import { readSessionCookie } from './session-cookie';
import type { SessionTokens } from './session-tokens';

interface Dependencies {
  tokens: SessionTokens;
  users: Pick<UsersRepository, 'findById'>;
}

/**
 * Resolves the current user from the session cookie. Only a missing or invalid token, or an
 * account that no longer exists, means "not logged in". Database errors propagate (500), so an
 * outage doesn't look to the web app like every user being logged out.
 */
export function createSessionResolver({ tokens, users }: Dependencies): CurrentUserResolver {
  return async (req) => {
    const token = readSessionCookie(req);
    if (!token) return null;

    const userId = await tokens.verify(token);
    if (!userId) return null;

    return users.findById(userId);
  };
}
