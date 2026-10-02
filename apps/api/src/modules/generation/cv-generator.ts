import type { Logger } from '../../lib/logger';
import type { GenerationInput } from './generation.input';
import type { JobFailure } from './generation.repository';

export interface GenerationHooks {
  /**
   * Aborted when the worker shuts down, loses the job or reaches the job's deadline; generators
   * must stop promptly and let the abort propagate (the worker decides what it means).
   */
  signal: AbortSignal;
  /** Reports the step being worked on (0-based, see `GENERATION_STEP_COUNT`). */
  onStep(step: number): Promise<void>;
  /** The job's logger (it carries the job id). Never log the user's sources or the CV itself. */
  log: Logger;
}

/**
 * What a generator produces: the CV and what it found missing or unclear in the sources. Both
 * are untrusted until the worker has validated them against the shared schemas.
 */
export interface GeneratedCv {
  content: unknown;
  issues: unknown;
}

/** Writes a CV from a generation input. */
export interface CvGenerator {
  generate(input: GenerationInput, hooks: GenerationHooks): Promise<GeneratedCv>;
}

/** An expected failure of a generator (see `JOB_FAILURES`), with a message the user can see. */
export class GenerationError extends Error {
  override name = 'GenerationError';

  readonly code: string;
  readonly userMessage: string;

  constructor(failure: JobFailure, options?: { cause?: unknown }) {
    super(failure.message, options);
    this.code = failure.code;
    this.userMessage = failure.message;
  }
}
