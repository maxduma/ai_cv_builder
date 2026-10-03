import type { JobFailure } from './generation.repository';

/**
 * Every way a generation job can fail, with the message the user sees. The CV's page shows the
 * message in the failed step and the code as "Ref. <code>", so messages say what happened and what
 * to try, and nothing internal.
 */
export const JOB_FAILURES = {
  invalidInput: {
    code: 'INVALID_INPUT',
    message: 'The saved details for this CV couldn’t be read. Edit them and try again.',
  },
  /** The worker's own check of a generator's result failed (a backstop; see the worker). */
  invalidOutput: {
    code: 'INVALID_OUTPUT',
    message: 'The AI returned a CV we couldn’t use. Try again.',
  },
  internal: {
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong while writing your CV. Try again.',
  },
  workerLost: {
    code: 'WORKER_LOST',
    message: 'Generation stopped unexpectedly. Your details are saved, so you can try again.',
  },

  // Claude
  aiTimeout: {
    code: 'AI_TIMEOUT',
    message: 'The AI service didn’t respond in time.',
  },
  aiRateLimited: {
    code: 'AI_RATE_LIMITED',
    message: 'The AI service is busy right now. Wait a minute, then try again.',
  },
  aiUnavailable: {
    code: 'AI_UNAVAILABLE',
    message: 'The AI service isn’t available right now. Try again in a few minutes.',
  },
  aiNotConfigured: {
    code: 'AI_NOT_CONFIGURED',
    message: 'CV generation isn’t available right now. Try again later.',
  },
  aiRequestRejected: {
    code: 'AI_REQUEST_REJECTED',
    message:
      'The AI service rejected this request. If your description or PDF is very long, shorten it; otherwise try again later.',
  },
  aiRefused: {
    code: 'AI_REFUSED',
    message: 'The AI couldn’t write a CV from these details. Edit them and try again.',
  },
  aiOutputTruncated: {
    code: 'AI_OUTPUT_TRUNCATED',
    message: 'Your CV came out too long to finish. Try a shorter description or PDF.',
  },
  aiInvalidJson: {
    code: 'AI_INVALID_JSON',
    message: 'The AI returned a CV we couldn’t use. Try again.',
  },
  aiSchemaMismatch: {
    code: 'AI_SCHEMA_MISMATCH',
    message: 'The AI returned a CV we couldn’t use. Try again.',
  },

  // Answers (the web shows its own copy for a failed answer, and these codes as a reference)
  /** The changes an answer led to break the CV's rules; nothing was written. */
  aiInvalidUpdate: {
    code: 'AI_INVALID_UPDATE',
    message:
      'The AI’s update didn’t pass our checks, so your CV wasn’t changed. Try rephrasing your answer.',
  },
} satisfies Record<string, JobFailure>;
