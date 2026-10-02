import type { GenerationInput } from './generation.input';

export interface GenerationHooks {
  /** Aborted when the worker shuts down or loses the job; generators must stop promptly. */
  signal: AbortSignal;
  /** Reports the step being worked on (0-based, see `GENERATION_STEP_COUNT`). */
  onStep(step: number): Promise<void>;
}

/**
 * Writes a CV from a generation input. The result is untrusted until the worker has validated
 * it against the shared content schema, so it is typed as `unknown`.
 */
export interface CvGenerator {
  generate(input: GenerationInput, hooks: GenerationHooks): Promise<unknown>;
}

/** An expected failure of a generator, with a message that can be shown to the user. */
export class GenerationError extends Error {
  override name = 'GenerationError';

  constructor(
    readonly code: string,
    readonly userMessage: string,
  ) {
    super(userMessage);
  }
}
