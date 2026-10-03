import type { Logger } from '../../lib/logger';
import type { FileStorage } from './file-storage';

/** Best effort: a file left behind wastes space but never breaks anything. */
export async function deleteStoredFiles(storage: FileStorage, keys: string[], logger: Logger) {
  const results = await Promise.allSettled(keys.map((key) => storage.delete(key)));
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      logger.warn(
        { err: result.reason, storageKey: keys[index] },
        'Could not delete a stored file',
      );
    }
  });
}
