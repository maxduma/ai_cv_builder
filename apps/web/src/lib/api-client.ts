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

const networkError = () =>
  new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection.');

/** Turns a non-2xx response into an `ApiError`, using the API's error body when there is one. */
function toApiError(status: number, payload: unknown): ApiError {
  if (isApiErrorBody(payload)) {
    const { code, message, details } = payload.error;
    return new ApiError(status, code, message, details);
  }
  // No API error body: typically the dev proxy answering because the API is down or restarting.
  const message =
    status >= 500
      ? 'The server is not responding. Please try again in a moment.'
      : `Request failed (HTTP ${status})`;
  return new ApiError(status, 'HTTP_ERROR', message);
}

function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
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
    throw networkError();
  }

  const payload = parseJson(await response.text());
  if (!response.ok) {
    throw toApiError(response.status, payload);
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

export interface UploadOptions {
  signal?: AbortSignal;
  /** Share of the file sent so far, 0–1. */
  onProgress?: (fraction: number) => void;
  /** All bytes are sent; the server is now processing the file. */
  onSent?: () => void;
}

/**
 * Sends a file as `multipart/form-data` in the field `file`. Uses XMLHttpRequest because fetch
 * can't report upload progress. Rejects with an `AbortError` when `signal` aborts.
 */
function upload<T>(method: string, path: string, file: File, options: UploadOptions = {}) {
  return new Promise<T>((resolve, reject) => {
    const { signal, onProgress, onSent } = options;
    if (signal?.aborted) {
      reject(new DOMException('Upload cancelled', 'AbortError'));
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open(method, `/api${path}`);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.upload.onload = () => onSent?.();
    xhr.onload = () => {
      const payload = parseJson(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) resolve(payload as T);
      else reject(toApiError(xhr.status, payload));
    };
    xhr.onerror = () => reject(networkError());
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });

    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: (path: string) => request<void>('DELETE', path),
  /** PUT of a file, with upload progress. */
  upload: <T>(path: string, file: File, options?: UploadOptions) =>
    upload<T>('PUT', path, file, options),
};
