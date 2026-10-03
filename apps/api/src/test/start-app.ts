import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AuthResponse, CvContent, SignUpRequest } from '@cv-builder/shared';
import pino from 'pino';
import { afterEach } from 'vitest';
import { type AppDeps, createApp } from '../app';
import { parseEnv } from '../config/env';
import type { CurrentUserResolver } from '../http/middleware/current-user';
import type { PdfText, PdfTextExtractor } from '../integrations/extraction/pdf-text-extractor';
import type { CvPdfRenderer, RenderedPdf } from '../integrations/pdf/cv-pdf-renderer';
import type { FileStorage } from '../integrations/storage/file-storage';
import { createPasswordHasher } from '../modules/auth/password-hasher';
import { SESSION_COOKIE } from '../modules/auth/session-cookie';
import { createSessionResolver } from '../modules/auth/session-resolver';
import { createSessionTokens } from '../modules/auth/session-tokens';
import { createInMemoryRepositories } from './in-memory-repositories';

export const USER_A = '0199a000-0000-7000-8000-00000000000a';
export const USER_B = '0199a000-0000-7000-8000-00000000000b';

/** Requests act as USER_A unless they send this header (a stand-in for real authentication). */
export const TEST_USER_HEADER = 'x-test-user';

export const TEST_JWT_SECRET = 'test-only-secret-for-signing-session-tokens';
export const TEST_PASSWORD = 'correct horse battery staple';

/** Far cheaper than the production parameters, so tests that sign up stay fast. */
const TEST_SCRYPT_PARAMS = { log2N: 10, r: 8, p: 1 };

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

export const SAMPLE_RENDERED_PDF: RenderedPdf = {
  data: new TextEncoder().encode('%PDF-1.7\n% a stand-in for a rendered CV\n%%EOF\n'),
  pageCount: 2,
};

/**
 * A renderer that returns `result`, or throws it if it is an error, and records the content it was
 * given. The default for the app in tests, so they don't load React-PDF; its own tests use it.
 */
export function createFakePdfRenderer(result: RenderedPdf | Error = SAMPLE_RENDERED_PDF) {
  const calls: CvContent[] = [];
  const renderer: CvPdfRenderer = {
    async render(content) {
      calls.push(content);
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return { renderer, calls };
}

const testUserFromHeader: CurrentUserResolver = async (req) => {
  const id = req.header(TEST_USER_HEADER) ?? USER_A;
  return { id, email: `${id}@example.com`, name: 'Test User' };
};

const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

interface StartAppOptions extends Partial<AppDeps> {
  /**
   * `'header'` (default): requests act as USER_A, or as the user in `x-test-user`.
   * `'real'`: the session cookie decides, as in production; sign up or log in first.
   */
  sessions?: 'header' | 'real';
}

/**
 * Starts the app on a random port with in-memory repositories and fake integrations. Returns its
 * base URL plus the fakes, so tests can arrange data and inspect what happened.
 */
export async function startApp({ sessions = 'header', ...overrides }: StartAppOptions = {}) {
  const { repositories, db } = createInMemoryRepositories();
  const { storage, files } = createMemoryStorage();
  const { extractor, calls: extractorCalls } = createFakeExtractor();
  const { renderer: pdfRenderer, calls: pdfRenderCalls } = createFakePdfRenderer();
  const sessionTokens = createSessionTokens({ secret: TEST_JWT_SECRET });

  const app = createApp({
    config: parseEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://u:p@localhost:5432/test',
      JWT_SECRET: TEST_JWT_SECRET,
    }),
    logger: pino({ level: 'silent' }),
    checkDatabase: async () => {},
    resolveCurrentUser:
      sessions === 'real'
        ? createSessionResolver({ tokens: sessionTokens, users: repositories.users })
        : testUserFromHeader,
    auth: {
      passwordHasher: createPasswordHasher(TEST_SCRYPT_PARAMS),
      sessionTokens,
      secureCookies: false,
    },
    repositories,
    fileStorage: storage,
    pdfTextExtractor: extractor,
    cvPdfRenderer: pdfRenderer,
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
    pdfRenderCalls,
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

/** The session cookie a response sets, as a `Cookie` request header (`cvb_session=…`). */
export function sessionCookieFrom(response: Response): string {
  const header = response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`));
  if (!header) {
    throw new Error('The response did not set the session cookie');
  }
  const [nameAndValue = ''] = header.split(';');
  return nameAndValue;
}

/** Signs up through the API; returns the new user and a `Cookie` header with their session. */
export async function signUp(baseUrl: string, account: Partial<SignUpRequest> = {}) {
  const response = await sendJson(`${baseUrl}/api/auth/signup`, 'POST', {
    name: 'Alex Morgan',
    email: 'alex@example.com',
    password: TEST_PASSWORD,
    ...account,
  });
  if (response.status !== 201) {
    throw new Error(`Sign-up failed with HTTP ${response.status}`);
  }
  const { user } = (await response.json()) as AuthResponse;
  return { user, cookie: sessionCookieFrom(response) };
}

/** Starts the app with real sessions and two signed-up accounts, for ownership tests. */
export async function startAppWithTwoAccounts() {
  const app = await startApp({ sessions: 'real' });
  const owner = await signUp(app.baseUrl, { name: 'Alex Morgan', email: 'alex@example.com' });
  const other = await signUp(app.baseUrl, { name: 'Sam Lee', email: 'sam@example.com' });
  return { ...app, owner, other };
}
