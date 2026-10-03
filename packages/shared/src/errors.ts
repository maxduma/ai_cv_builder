/** Machine-readable codes the API uses in error responses. */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'INVALID_JSON',
  'PAYLOAD_TOO_LARGE',
  'UNAUTHORIZED',
  'NOT_FOUND',
  'INTERNAL_ERROR',
  // Authentication
  'INVALID_CREDENTIALS',
  'EMAIL_TAKEN',
  // Source PDF uploads
  'FILE_TOO_LARGE',
  'UNSUPPORTED_FILE_TYPE',
  'PDF_UNREADABLE',
  'PDF_NO_TEXT',
  'PDF_TOO_MANY_PAGES',
  'PDF_TOO_MUCH_TEXT',
  // CV generation
  'CV_NOT_READY',
  'GENERATION_IN_PROGRESS',
  'CV_ALREADY_GENERATED',
  // Editing
  'CV_NOT_GENERATED',
  'CONTENT_CONFLICT',
  // Questions
  'QUESTION_BUSY',
  'QUESTION_CLOSED',
  // PDF export
  'PDF_RENDER_FAILED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Body of every error response returned by the API. */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}
