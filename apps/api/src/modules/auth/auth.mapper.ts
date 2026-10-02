import type { AuthUser } from '@cv-builder/shared';
import type { UserRecord } from '../users/users.repository';

/** Copies the public fields one by one, so nothing else on a user object can reach a response. */
export function toAuthUser(user: UserRecord): AuthUser {
  return { id: user.id, name: user.name, email: user.email };
}
