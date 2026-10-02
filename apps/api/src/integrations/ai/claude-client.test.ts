import Anthropic, {
  AnthropicError,
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from '@anthropic-ai/sdk';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import {
  type ClaudeMessageStream,
  type ClaudeRequest,
  type ClaudeSdk,
  ClaudeError,
  createClaudeClientWith,
} from './claude-client';

type StreamEvent = Anthropic.Beta.BetaRawMessageStreamEvent;
type ContentBlock = Extract<StreamEvent, { type: 'content_block_start' }>['content_block'];
type FinalMessage = Awaited<ReturnType<ClaudeMessageStream['finalMessage']>>;

const MODEL = 'claude-opus-5-5';
const SCHEMA = { type: 'object', properties: {}, required: [], additionalProperties: false };

const text = (value: string): ContentBlock => ({ type: 'text', text: value, citations: null });
const thinking: ContentBlock = { type: 'thinking', thinking: '', signature: 'sig' };
const fallback: ContentBlock = {
  type: 'fallback',
  from: { model: MODEL },
  to: { model: 'claude-opus-5' },
  trigger: { type: 'refusal', category: 'cyber' },
};
const blockStart = (block: ContentBlock, index: number): StreamEvent => ({
  type: 'content_block_start',
  index,
  content_block: block,
});

const ANSWER: FinalMessage = {
  content: [thinking, text('{"ok":true}')],
  model: MODEL,
  stop_reason: 'end_turn',
  stop_details: null,
  usage: { input_tokens: 1_200, output_tokens: 800 },
};

/** A stand-in for the SDK: one stream that yields `events`, then fails with `error` if given. */
function fakeSdk({
  events = [blockStart(thinking, 0), blockStart(text(''), 1)],
  error,
  message = ANSWER,
}: { events?: StreamEvent[]; error?: unknown; message?: FinalMessage } = {}) {
  const calls: Parameters<ClaudeSdk['beta']['messages']['stream']>[] = [];
  const sdk: ClaudeSdk = {
    beta: {
      messages: {
        stream(...args) {
          calls.push(args);
          return {
            request_id: 'req_stream',
            async *[Symbol.asyncIterator]() {
              yield* events;
              if (error !== undefined) throw error;
            },
            async finalMessage() {
              return message;
            },
          };
        },
      },
    },
  };
  return { sdk, calls };
}

function capturingLogger() {
  const lines: Record<string, unknown>[] = [];
  const logger = pino(
    { level: 'debug' },
    { write: (line: string) => lines.push(JSON.parse(line) as Record<string, unknown>) },
  );
  return { logger, lines };
}

const silent = pino({ level: 'silent' });

function request(overrides: Partial<ClaudeRequest> = {}): ClaudeRequest {
  return {
    system: 'You write CVs.',
    content: [{ type: 'text', text: '<source_material>Jane Doe, Northpay</source_material>' }],
    outputFormat: { type: 'json_schema', schema: SCHEMA },
    signal: new AbortController().signal,
    ...overrides,
  };
}

/** The headers of an API response, with the request id the SDK reads. */
const apiHeaders = (requestId = 'req_api') => new Headers({ 'request-id': requestId });
const apiBody = (type: string) => ({ type: 'error', error: { type, message: `${type} message` } });

describe('Claude client', () => {
  it('streams one request shaped for Claude Opus 5.5', async () => {
    const { sdk, calls } = fakeSdk();
    const signal = new AbortController().signal;
    const content = request().content;
    // A helper's format carries `parse`; it must never reach the SDK.
    const outputFormat = { type: 'json_schema' as const, schema: SCHEMA, parse: JSON.parse };

    await createClaudeClientWith({ sdk, model: MODEL, logger: silent }).complete(
      request({ system: 'Static instructions', content, outputFormat, signal }),
    );

    expect(calls).toHaveLength(1);
    const [params, options] = calls[0]!;
    expect(params).toEqual({
      model: MODEL,
      max_tokens: 64_000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: 'Static instructions',
      messages: [{ role: 'user', content }],
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    expect(params).not.toHaveProperty('cache_control');
    expect(options.signal).toBe(signal);
  });

  it('returns the answer’s text blocks joined, and the model that wrote them', async () => {
    const { sdk } = fakeSdk({
      message: {
        // The requested model declined midway; the fallback model continued its partial answer.
        content: [thinking, text('{"summary":"Back'), fallback, thinking, text('end engineer"}')],
        model: 'claude-opus-5',
        stop_reason: 'end_turn',
        stop_details: null,
        usage: { input_tokens: 10, output_tokens: 20 },
      },
    });

    const response = await createClaudeClientWith({ sdk, model: MODEL, logger: silent }).complete(
      request(),
    );

    expect(response).toEqual({
      stopReason: 'end_turn',
      text: '{"summary":"Backend engineer"}',
      model: 'claude-opus-5',
      usage: { inputTokens: 10, outputTokens: 20 },
      requestId: 'req_stream',
    });
  });

  it('reports the start of the answer once', async () => {
    const events = [
      blockStart(thinking, 0),
      blockStart(text(''), 1),
      blockStart(fallback, 2),
      blockStart(text(''), 3),
    ];
    const { sdk } = fakeSdk({ events });
    const onTextStart = vi.fn(async () => {});

    await createClaudeClientWith({ sdk, model: MODEL, logger: silent }).complete(
      request({ onTextStart }),
    );

    expect(onTextStart).toHaveBeenCalledTimes(1);
  });

  it('doesn’t take thinking or a fallback marker for the start of the answer', async () => {
    const { sdk } = fakeSdk({
      events: [blockStart(thinking, 0), blockStart(fallback, 1)],
      message: { ...ANSWER, content: [thinking, fallback], stop_reason: 'refusal' },
    });
    const onTextStart = vi.fn(async () => {});

    const response = await createClaudeClientWith({ sdk, model: MODEL, logger: silent }).complete(
      request({ onTextStart }),
    );

    expect(onTextStart).not.toHaveBeenCalled();
    expect(response).toMatchObject({ stopReason: 'refusal', text: '' });
  });

  it('ends the request with the error `onTextStart` throws, unchanged', async () => {
    const lost = new Error('lease lost');
    const { sdk } = fakeSdk();

    const result = createClaudeClientWith({ sdk, model: MODEL, logger: silent }).complete(
      request({ onTextStart: () => Promise.reject(lost) }),
    );

    await expect(result).rejects.toBe(lost);
  });

  describe('sorts failures', () => {
    const statusError = (status: number, type: string) =>
      APIError.generate(status, apiBody(type), undefined, apiHeaders());
    /** An error event in the middle of the stream, as the SDK reports it. */
    const eventError = (type: Anthropic.ErrorType) =>
      new APIError(undefined, apiBody(type), undefined, apiHeaders(), type);

    const cases: [string, AnthropicError, Partial<ClaudeError>][] = [
      ['a connection timeout', new APIConnectionTimeoutError(), { kind: 'timeout' }],
      ['a connection error', new APIConnectionError({}), { kind: 'unavailable', midStream: false }],
      ...[401, 402, 403, 404].map((status): [string, AnthropicError, Partial<ClaudeError>] => [
        `HTTP ${status}`,
        statusError(status, 'authentication_error'),
        { kind: 'not_configured', status, requestId: 'req_api' },
      ]),
      ...[400, 413, 422].map((status): [string, AnthropicError, Partial<ClaudeError>] => [
        `HTTP ${status}`,
        statusError(status, 'invalid_request_error'),
        { kind: 'rejected', status, requestId: 'req_api' },
      ]),
      [
        'HTTP 429',
        statusError(429, 'rate_limit_error'),
        { kind: 'rate_limited', status: 429, type: 'rate_limit_error', midStream: false },
      ],
      ...[500, 529].map((status): [string, AnthropicError, Partial<ClaudeError>] => [
        `HTTP ${status}`,
        statusError(status, 'overloaded_error'),
        { kind: 'unavailable', status, midStream: false },
      ]),
      [
        'an overloaded event mid-stream',
        eventError('overloaded_error'),
        { kind: 'unavailable', type: 'overloaded_error', midStream: true, requestId: 'req_api' },
      ],
      [
        'a rate limit event mid-stream',
        eventError('rate_limit_error'),
        { kind: 'rate_limited', type: 'rate_limit_error', midStream: true },
      ],
      [
        'a stream that broke off',
        new AnthropicError('terminated'),
        { kind: 'unavailable', midStream: true, requestId: 'req_stream' },
      ],
    ];

    it.each(cases)('%s', async (_, sdkError, expected) => {
      const { sdk } = fakeSdk({ error: sdkError });

      const result = createClaudeClientWith({ sdk, model: MODEL, logger: silent }).complete(
        request(),
      );

      await expect(result).rejects.toBeInstanceOf(ClaudeError);
      await expect(result).rejects.toMatchObject(expected);
    });

    it('keeps the SDK’s error as the cause', async () => {
      const sdkError = statusError(529, 'overloaded_error');
      const { sdk } = fakeSdk({ error: sdkError });

      const result = createClaudeClientWith({ sdk, model: MODEL, logger: silent }).complete(
        request(),
      );

      await expect(result).rejects.toMatchObject({ cause: sdkError });
    });
  });

  describe('passes through unchanged', () => {
    it('whatever ends a request whose signal was aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      // Even an API error: the caller decides what the abort meant.
      for (const sdkError of [
        new APIUserAbortError(),
        APIError.generate(529, apiBody('overloaded_error'), undefined, apiHeaders()),
      ]) {
        const { sdk } = fakeSdk({ error: sdkError });

        const result = createClaudeClientWith({ sdk, model: MODEL, logger: silent }).complete(
          request({ signal: controller.signal }),
        );

        await expect(result).rejects.toBe(sdkError);
      }
    });

    it('an abort that didn’t come from the signal', async () => {
      const sdkError = new APIUserAbortError();
      const { sdk } = fakeSdk({ error: sdkError });

      const result = createClaudeClientWith({ sdk, model: MODEL, logger: silent }).complete(
        request(),
      );

      await expect(result).rejects.toBe(sdkError);
    });

    it('errors that aren’t the SDK’s', async () => {
      const bug = new TypeError('not a function');
      const { sdk } = fakeSdk({ error: bug });

      const result = createClaudeClientWith({ sdk, model: MODEL, logger: silent }).complete(
        request(),
      );

      await expect(result).rejects.toBe(bug);
    });
  });

  describe('logs', () => {
    it('each answer, without its text', async () => {
      const { logger, lines } = capturingLogger();
      const { sdk } = fakeSdk();

      await createClaudeClientWith({ sdk, model: MODEL, logger }).complete(request());

      expect(lines).toEqual([
        expect.objectContaining({
          level: 30,
          msg: 'Claude answered',
          model: MODEL,
          stopReason: 'end_turn',
          inputTokens: 1_200,
          outputTokens: 800,
          requestId: 'req_stream',
          durationMs: expect.any(Number),
        }),
      ]);
      const logged = JSON.stringify(lines);
      expect(logged).not.toContain('"ok":true');
      expect(logged).not.toContain('Northpay');
    });

    it('requests the API rejected as errors, with the API’s reason', async () => {
      const { logger, lines } = capturingLogger();
      const { sdk } = fakeSdk({
        error: APIError.generate(400, apiBody('invalid_request_error'), undefined, apiHeaders()),
      });

      await createClaudeClientWith({ sdk, model: MODEL, logger })
        .complete(request())
        .catch(() => {});

      expect(lines).toEqual([
        expect.objectContaining({
          level: 50,
          msg: 'Claude rejected the request',
          kind: 'rejected',
          status: 400,
          requestId: 'req_api',
          apiMessage: expect.stringContaining('invalid_request_error message'),
        }),
      ]);
    });

    it('to the request’s own logger when it has one', async () => {
      const own = capturingLogger();
      const client = capturingLogger();
      const { sdk } = fakeSdk();

      await createClaudeClientWith({ sdk, model: MODEL, logger: client.logger }).complete(
        request({ log: own.logger }),
      );

      expect(own.lines).toHaveLength(1);
      expect(client.lines).toHaveLength(0);
    });
  });
});

/** Server-sent events as the Messages API streams them. */
function sse(events: { type: string; [key: string]: unknown }[]): string {
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
}

const MESSAGE_START = {
  type: 'message_start',
  message: {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: MODEL,
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 2_000, output_tokens: 1 },
  },
};
const sseBlock = (index: number, block: ContentBlock, delta?: string) => [
  { type: 'content_block_start', index, content_block: block },
  ...(delta === undefined
    ? []
    : [{ type: 'content_block_delta', index, delta: { type: 'text_delta', text: delta } }]),
  { type: 'content_block_stop', index },
];
const MESSAGE_END = [
  {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 900 },
  },
  { type: 'message_stop' },
];

