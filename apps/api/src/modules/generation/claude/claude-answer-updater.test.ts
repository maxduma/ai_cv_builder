import { type CvContent, CvContentSchema, GENERATION_ISSUE_SECTIONS } from '@cv-builder/shared';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import {
  type ClaudeClient,
  ClaudeError,
  type ClaudeRequest,
  type ClaudeResponse,
} from '../../../integrations/ai/claude-client';
import type { AnswerHooks, AnswerRequest } from '../answers/answer-input';
import {
  ANSWER_UPDATE_FORMATS,
  type AnswerSection,
  type AnswerUpdate,
  type RoleChanges,
} from '../answers/answer-update.schema';
import { GenerationError } from '../cv-generator';
import { JOB_FAILURES } from '../generation.failures';
import { ANSWER_SYSTEM_PROMPT, buildAnswerContent } from './answer-prompt';
import { createClaudeAnswerUpdater } from './claude-answer-updater';

const CV: CvContent = CvContentSchema.parse({
  version: 1,
  contact: {
    firstName: 'Jane',
    lastName: 'Doe',
    headline: 'Backend Engineer',
    email: 'jane.doe@example.com',
    phone: '+351 912 345 678',
    location: 'Lisbon',
    workSetup: '',
    links: [{ id: 'link-1', label: 'LinkedIn', url: 'https://www.linkedin.com/in/janedoe/' }],
  },
  summary: 'Backend engineer who built a payments ledger in Go and PostgreSQL at Northpay.',
  experience: [
    {
      id: 'experience-1',
      title: 'Backend Engineer',
      company: 'Northpay',
      location: 'Lisbon',
      start: '2021',
      end: '',
      current: true,
      bullets: [
        { id: 'experience-1-bullet-1', text: 'Built the payments ledger in Go and PostgreSQL.' },
      ],
    },
  ],
  education: [],
  skills: [{ id: 'skill-1', name: 'Go' }],
});

const REQUEST: AnswerRequest = {
  targetRole: 'Senior Backend Engineer',
  question: {
    section: 'experience',
    kind: 'incomplete',
    target: 'Experience · Northpay',
    itemId: 'experience-1',
    question: 'How many payments a day does the ledger handle?',
    why: 'Scale shows the size of systems you can own as a senior engineer.',
  },
  answer: 'About 2 million payments a day, mostly card settlements.',
  followUp: null,
  previousAnswer: null,
  cv: CV,
};

/** The role's changes for `REQUEST`: the answer folded into its bullet. */
const ROLE: RoleChanges = {
  id: 'experience-1',
  title: '',
  company: '',
  location: '',
  start: '',
  end: '',
  current: 'keep',
  editBullets: [
    {
      id: 'experience-1-bullet-1',
      text: 'Built the payments ledger in Go and PostgreSQL, handling 2 million payments a day.',
    },
  ],
  addBullets: [],
};

const UPDATE = { followUp: '', experience: [ROLE] } satisfies AnswerUpdate;

/** An update for `section` that changes nothing, asking `followUp` if given. */
function unchanged(section: AnswerSection, followUp = ''): AnswerUpdate {
  switch (section) {
    case 'contact':
      return {
        followUp,
        contact: {
          firstName: '',
          lastName: '',
          headline: '',
          email: '',
          phone: '',
          location: '',
          workSetup: '',
          addLinks: [],
        },
      };
    case 'summary':
      return { followUp, summary: '' };
    case 'experience':
      return { followUp, experience: [] };
    case 'education':
      return { followUp, education: [] };
    case 'skills':
      return { followUp, addSkills: [] };
    case 'general':
      return { followUp, summary: '', addSkills: [] };
  }
}

/** A request about `section`, about no entry in particular. */
function about(section: AnswerSection): AnswerRequest {
  return { ...REQUEST, question: { ...REQUEST.question, section, itemId: null } };
}

/** Claude's answer: `value` as JSON text (or the text itself), finished normally by default. */
function answer(value: unknown, overrides: Partial<ClaudeResponse> = {}): ClaudeResponse {
  return {
    stopReason: 'end_turn',
    text: typeof value === 'string' ? value : JSON.stringify(value),
    model: 'claude-opus-5-5',
    usage: { inputTokens: 2_000, outputTokens: 300 },
    requestId: 'req_1',
    ...overrides,
  };
}

/** One of the client's replies: an answer, or an error the request ends with. */
type Reply = ClaudeResponse | Error;

