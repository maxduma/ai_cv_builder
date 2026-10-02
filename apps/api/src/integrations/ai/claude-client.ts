import Anthropic, {
  AnthropicError,
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  type ClientOptions,
} from '@anthropic-ai/sdk';
import type { Logger } from '../../lib/logger';

/**
 * How much Claude thinks before answering, and with it how long a CV takes. `medium` is Claude
 * Opus 5.5's default and fits the "about a minute" the UI promises; `high` is the knob to turn if
 * drafts fall short.
 */
const EFFORT = 'medium';

/**
 * Room for the answer and the adaptive thinking before it, which spends from the same budget. A
 * limit this high requires streaming.
 */
const MAX_TOKENS = 64_000;

/**
 * When a safety classifier declines the request, the API re-runs it on the model Anthropic
 * recommends for that kind of refusal instead of failing it; a benign CV in security or biology
 * can trip one. The parameter and its beta header only work as a pair. An organization without
 * the beta gets a 400 for every request, logged as an error with the API's reason.
 */
const SERVER_SIDE_FALLBACK = {
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default',
} satisfies Pick<Anthropic.Beta.Messages.MessageCreateParams, 'betas' | 'fallbacks'>;

export interface TextBlock {
  type: 'text';
  text: string;
}

/** A JSON schema the answer must follow (structured outputs). */
export interface JsonOutputFormat {
  type: 'json_schema';
  schema: Record<string, unknown>;
}

export type ClaudeStopReason = Anthropic.Beta.BetaStopReason;

export interface ClaudeRequest {
  /** Instructions; keep them byte-stable. */
  system: string;
  /** The single user turn. */
  content: TextBlock[];
  outputFormat: JsonOutputFormat;
  /** Aborting it ends the request with the SDK's abort error, unchanged: the caller knows why. */
  signal: AbortSignal;
  /** Awaited when the answer itself starts, after any thinking; an error it throws ends the request. */
  onTextStart?: () => Promise<void>;
  /** Where to log this request, e.g. a job's logger; the client's own by default. */
  log?: Logger;
}

export interface ClaudeResponse {
  /** Only `end_turn` means the answer is complete. */
  stopReason: ClaudeStopReason | null;
  /** The answer's text blocks joined in order; thinking and fallback markers are left out. */
  text: string;
  /** The model that wrote the answer: a fallback model when the requested one declined. */
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  requestId: string | null;
}

/** Sends one request to Claude and returns the finished answer. */
export interface ClaudeClient {
  complete(request: ClaudeRequest): Promise<ClaudeResponse>;
}

export type ClaudeErrorKind =
  'timeout' | 'rate_limited' | 'unavailable' | 'not_configured' | 'rejected';

/** A failed request, sorted into what the user can be told about it. */
export class ClaudeError extends Error {
  override name = 'ClaudeError';

  readonly kind: ClaudeErrorKind;
  /** The HTTP status, when the API answered with an error status. */
  readonly status: number | undefined;
  readonly requestId: string | null;
  /** The API's error type, e.g. `overloaded_error`. */
  readonly type: string | null;
  /**
   * The answer broke off: an error event arrived in the middle of the stream, or the stream itself
   * failed. The SDK retries failed requests, but not these.
   */
  readonly midStream: boolean;

  constructor(
    kind: ClaudeErrorKind,
    details: {
      status?: number;
      requestId?: string | null;
      type?: string | null;
      midStream?: boolean;
    },
    options?: ErrorOptions,
  ) {
    const status = details.status === undefined ? '' : `, HTTP ${details.status}`;
    super(`Claude request failed (${kind}${status})`, options);
    this.kind = kind;
    this.status = details.status;
    this.requestId = details.requestId ?? null;
    this.type = details.type ?? null;
    this.midStream = details.midStream ?? false;
  }
}

type StreamEvent = Anthropic.Beta.BetaRawMessageStreamEvent;

/** What this module reads from the SDK's message stream. */
export interface ClaudeMessageStream extends AsyncIterable<StreamEvent> {
  finalMessage(): Promise<
    Pick<Anthropic.Beta.BetaMessage, 'content' | 'model' | 'stop_reason' | 'stop_details'> & {
      usage: Pick<Anthropic.Beta.BetaUsage, 'input_tokens' | 'output_tokens'>;
    }
  >;
  readonly request_id: string | null | undefined;
}

/** The part of the SDK client this module uses; tests pass a fake. */
export interface ClaudeSdk {
  beta: {
    messages: {
      stream(
        params: Anthropic.Beta.Messages.MessageCreateParams,
        options: { signal: AbortSignal },
      ): ClaudeMessageStream;
    };
  };
}

interface Options {
  apiKey: string;
  model: string;
  logger: Logger;
}

/** The Claude client on the Anthropic SDK. */
export function createClaudeClient({ apiKey, model, logger }: Options): ClaudeClient {
  // The SDK retries connection errors, 408, 409, 429 and 5xx (twice, with backoff) and its
  // `timeout` only bounds the wait for response headers, so it stays at its default: the caller's
  // signal is the deadline.
  const sdk = new Anthropic({ apiKey, maxRetries: 2, logger: messagesOnly(logger) });
  return createClaudeClientWith({ sdk, model, logger });
}

