import { errors, jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';

const ALGORITHM = 'HS256';
const ISSUER = 'cv-builder-api';
const AUDIENCE = 'cv-builder-web';

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
/** How long a session lasts. The cookie expires at the same time as its token. */
export const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;

const UserIdSchema = z.uuid();

export interface SessionTokens {
  /** A signed token naming the user, valid for `SESSION_TTL_MS`. */
  issue(userId: string): Promise<string>;
  /** The user id from a valid token; `null` if the token is malformed, forged or expired. */
  verify(token: string): Promise<string | null>;
}

interface Options {
  /** HMAC key; at least 32 bytes (checked in config/env.ts). */
  secret: string;
  /** The clock, injectable so tests can check expiry without fake timers. */
  now?: () => Date;
}

/**
 * Stateless session tokens: JWTs signed with HS256. Nothing is stored on the server, so a token
 * stays valid until it expires, even after logout (logout removes the cookie).
 */
export function createSessionTokens({ secret, now = () => new Date() }: Options): SessionTokens {
  const key = new TextEncoder().encode(secret);

  return {
    issue(userId) {
      const issuedAt = Math.floor(now().getTime() / 1000);
      return new SignJWT()
        .setProtectedHeader({ alg: ALGORITHM })
        .setSubject(userId)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + SESSION_TTL_SECONDS)
        .sign(key);
    },

    async verify(token) {
      let subject: unknown;
      try {
        const { payload } = await jwtVerify(token, key, {
          // Pinned: a token's own header never decides how it is checked.
          algorithms: [ALGORITHM],
          issuer: ISSUER,
          audience: AUDIENCE,
          requiredClaims: ['sub', 'exp'],
          currentDate: now(),
        });
        subject = payload.sub;
      } catch (error) {
        // Bad tokens are expected (expired, tampered with, from another deployment); bugs are not.
        if (error instanceof errors.JOSEError) return null;
        throw error;
      }
      // User ids are UUIDs; anything else would make the database lookup fail instead of miss.
      const userId = UserIdSchema.safeParse(subject);
      return userId.success ? userId.data : null;
    },
  };
}
