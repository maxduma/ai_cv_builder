import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalFileStorage } from './local-file-storage';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'cv-storage-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('local file storage', () => {
  it('writes files below the root and deletes them', async () => {
    const storage = createLocalFileStorage(root);
    const key = 'user-1/cv-1/file-1.pdf';

    await storage.put(key, new TextEncoder().encode('%PDF-1.7'));
    expect(await readFile(path.join(root, key), 'utf8')).toBe('%PDF-1.7');
    expect(await readdir(path.join(root, 'user-1/cv-1'))).toEqual(['file-1.pdf']);

    await storage.delete(key);
    await storage.delete(key); // deleting twice is fine
    expect(await readdir(path.join(root, 'user-1/cv-1'))).toEqual([]);
  });

  it.each(['../escape.pdf', '/etc/passwd.pdf', 'user/../../escape.pdf', 'no-extension'])(
    'refuses unsafe keys (%s)',
    async (key) => {
      const storage = createLocalFileStorage(root);

      await expect(storage.put(key, new Uint8Array([1]))).rejects.toThrow(/Invalid storage key/);
    },
  );
});
