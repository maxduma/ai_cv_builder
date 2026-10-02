import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pino from 'pino';
import { afterEach } from 'vitest';
import { type AppDeps, createApp } from '../app';
import { parseEnv } from '../config/env';
import type { PdfText, PdfTextExtractor } from '../integrations/extraction/pdf-text-extractor';
import type { FileStorage } from '../integrations/storage/file-storage';
import { createInMemoryRepositories } from './in-memory-repositories';

export const USER_A = '0199a000-0000-7000-8000-00000000000a';
export const USER_B = '0199a000-0000-7000-8000-00000000000b';

/** Requests act as USER_A unless they send this header (a stand-in for real authentication). */
export const TEST_USER_HEADER = 'x-test-user';

export const SAMPLE_PDF_TEXT: PdfText = {
  pageCount: 2,
  text: 'Senior backend engineer with seven years of experience building payment APIs.',
};

export function createMemoryStorage() {
  const files = new Map<string, Uint8Array>();
  const storage: FileStorage = {
    async put(key, data) {
      files.set(key, data);
    },
    async delete(key) {
      files.delete(key);
    },
  };
  return { storage, files };
}

/** An extractor that returns `result`, or throws it if it is an error. */
export function createFakeExtractor(result: PdfText | Error = SAMPLE_PDF_TEXT) {
  const calls: Uint8Array[] = [];
  const extractor: PdfTextExtractor = {
    async extract(pdf) {
      calls.push(pdf);
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return { extractor, calls };
}

const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

/**
 * Starts the app on a random port with in-memory repositories and fake integrations. Returns its
 * base URL plus the fakes, so tests can arrange data and inspect what happened.
 */
export async function startApp(overrides: Partial<AppDeps> = {}) {
  const { repositories, db } = createInMemoryRepositories();
  const { storage, files } = createMemoryStorage();
  const { extractor, calls: extractorCalls } = createFakeExtractor();

  const app = createApp({
    config: parseEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://u:p@localhost:5432/test' }),
    logger: pino({ level: 'silent' }),
    checkDatabase: async () => {},
    resolveCurrentUser: async (req) => {
      const id = req.header(TEST_USER_HEADER) ?? USER_A;
      return { id, email: `${id}@example.com` };
    },
    repositories,
    fileStorage: storage,
    pdfTextExtractor: extractor,
    ...overrides,
  });

  const server = app.listen(0);
  servers.push(server);
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    repositories,
    db,
    files,
    extractorCalls,
  };
}

/** `fetch` with a JSON body. */
export function sendJson(
  url: string,
  method: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
