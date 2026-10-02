import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FileStorage } from './file-storage';

const SAFE_KEY = /^[\w-]+(?:\/[\w-]+)*\.[a-z0-9]+$/i;

/** Stores files on the local disk below `rootDir` (a Docker volume in development). */
export function createLocalFileStorage(rootDir: string): FileStorage {
  const root = path.resolve(rootDir);

  function pathFor(key: string): string {
    // Keys come from the API, but a bad key must never escape the storage directory.
    if (!SAFE_KEY.test(key)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return path.join(root, key);
  }

  return {
    async put(key, data) {
      const target = pathFor(key);
      await mkdir(path.dirname(target), { recursive: true });
      // Write to a temporary file first so a crash never leaves a half-written file under `key`.
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, data, { flag: 'wx' });
        await rename(temporary, target);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
    },

    async delete(key) {
      await rm(pathFor(key), { force: true });
    },
  };
}
