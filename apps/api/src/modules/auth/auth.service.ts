import type { LoginRequest, SignUpRequest } from '@cv-builder/shared';
import { AppError } from '../../lib/errors';
import type { UserRecord, UsersRepository } from '../users/users.repository';
import type { PasswordHasher } from './password-hasher';
import type { SessionTokens } from './session-tokens';

interface Dependencies {
  users: UsersRepository;
  passwordHasher: PasswordHasher;
  sessionTokens: SessionTokens;
}

const EMAIL_TAKEN = 'An account with this email already exists.';
const INVALID_CREDENTIALS = 'Incorrect email or password.';

/** Sign-up and login. Both return the user and a session token for the cookie. */
export function createAuthService({ users, passwordHasher, sessionTokens }: Dependencies) {
  async function startSession(user: UserRecord) {
    return { user, token: await sessionTokens.issue(user.id) };
  }

  return {
    async signUp(input: SignUpRequest) {
      // No "is this email taken?" query first: the insert itself finds out, race-free.
      const passwordHash = await passwordHasher.hash(input.password);
      const result = await users.create({ email: input.email, name: input.name, passwordHash });
      if (result.kind === 'email_taken') {
        throw new AppError(409, 'EMAIL_TAKEN', EMAIL_TAKEN, [
          { path: 'email', message: EMAIL_TAKEN },
        ]);
      }
      return startSession(result.user);
    },

    async logIn(input: LoginRequest) {
      const account = await users.findCredentialsByEmail(input.email);
      // An unknown email costs a hash check too, and gets the same answer as a wrong password, so
      // neither the response nor its timing reveals which emails have accounts.
      const valid = await passwordHasher.verify(input.password, account?.passwordHash ?? null);
      if (!account || !valid) {
        throw new AppError(401, 'INVALID_CREDENTIALS', INVALID_CREDENTIALS);
      }
      return startSession({ id: account.id, email: account.email, name: account.name });
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