/** `createClaudeClient` on a given SDK client. */
export function createClaudeClientWith({
  sdk,
  model,
  logger,
}: {
  sdk: ClaudeSdk;
  model: string;
  logger: Logger;
}): ClaudeClient {
  return {
    async complete({ system, content, outputFormat, signal, onTextStart, log = logger }) {
      const startedAt = performance.now();
      let stream: ClaudeMessageStream | undefined;

      try {
        stream = sdk.beta.messages.stream(
          {
            model,
            max_tokens: MAX_TOKENS,
            // Claude Opus 5.5 always thinks; effort sets how much.
            thinking: { type: 'adaptive' },
            // Never a format that carries `parse`: the SDK would parse each text block on its own.
            output_config: {
              effort: EFFORT,
              format: { type: outputFormat.type, schema: outputFormat.schema },
            },
            // No prompt caching: requests share only the short system prompt, so a cache hit would
            // save well under a cent, and caching the sources, which differ every time, would only
            // add the cost of writing them.
            system,
            messages: [{ role: 'user', content }],
            ...SERVER_SIDE_FALLBACK,
          },
          { signal },
        );

        let textStarted = false;
        for await (const event of stream) {
          // Awaited inside the loop, so an error it throws (e.g. the job was lost) ends the request
          // here instead of becoming an unhandled rejection.
          if (
            !textStarted &&
            event.type === 'content_block_start' &&
            event.content_block.type === 'text'
          ) {
            textStarted = true;
            await onTextStart?.();
          }
        }
        const message = await stream.finalMessage();

        // After a fallback, the next model continues the declined model's partial answer, so the
        // answer is all text blocks together.
        const text = message.content
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join('');
        const response: ClaudeResponse = {
          stopReason: message.stop_reason,
          text,
          model: message.model,
          usage: {
            inputTokens: message.usage.input_tokens,
            outputTokens: message.usage.output_tokens,
          },
          requestId: stream.request_id ?? null,
        };
        log.info(
          {
            model: response.model,
            stopReason: response.stopReason,
            refusalCategory: message.stop_details?.category,
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
            durationMs: Math.round(performance.now() - startedAt),
            requestId: response.requestId,
          },
          'Claude answered',
        );
        return response;
      } catch (error) {
        // An abort (deadline, shutdown, lost job) is the caller's to interpret.
        if (signal.aborted) throw error;

        const failure = toClaudeError(error, stream?.request_id ?? null);
        if (!failure) throw error;

        const details = {
          kind: failure.kind,
          status: failure.status,
          type: failure.type,
          midStream: failure.midStream,
          requestId: failure.requestId,
          durationMs: Math.round(performance.now() - startedAt),
        };
        if (failure.kind === 'not_configured' || failure.kind === 'rejected') {
          // Needs someone to act (key, billing, model name, beta access): the API says what.
          const apiMessage = error instanceof APIError ? error.message : undefined;
          log.error({ ...details, apiMessage }, 'Claude rejected the request');
        } else {
          log.warn(details, 'Claude request failed');
        }
        throw failure;
      }
    },
  };
}

/**
 * Sorts an SDK error, or returns undefined for errors that aren't the API's to explain: the
 * caller's own (an `onTextStart` that threw) and an abort that didn't come from the signal.
 */
function toClaudeError(error: unknown, streamRequestId: string | null): ClaudeError | undefined {
  if (!(error instanceof AnthropicError) || error instanceof APIUserAbortError) return undefined;

  // A subclass of APIConnectionError, so it comes first.
  if (error instanceof APIConnectionTimeoutError) {
    return new ClaudeError('timeout', {}, { cause: error });
  }
  if (error instanceof APIConnectionError) {
    return new ClaudeError('unavailable', {}, { cause: error });
  }
  if (error instanceof APIError) {
    const requestId = error.requestID ?? streamRequestId;
    // No status: an error event in the middle of the stream.
    if (error.status === undefined) {
      const kind = error.type === 'rate_limit_error' ? 'rate_limited' : 'unavailable';
      return new ClaudeError(
        kind,
        { requestId, type: error.type, midStream: true },
        { cause: error },
      );
    }
    return new ClaudeError(
      kindOfStatus(error.status),
      { status: error.status, requestId, type: error.type },
      { cause: error },
    );
  }
  // Any other SDK error comes from the stream itself, e.g. a connection that dropped mid-answer.
  // Its message isn't kept: one wrapping a malformed event quotes the event, i.e. model output.
  return new ClaudeError('unavailable', { requestId: streamRequestId, midStream: true });
}

function kindOfStatus(status: number): ClaudeErrorKind {
  // Bad key, billing, no access, unknown model.
  if (status === 401 || status === 402 || status === 403 || status === 404) return 'not_configured';
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'unavailable';
  // 400, 413, 422: the request itself, e.g. a beta this organization doesn't have.
  return 'rejected';
}

/**
 * Routes the SDK's own log lines into ours, without their details: at debug level those are
 * request bodies (the user's sources), and a malformed stream event is logged with its data.
 */
function messagesOnly(logger: Logger): ClientOptions['logger'] {
  return {
    error: (message) => logger.error(message),
    warn: (message) => logger.warn(message),
    info: (message) => logger.info(message),
    debug: (message) => logger.debug(message),
  };
}
