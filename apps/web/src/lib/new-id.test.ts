import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId } from './new-id';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The page's real random source, but without `randomUUID`, as on a page that isn't secure. */
function cryptoWithoutRandomUuid() {
  const real = globalThis.crypto;
  return { getRandomValues: real.getRandomValues.bind(real) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('newId', () => {
  it('uses crypto.randomUUID where the page has it (HTTPS, localhost)', () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => 'from-random-uuid',
      getRandomValues: () => {
        throw new Error('The fallback must not be used');
      },
    });

    expect(newId()).toBe('from-random-uuid');
  });

  // `http://<computer-ip>:5173`, as opened from a phone, has no crypto.randomUUID: adding a role
  // or a skill did nothing there until this fallback existed.
  it('falls back to getRandomValues where randomUUID does not exist', () => {
    vi.stubGlobal('crypto', cryptoWithoutRandomUuid());

    const ids = Array.from({ length: 200 }, () => newId());

    for (const id of ids) expect(id).toMatch(UUID_V4);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('checks on every call, not once at load', () => {
    vi.stubGlobal('crypto', cryptoWithoutRandomUuid());
    expect(newId()).toMatch(UUID_V4);

    vi.stubGlobal('crypto', { ...cryptoWithoutRandomUuid(), randomUUID: () => 'now-available' });
    expect(newId()).toBe('now-available');
  });
});
