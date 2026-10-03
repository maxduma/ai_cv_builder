import type { z } from 'zod';
import {
  type ClaudeClient,
  ClaudeError,
  type ClaudeErrorKind,
  type ClaudeRequest,
  type ClaudeResponse,
} from '../../../integrations/ai/claude-client';
import type { Logger } from '../../../lib/logger';
import { GenerationError } from '../cv-generator';
import { JOB_FAILURES } from '../generation.failures';
import type { JobFailure } from '../generation.repository';

/** The first request, plus one more if its answer was unusable or broke off midway. */
const MAX_REQUESTS = 2;

const FAILURE_BY_KIND: Record<ClaudeErrorKind, JobFailure> = {
  timeout: JOB_FAILURES.aiTimeout,
  rate_limited: JOB_FAILURES.aiRateLimited,
  unavailable: JOB_FAILURES.aiUnavailable,
  not_configured: JOB_FAILURES.aiNotConfigured,
  rejected: JOB_FAILURES.aiRequestRejected,
};

/** A request that didn't produce a usable answer, and whether asking once more may help. */
export interface Unusable {
  ok: false;
  failure: JobFailure;
  retry: boolean;
  cause?: ClaudeError;
}

export type Attempt<T> = { ok: true; value: T } | Unusable;

/**
 * Sends one request and reads its answer as JSON matching `schema`. What goes wrong on Claude's
 * side or in its answer comes back as `Unusable`; other errors propagate unchanged, and so does
 * every error once the request's signal is aborted (the caller knows whether that was a deadline,
 * a shutdown or a lost job).
 */
export async function requestStructured<T>(
  client: ClaudeClient,
  request: ClaudeRequest,
  read: ReadOptions<T>,
): Promise<Attempt<T>> {
  let answer: ClaudeResponse;
  try {
    answer = await client.complete(request);
  } catch (error) {
    if (request.signal.aborted || !(error instanceof ClaudeError)) throw error;
    const retry = error.midStream && error.kind === 'unavailable';
    return { ok: false, failure: FAILURE_BY_KIND[error.kind], retry, cause: error };
  }
  await read.onAnswer?.();
  return readStructured(answer, read, request.log);
}

interface ReadOptions<T> {
  schema: z.ZodType<T>;
  /** Applied to the parsed JSON before the schema checks it. */
  prepare?: (json: unknown) => unknown;
  /** Names the schema in logs, e.g. "CV". */
  what: string;
  /** Awaited once a finished answer has arrived, before it is read. */
  onAnswer?: () => Promise<void>;
}

function readStructured<T>(
  answer: ClaudeResponse,
  { schema, prepare = (json) => json, what }: ReadOptions<T>,
  log: Logger | undefined,
): Attempt<T> {
  switch (answer.stopReason) {
    case 'end_turn':
      break;
    case 'refusal':
      return { ok: false, failure: JOB_FAILURES.aiRefused, retry: false };
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return { ok: false, failure: JOB_FAILURES.aiOutputTruncated, retry: false };
    default:
      // Not expected from these requests (no tools, stop sequences or pauses), and not a finished
      // answer; asking again would most likely end the same way.
      log?.warn({ stopReason: answer.stopReason }, 'Claude stopped for an unexpected reason');
      return { ok: false, failure: JOB_FAILURES.aiInvalidJson, retry: false };
  }

  let json: unknown;
  try {
    json = JSON.parse(answer.text);
  } catch (error) {
    // V8's message quotes the text around the error, i.e. the CV: only the name is logged.
    const name = error instanceof Error ? error.name : typeof error;
    log?.warn({ error: name, length: answer.text.length }, 'Claude answer is not valid JSON');
    return { ok: false, failure: JOB_FAILURES.aiInvalidJson, retry: true };
  }

  const parsed = schema.safeParse(prepare(json));
  if (!parsed.success) {
    // Where and what kind of mismatch, never the values: they are the CV.
    const mismatches = parsed.error.issues.map(
      (issue) => `${issue.path.map(String).join('.')}: ${issue.code}`,
    );
    log?.warn(
      { mismatches: mismatches.slice(0, 10), count: mismatches.length },
      `Claude answer does not match the ${what} schema`,
    );
    return { ok: false, failure: JOB_FAILURES.aiSchemaMismatch, retry: true };
  }
  return { ok: true, value: parsed.data };
}

/**
 * Runs `attempt` and, if its answer is unusable in a way that asking again may fix, runs it once
 * more. The last failure becomes a `GenerationError` with a message for the user.
 */
export async function withOneRetry<T>(
  log: Logger,
  attempt: (attemptLog: Logger) => Promise<Attempt<T>>,
): Promise<T> {
  for (let number = 1; ; number += 1) {
    const attemptLog = log.child({ aiAttempt: number });
    const result = await attempt(attemptLog);
    if (result.ok) return result.value;
    if (!result.retry || number === MAX_REQUESTS) {
      throw new GenerationError(result.failure, { cause: result.cause });
    }
    attemptLog.warn({ code: result.failure.code }, 'Asking Claude again');
  }
}