/** Runs the updater against a client that gives `replies` in order, recording the requests. */
function run(
  replies: Reply[],
  { request = REQUEST, hooks = {} }: { request?: AnswerRequest; hooks?: Partial<AnswerHooks> } = {},
) {
  const requests: ClaudeRequest[] = [];
  const client: ClaudeClient = {
    async complete(sent) {
      requests.push(sent);
      const reply = replies.shift();
      if (reply === undefined) throw new Error('Unexpected request');
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
  const controller = new AbortController();
  const result = createClaudeAnswerUpdater({ client }).apply(request, {
    signal: controller.signal,
    log: pino({ level: 'silent' }),
    ...hooks,
  });
  return { result, requests, signal: hooks.signal ?? controller.signal };
}

/** A logger at debug level, and the lines it writes, parsed. */
function capture() {
  const lines: string[] = [];
  const log = pino({ level: 'debug' }, { write: (line: string) => lines.push(line) });
  const records = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { lines, log, records };
}

const failure = (job: { code: string; message: string }) => ({
  code: job.code,
  userMessage: job.message,
});

describe('Claude answer updater', () => {
  it('turns the answer into changes with one request in the shape of the question’s section', async () => {
    const { result, requests, signal } = run([answer(UPDATE)]);

    await expect(result).resolves.toEqual(UPDATE);
    expect(requests).toEqual([
      {
        system: ANSWER_SYSTEM_PROMPT,
        content: buildAnswerContent(REQUEST),
        outputFormat: ANSWER_UPDATE_FORMATS.experience,
        signal,
        log: expect.anything(),
      },
    ]);
    // The format built once at load, not a copy: byte-stable for the API's schema cache.
    expect(requests[0]?.outputFormat).toBe(ANSWER_UPDATE_FORMATS.experience);
  });

  it.each(GENERATION_ISSUE_SECTIONS)(
    'asks for the %s section’s format and returns its update',
    async (section) => {
      const update = unchanged(section, 'Which year did that happen?');
      const { result, requests } = run([answer(update)], { request: about(section) });

      await expect(result).resolves.toEqual(update);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.outputFormat).toBe(ANSWER_UPDATE_FORMATS[section]);
    },
  );

  describe('asks once more, with the same request', () => {
    it.each([
      ['isn’t valid JSON', answer('{"followUp": "", "experience": [{"id": "experience-1"')],
      ['doesn’t match the schema', answer({ ...UPDATE, followUp: undefined })],
      [
        'broke off midway',
        new ClaudeError('unavailable', { type: 'overloaded_error', midStream: true }),
      ],
    ])('when the answer %s', async (_, first) => {
      const { result, requests } = run([first, answer(UPDATE)]);

      await expect(result).resolves.toEqual(UPDATE);
      expect(requests).toHaveLength(2);
      const [one, two] = requests.map((request) => ({ ...request, log: undefined }));
      expect(two).toEqual(one);
      expect(requests[1]?.outputFormat).toBe(requests[0]?.outputFormat);
    });
  });

  it('cuts lists that run over their limits, keeping the first entries', async () => {
    const skillNames = Array.from({ length: 90 }, (_, index) => `Skill ${index + 1}`);
    const bullets = Array.from({ length: 20 }, (_, index) => `Bullet ${index + 1}`);

    const skills = run([answer({ followUp: '', addSkills: skillNames })], {
      request: about('skills'),
    });
    const roles = run([answer({ ...UPDATE, experience: [{ ...ROLE, addBullets: bullets }] })]);

    await expect(skills.result).resolves.toEqual({
      followUp: '',
      addSkills: skillNames.slice(0, 80),
    });
    expect(skills.requests).toHaveLength(1);
    await expect(roles.result).resolves.toEqual({
      ...UPDATE,
      experience: [{ ...ROLE, addBullets: bullets.slice(0, 15) }],
    });
  });

  describe('fails after the second try', () => {
    it.each([
      ['isn’t valid JSON', answer('{"followUp":'), JOB_FAILURES.aiInvalidJson],
      [
        'doesn’t match the schema',
        answer({ ...UPDATE, extra: true }),
        JOB_FAILURES.aiSchemaMismatch,
      ],
      ['is another section’s update', answer(unchanged('summary')), JOB_FAILURES.aiSchemaMismatch],
      [
        'runs over a limit',
        answer({ ...unchanged('experience'), followUp: 'x'.repeat(301) }),
        JOB_FAILURES.aiSchemaMismatch,
      ],
      [
        'breaks off',
        new ClaudeError('unavailable', { type: 'overloaded_error', midStream: true }),
        JOB_FAILURES.aiUnavailable,
      ],
    ])('when the answer %s again', async (_, reply, job) => {
      const { result, requests } = run([reply, reply]);

      await expect(result).rejects.toBeInstanceOf(GenerationError);
      await expect(result).rejects.toMatchObject(failure(job));
      expect(requests).toHaveLength(2);
    });

    it('keeps the Claude error as the cause', async () => {
      const error = new ClaudeError('unavailable', { type: 'overloaded_error', midStream: true });
      const { result } = run([error, error]);

      await expect(result).rejects.toMatchObject({
        ...failure(JOB_FAILURES.aiUnavailable),
        cause: error,
      });
    });
  });

  describe('fails without asking again', () => {
    it.each([
      ['refusal', JOB_FAILURES.aiRefused],
      ['max_tokens', JOB_FAILURES.aiOutputTruncated],
      ['model_context_window_exceeded', JOB_FAILURES.aiOutputTruncated],
      ['pause_turn', JOB_FAILURES.aiInvalidJson],
    ] as const)('when the answer stopped with %s', async (stopReason, job) => {
      // Text that would parse, to show that only a finished answer is read.
      const { result, requests } = run([answer(UPDATE, { stopReason })]);

      await expect(result).rejects.toBeInstanceOf(GenerationError);
      await expect(result).rejects.toMatchObject(failure(job));
      expect(requests).toHaveLength(1);
    });

    it.each([
      ['timeout', false, JOB_FAILURES.aiTimeout],
      ['rate_limited', false, JOB_FAILURES.aiRateLimited],
      ['rate_limited', true, JOB_FAILURES.aiRateLimited],
      ['unavailable', false, JOB_FAILURES.aiUnavailable],
      ['not_configured', false, JOB_FAILURES.aiNotConfigured],
      ['rejected', false, JOB_FAILURES.aiRequestRejected],
    ] as const)('when the request fails as %s (mid-stream: %s)', async (kind, midStream, job) => {
      const error = new ClaudeError(kind, { midStream });
      const { result, requests } = run([error]);

      await expect(result).rejects.toMatchObject({ ...failure(job), cause: error });
      expect(requests).toHaveLength(1);
    });
  });

  describe('lets errors through unchanged', () => {
    it.each([
      ['the SDK’s abort error', new Error('Request was aborted.')],
      ['a Claude error that raced the abort', new ClaudeError('unavailable', { midStream: true })],
    ])('%s once the signal is aborted', async (_, thrown) => {
      const controller = new AbortController();
      controller.abort();
      const { result, requests } = run([thrown], { hooks: { signal: controller.signal } });

      await expect(result).rejects.toBe(thrown);
      expect(requests).toHaveLength(1);
    });

    it('that aren’t Claude’s', async () => {
      const bug = new TypeError('Cannot read properties of undefined');
      const { result, requests } = run([bug]);

      await expect(result).rejects.toBe(bug);
      expect(requests).toHaveLength(1);
    });
  });

  it('logs each try’s problem under its number, and what the answer led to', async () => {
    const { log, records } = capture();

    await run([answer('{"followUp":'), answer(unchanged('experience', 'Since when?'))], {
      hooks: { log },
    }).result;

    expect(records()).toEqual([
      expect.objectContaining({ aiAttempt: 1, msg: 'Claude answer is not valid JSON' }),
      expect.objectContaining({
        aiAttempt: 1,
        code: 'AI_INVALID_JSON',
        msg: 'Asking Claude again',
      }),
      expect.objectContaining({
        section: 'experience',
        followUp: true,
        msg: 'Claude read the answer',
      }),
    ]);
  });

  it('never logs the CV, the question or the answer', async () => {
    const { lines, log } = capture();
    const request: AnswerRequest = {
      ...REQUEST,
      followUp: 'Roughly how many payments a day?',
      previousAnswer: 'Loads of payments at Northpay.',
    };

    // An answer cut off in the middle, then one that asks for more.
    await run(
      [
        answer('{"experience": [{"id": "experience-1", "title": "Ledger lead at Northpay'),
        answer(unchanged('experience', 'Which card networks?')),
      ],
      { request, hooks: { log } },
    ).result;
    // Answers that don't match the schema, with values over their limits.
    const tooLong = answer({
      ...UPDATE,
      experience: [{ ...ROLE, title: 'Northpay ledger '.repeat(20) }],
    });
    await run([tooLong, tooLong], { request, hooks: { log } }).result.catch(() => {});

    expect(lines.length).toBeGreaterThan(0);
    const logged = lines.join('\n');
    for (const secret of [
      'Northpay',
      'ledger',
      'jane.doe',
      '912 345',
      'Lisbon',
      'Senior Backend',
      'payments a day',
      'card settlements',
      'Loads of',
      'card networks',
    ]) {
      expect(logged).not.toContain(secret);
    }
  });
});
