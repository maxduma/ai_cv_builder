import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export interface ScryptParams {
  /** CPU and memory cost, as a power of two (N = 2^log2N). */
  log2N: number;
  /** Block size. */
  r: number;
  /** Parallelisation. */
  p: number;
}

/**
 * One of OWASP's recommended scrypt settings. It needs 16 MiB per hash, which fits Node's default
 * 32 MiB `maxmem`; the 2^16/r8/p2 variant needs more and throws.
 */
export const DEFAULT_SCRYPT_PARAMS: ScryptParams = { log2N: 14, r: 8, p: 5 };

const SALT_BYTES = 16;
const KEY_BYTES = 64;

/** `scrypt$<log2N>$<r>$<p>$<salt>$<key>`, with the salt and the key in base64. */
const STORED_HASH =
  /^scrypt\$([1-9]\d?)\$([1-9]\d{0,2})\$([1-9]\d{0,2})\$([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2})$/;

export interface PasswordHasher {
  /** A salted hash that records its own parameters, so it stays verifiable if they change. */
  hash(password: string): Promise<string>;
  /**
   * Checks a password against a stored hash. A hash that can't be read counts as a mismatch, not
   * an error. With `null` (no such account) it does the same work against a dummy hash and returns
   * false, so response times don't reveal which emails have accounts.
   */
  verify(password: string, storedHash: string | null): Promise<boolean>;
}

function deriveKey(password: string, salt: Buffer, { log2N, r, p }: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, { N: 2 ** log2N, r, p }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

function parseStoredHash(storedHash: string) {
  const match = STORED_HASH.exec(storedHash);
  if (!match) return null;
  const [, log2N = '', r = '', p = '', salt = '', key = ''] = match;
  return {
    params: { log2N: Number(log2N), r: Number(r), p: Number(p) },
    salt: Buffer.from(salt, 'base64'),
    key: Buffer.from(key, 'base64'),
  };
}

/** Password hashing with scrypt from `node:crypto` (no native dependency). */
export function createPasswordHasher(params: ScryptParams = DEFAULT_SCRYPT_PARAMS): PasswordHasher {
  async function hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const key = await deriveKey(password, salt, params);
    const { log2N, r, p } = params;
    return `scrypt$${log2N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
  }

  async function matches(password: string, storedHash: string): Promise<boolean> {
    const stored = parseStoredHash(storedHash);
    // timingSafeEqual throws on buffers of different lengths.
    if (!stored || stored.key.length !== KEY_BYTES) return false;

    let key: Buffer;
    try {
      key = await deriveKey(password, stored.salt, stored.params);
    } catch (error) {
      // scrypt rejects the stored parameters (e.g. over the memory limit): the hash is unusable.
      if (error instanceof RangeError) return false;
      throw error;
    }
    return timingSafeEqual(key, stored.key);
  }

  // Made right away, with the same parameters as new hashes, so checking it costs the same as a
  // real check. Built lazily, the first unknown email after a restart would take twice as long.
  const dummyHash = hash(randomBytes(SALT_BYTES).toString('base64'));
  // Awaited (and any failure reported) in `verify`; this only avoids an unhandled rejection.
  dummyHash.catch(() => {});

  return {
    hash,

    async verify(password, storedHash) {
      if (storedHash === null) {
        await matches(password, await dummyHash);
        return false;
      }
      return matches(password, storedHash);
    },
  };
}
