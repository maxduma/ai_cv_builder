import { describe, expect, it } from 'vitest';
import { createPasswordHasher } from './password-hasher';

// Cheap parameters keep the tests fast; hashes record their parameters, so any set works.
const hasher = createPasswordHasher({ log2N: 10, r: 8, p: 1 });
const PASSWORD = 'correct horse battery staple';

describe('createPasswordHasher', () => {
  it('stores the parameters, a 16-byte salt and a 64-byte key', async () => {
    // The production parameters, once: they must run within Node's default scrypt memory limit.
    const stored = await createPasswordHasher().hash(PASSWORD);

    const [scheme, log2N, r, p, salt = '', key = ''] = stored.split('$');
    expect([scheme, log2N, r, p]).toEqual(['scrypt', '14', '8', '5']);
    expect(Buffer.from(salt, 'base64')).toHaveLength(16);
    expect(Buffer.from(key, 'base64')).toHaveLength(64);
  });

  it('accepts the right password and rejects others', async () => {
    const stored = await hasher.hash(PASSWORD);

    expect(await hasher.verify(PASSWORD, stored)).toBe(true);
    expect(await hasher.verify('correct horse battery stapler', stored)).toBe(false);
    expect(await hasher.verify('Correct horse battery staple', stored)).toBe(false);
    expect(await hasher.verify('', stored)).toBe(false);
  });

  it('salts every hash', async () => {
    const first = await hasher.hash(PASSWORD);
    const second = await hasher.hash(PASSWORD);

    expect(first).not.toBe(second);
    expect(await hasher.verify(PASSWORD, second)).toBe(true);
  });

  it('verifies with the parameters stored in the hash', async () => {
    const stored = await createPasswordHasher({ log2N: 11, r: 4, p: 2 }).hash(PASSWORD);

    expect(await hasher.verify(PASSWORD, stored)).toBe(true);
  });

  it('treats a hash it cannot use as a mismatch instead of throwing', async () => {
    const [, , , , salt = '', key = ''] = (await hasher.hash(PASSWORD)).split('$');
    const keyBytes = Buffer.from(key, 'base64');
    const malformed = [
      '',
      'not-a-hash',
      `bcrypt$10$8$1$${salt}$${key}`,
      `scrypt$10$8$1$${salt}`,
      `scrypt$ten$8$1$${salt}$${key}`,
      `scrypt$10$0$1$${salt}$${key}`,
      `scrypt$10$8$1$${salt}$not*base64`,
      // Keys of the wrong length (timingSafeEqual would throw on them).
      `scrypt$10$8$1$${salt}$${keyBytes.subarray(0, 32).toString('base64')}`,
      `scrypt$10$8$1$${salt}$${Buffer.concat([keyBytes, keyBytes]).toString('base64')}`,
      // Parameters scrypt refuses: out of range, and over the memory limit.
      `scrypt$40$8$1$${salt}$${key}`,
      `scrypt$24$8$1$${salt}$${key}`,
    ];

    for (const storedHash of malformed) {
      await expect(hasher.verify(PASSWORD, storedHash), storedHash).resolves.toBe(false);
    }
  });

  it('rejects every password for an account that does not exist', async () => {
    expect(await hasher.verify(PASSWORD, null)).toBe(false);
    expect(await hasher.verify('', null)).toBe(false);
  });
});
