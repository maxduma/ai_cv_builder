import type { ApiErrorBody, ErrorCode } from '@cv-builder/shared';
import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../../lib/errors';

interface ErrorResponse {
  status: number;
  code: ErrorCode;
  message: string;
  details?: unknown;
}

/** Turns any thrown error into a consistent `ApiErrorBody` response. Must be registered last. */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const { status, code, message, details } = toErrorResponse(err);
  if (status >= 500) {
    req.log.error({ err }, 'Unhandled error');
  }

  const body: ApiErrorBody = { error: { code, message, details, requestId: String(req.id) } };
  res.status(status).json(body);
};

function toErrorResponse(err: unknown): ErrorResponse {
  if (err instanceof AppError) {
    return { status: err.status, code: err.code, message: err.message, details: err.details };
  }
  if (err instanceof ZodError) {
    return {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: err.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    };
  }
  // Errors raised by express.json() carry a `type`.
  if (hasType(err, 'entity.parse.failed')) {
    return { status: 400, code: 'INVALID_JSON', message: 'Request body is not valid JSON' };
  }
  if (hasType(err, 'entity.too.large')) {
    return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' };
  }
  return { status: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong' };
}

function hasType(err: unknown, type: string): boolean {
  return typeof err === 'object' && err !== null && 'type' in err && err.type === type;
}
