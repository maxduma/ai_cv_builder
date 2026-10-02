import type { ApiErrorBody, ErrorCode } from '@cv-builder/shared';

/** Error codes produced on the client when there is no API error body to read. */
type ClientErrorCode = 'NETWORK_ERROR' | 'HTTP_ERROR';

export class ApiError extends Error {
  override name = 'ApiError';

  constructor(
    /** HTTP status, or 0 when the server could not be reached. */
    readonly status: number,
    readonly code: ErrorCode | ClientErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/**
 * Calls the API with a path relative to `/api`. Requests stay same-origin; the dev server
 * proxies them to the backend. Throws `ApiError` for network failures and non-2xx responses.
 */
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection.');
  }

  const payload: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    if (isApiErrorBody(payload)) {
      const { code, message, details } = payload.error;
      throw new ApiError(response.status, code, message, details);
    }
    // No API error body: typically the dev proxy answering because the API is down or restarting.
    const message =
      response.status >= 500
        ? 'The server is not responding. Please try again in a moment.'
        : `Request failed (HTTP ${response.status})`;
    throw new ApiError(response.status, 'HTTP_ERROR', message);
  }

  return payload as T;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof value.error === 'object' &&
    value.error !== null &&
    'message' in value.error
  );
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
};