/** The real SDK over a fake `fetch`, so the request on the wire and the SDK's stream are real. */
function realSdk(respond: (init: RequestInit) => Response | Promise<Response>) {
  const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const sdk = new Anthropic({
    apiKey: 'sk-test',
    maxRetries: 0,
    fetch: async (url, init = {}) => {
      requests.push({
        url: String(url),
        headers: new Headers(init.headers),
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      });
      return respond(init);
    },
  });
  return { sdk, requests };
}

const streamed = (events: { type: string; [key: string]: unknown }[]) => () =>
  new Response(sse(events), {
    headers: { 'content-type': 'text/event-stream', 'request-id': 'req_wire' },
  });

describe('Claude client on the real SDK', () => {
  it('sends the fallback beta as a header and the rest in the body', async () => {
    const { sdk, requests } = realSdk(
      streamed([MESSAGE_START, ...sseBlock(0, text(''), '{}'), ...MESSAGE_END]),
    );

    await createClaudeClientWith({ sdk, model: MODEL, logger: silent }).complete(request());

    expect(requests).toHaveLength(1);
    const [sent] = requests;
    expect(sent?.url).toContain('/v1/messages?beta=true');
    expect(sent?.headers.get('anthropic-beta')).toBe('server-side-fallback-2026-07-01');
    expect(sent?.body).toMatchObject({
      stream: true,
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    });
    expect(sent?.body).not.toHaveProperty('betas');
  });

  it('reads a streamed answer that a fallback model finished', async () => {
    const onTextStart = vi.fn(async () => {});
    const { sdk } = realSdk(
      streamed([
        MESSAGE_START,
        ...sseBlock(0, { type: 'thinking', thinking: '', signature: '' }),
        ...sseBlock(1, text(''), '{"a":'),
        ...sseBlock(2, fallback),
        ...sseBlock(3, text(''), '1}'),
        ...MESSAGE_END,
      ]),
    );

    const response = await createClaudeClientWith({ sdk, model: MODEL, logger: silent }).complete(
      request({ onTextStart }),
    );

    expect(response).toEqual({
      stopReason: 'end_turn',
      text: '{"a":1}',
      model: 'claude-opus-5',
      usage: { inputTokens: 2_000, outputTokens: 900 },
      requestId: 'req_wire',
    });
    expect(onTextStart).toHaveBeenCalledTimes(1);
  });

  it('sorts an error event in the middle of the stream', async () => {
    const { sdk } = realSdk(
      streamed([
        MESSAGE_START,
        ...sseBlock(0, text(''), '{"a":'),
        { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
      ]),
    );

    const result = createClaudeClientWith({ sdk, model: MODEL, logger: silent }).complete(
      request(),
    );

    await expect(result).rejects.toMatchObject({
      kind: 'unavailable',
      midStream: true,
      type: 'overloaded_error',
      requestId: 'req_wire',
    });
  });

  it('sorts an error status', async () => {
    const { sdk } = realSdk(
      () =>
        new Response(JSON.stringify(apiBody('authentication_error')), {
          status: 401,
          headers: { 'content-type': 'application/json', 'request-id': 'req_401' },
        }),
    );

    const result = createClaudeClientWith({ sdk, model: MODEL, logger: silent }).complete(
      request(),
    );

    await expect(result).rejects.toMatchObject({
      kind: 'not_configured',
      status: 401,
      requestId: 'req_401',
    });
  });

  it('passes the SDK’s abort error through when the signal aborts', async () => {
    const controller = new AbortController();
    const { sdk } = realSdk(
      (init) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('This operation was aborted', 'AbortError')),
          );
          controller.abort();
        }),
    );

    const result = createClaudeClientWith({ sdk, model: MODEL, logger: silent }).complete(
      request({ signal: controller.signal }),
    );

    await expect(result).rejects.toBeInstanceOf(APIUserAbortError);
  });

  it('stops the stream when `onTextStart` throws, without unhandled rejections', async () => {
    const lost = new Error('lease lost');
    const { sdk } = realSdk(
      streamed([MESSAGE_START, ...sseBlock(0, text(''), '{"a":1}'), ...MESSAGE_END]),
    );

    const result = createClaudeClientWith({ sdk, model: MODEL, logger: silent }).complete(
      request({ onTextStart: () => Promise.reject(lost) }),
    );

    await expect(result).rejects.toBe(lost);
  });
});
