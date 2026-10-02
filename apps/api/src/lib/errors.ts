import type { ErrorCode } from '@cv-builder/shared';

/** An error that maps directly to an HTTP error response (see http/middleware/error-handler.ts). */
export class AppError extends Error {
  override name = 'AppError';

  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export class NotFoundError extends AppError {
  override name = 'NotFoundError';

  constructor(message = 'Resource not found') {
    super(404, 'NOT_FOUND', message);
  }
}

export class UnauthorizedError extends AppError {
  override name = 'UnauthorizedError';

  constructor(message = 'Authentication required') {
    super(401, 'UNAUTHORIZED', message);
  }
}
