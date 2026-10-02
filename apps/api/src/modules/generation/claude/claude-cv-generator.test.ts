import {
  CvContentSchema,
  GENERATION_ISSUE_KINDS,
  GENERATION_ISSUE_SECTIONS,
  type GenerationIssue,
  GenerationIssuesSchema,
} from '@cv-builder/shared';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import {
  type ClaudeClient,
  ClaudeError,
  type ClaudeRequest,
  type ClaudeResponse,
} from '../../../integrations/ai/claude-client';
import { type GenerationHooks, GenerationError } from '../cv-generator';
import { JOB_FAILURES } from '../generation.failures';
import type { GenerationInput } from '../generation.input';
import { createClaudeCvGenerator } from './claude-cv-generator';
import { AI_CV_DRAFT_FORMAT, type AiCvDraft, AiCvDraftSchema } from './cv-draft.schema';
import { buildUserContent, SYSTEM_PROMPT } from './prompt';

const PDF_TEXT = [
  'Jane Doe · Backend Engineer',
  'jane.doe@example.com · +351 912 345 678 · linkedin.com/in/janedoe',
  'Northpay, Lisbon · Backend Engineer · 2021–present',
  'Built the payments ledger in Go and PostgreSQL. Cut settlement from 2 days to 4 hours.',
  'Shopwise · Support Specialist · 2017–2019',
  'BSc Computer Science, University of Lisbon, 2014–2017',
].join('\n');

const INPUT: GenerationInput = {
  targetRole: 'Senior Backend Engineer',
  sourceText: 'I also mentor two junior engineers.',
  sourceDocument: {
    id: '0199a000-0000-7000-8000-0000000000d1',
    originalName: 'Jane Doe CV.pdf',
    pageCount: 1,
    text: PDF_TEXT,
  },
};

const ISSUE: GenerationIssue = {
  section: 'experience',
  kind: 'incomplete',
  target: 'Experience · Northpay',
  question: 'How many payments a day does the ledger handle?',
  why: 'Scale shows the size of systems you can own as a senior engineer.',
};

const CONTACT: AiCvDraft['contact'] = {
  firstName: 'Jane',
  lastName: 'Doe',
  headline: 'Backend Engineer',
  email: 'jane.doe@example.com',
  phone: '+351 912 345 678',
  location: 'Lisbon',
  links: [{ label: 'LinkedIn', url: 'https://www.linkedin.com/in/janedoe/' }],
};

const ROLE: AiCvDraft['experience'][number] = {
  title: 'Backend Engineer',
  company: 'Northpay',
  location: 'Lisbon',
  start: '2021',
  end: '',
  current: true,
  bullets: [
    'Built the payments ledger in Go and PostgreSQL.',
    'Cut settlement time from 2 days to 4 hours.',
  ],
};

const SCHOOL: AiCvDraft['education'][number] = {
  degree: 'BSc Computer Science',
  school: 'University of Lisbon',
  location: '',
  start: '2014',
  end: '2017',
  details: '',
};

function draft(overrides: Partial<AiCvDraft> = {}): AiCvDraft {
  return {
    contact: CONTACT,
    summary: 'Backend engineer who built a payments ledger in Go and PostgreSQL at Northpay.',
    experience: [
      ROLE,
      {
        title: 'Support Specialist',
        company: 'Shopwise',
        location: '',
        start: '2017',
        end: '2019',
        current: false,
        bullets: ['Resolved customers’ payment problems.'],
      },
    ],
    education: [SCHOOL],
    skills: ['Go', 'PostgreSQL'],
    issues: [ISSUE],
    ...overrides,
  };
}

const many = <T>(count: number, make: (index: number) => T): T[] =>
  Array.from({ length: count }, (_, index) => make(index));

/** Claude's answer: `value` as JSON text (or the text itself), finished normally by default. */
function answer(value: unknown, overrides: Partial<ClaudeResponse> = {}): ClaudeResponse {
  return {
    stopReason: 'end_turn',
    text: typeof value === 'string' ? value : JSON.stringify(value),
    model: 'claude-opus-5-5',
    usage: { inputTokens: 2_000, outputTokens: 1_500 },
    requestId: 'req_1',
    ...overrides,
  };
}

/** One of the client's replies: an answer, or an error the request ends with. */
type Reply = ClaudeResponse | Error;

/**
 * Runs the generator against a client that gives `replies` in order. The timeline records the
 * steps reported and the requests sent, in the order they happened.
 */
function run(
  replies: Reply[],
  { input = INPUT, hooks = {} }: { input?: GenerationInput; hooks?: Partial<GenerationHooks> } = {},
) {
  const requests: ClaudeRequest[] = [];
  const timeline: string[] = [];
  const client: ClaudeClient = {
    async complete(request) {
      requests.push(request);
      timeline.push('request');
      const reply = replies.shift();
      if (reply === undefined) throw new Error('Unexpected request');
      if (reply instanceof Error) throw reply;
      // Like the real client: the answer's text starts before the request completes.
      await request.onTextStart?.();
      return reply;
    },
  };
  const controller = new AbortController();
  const result = createClaudeCvGenerator({ client }).generate(input, {
    signal: controller.signal,
    onStep: async (step) => {
      timeline.push(`step ${step}`);
    },
    log: pino({ level: 'silent' }),
    ...hooks,
  });
  return { result, requests, timeline, signal: hooks.signal ?? controller.signal };
}

const failure = (job: { code: string; message: string }) => ({
  code: job.code,
  userMessage: job.message,
});

describe('Claude CV generator', () => {
  it('writes the CV with one request and reports the four steps in order', async () => {
    const { result, requests, timeline, signal } = run([answer(draft())]);

    const cv = await result;

    expect(cv.content).toEqual({
      version: 1,
      contact: {
        firstName: 'Jane',
        lastName: 'Doe',
        headline: 'Backend Engineer',
        email: 'jane.doe@example.com',
        phone: '+351 912 345 678',
        location: 'Lisbon',
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
            {
              id: 'experience-1-bullet-1',
              text: 'Built the payments ledger in Go and PostgreSQL.',
            },
            { id: 'experience-1-bullet-2', text: 'Cut settlement time from 2 days to 4 hours.' },
          ],
        },
        {
          id: 'experience-2',
          title: 'Support Specialist',
          company: 'Shopwise',
          location: '',
          start: '2017',
          end: '2019',
          current: false,
          bullets: [{ id: 'experience-2-bullet-1', text: 'Resolved customers’ payment problems.' }],
        },
      ],
      education: [{ id: 'education-1', ...SCHOOL }],
      skills: [
        { id: 'skill-1', name: 'Go' },
        { id: 'skill-2', name: 'PostgreSQL' },
      ],
    });
    expect(CvContentSchema.safeParse(cv.content).success).toBe(true);
    expect(cv.issues).toEqual([ISSUE]);
    expect(timeline).toEqual(['step 0', 'step 1', 'request', 'step 2', 'step 3']);
    expect(requests).toEqual([
      {
        system: SYSTEM_PROMPT,
        content: buildUserContent(INPUT),
        outputFormat: AI_CV_DRAFT_FORMAT,
        signal,
        onTextStart: expect.any(Function),
        log: expect.anything(),
      },
    ]);
  });

  describe('asks once more', () => {
    it('when the answer isn’t valid JSON, without the steps going back', async () => {
      const { result, requests, timeline } = run([
        answer('{"contact": {"firstName": "Ja'),
        answer(draft()),
      ]);

      await expect(result).resolves.toMatchObject({ issues: [ISSUE] });
      expect(requests).toHaveLength(2);
      expect(timeline).toEqual(['step 0', 'step 1', 'request', 'step 2', 'step 3', 'request']);
    });

    it('when the answer doesn’t match the schema', async () => {
      const { result, requests } = run([
        answer({ ...draft(), summary: undefined }),
        answer(draft()),
      ]);

      await expect(result).resolves.toMatchObject({ issues: [ISSUE] });
      expect(requests).toHaveLength(2);
    });

    it('when the answer broke off midway', async () => {
      const { result, requests, timeline } = run([
        new ClaudeError('unavailable', { type: 'overloaded_error', midStream: true }),
        answer(draft()),
      ]);

      await expect(result).resolves.toMatchObject({ issues: [ISSUE] });
      expect(requests).toHaveLength(2);
      expect(timeline).toEqual(['step 0', 'step 1', 'request', 'request', 'step 2', 'step 3']);
    });
  });

  describe('fails after the second try', () => {
    it.each([
      ['isn’t valid JSON', answer('{"contact":'), JOB_FAILURES.aiInvalidJson],
      [
        'doesn’t match the schema',
        answer({ ...draft(), extra: true }),
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
  });

  describe('fails without asking again', () => {
    it.each([
      ['refusal', JOB_FAILURES.aiRefused],
      ['max_tokens', JOB_FAILURES.aiOutputTruncated],
      ['model_context_window_exceeded', JOB_FAILURES.aiOutputTruncated],
      ['pause_turn', JOB_FAILURES.aiInvalidJson],
    ] as const)('when the answer stopped with %s', async (stopReason, job) => {
      // Text that would parse, to show that only a finished answer is read.
      const { result, requests } = run([answer(draft(), { stopReason })]);

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

    it('from reporting a step, e.g. when the job was lost', async () => {
      const lost = new Error('Lease lost');
      for (const failingStep of [0, 2, 3]) {
        const { result } = run([answer(draft())], {
          hooks: {
            onStep: async (step) => {
              if (step === failingStep) throw lost;
            },
          },
        });

        await expect(result).rejects.toBe(lost);
      }
    });

    it('that aren’t Claude’s', async () => {
      const bug = new TypeError('Cannot read properties of undefined');
      const { result, requests } = run([bug]);

      await expect(result).rejects.toBe(bug);
      expect(requests).toHaveLength(1);
    });
  });

  it('cuts lists that run over their limits, keeping the first entries', async () => {
    const { result } = run([
      answer(
        draft({
          contact: {
            ...CONTACT,
            links: many(12, (index) => ({
              label: `Link ${index + 1}`,
              url: 'linkedin.com/in/janedoe',
            })),
          },
          experience: many(35, (index) => ({
            ...ROLE,
            title: `Role ${index + 1}`,
            bullets: many(20, (bullet) => `Bullet ${bullet + 1}`),
          })),
          education: many(20, (index) => ({ ...SCHOOL, degree: `Degree ${index + 1}` })),
          skills: many(90, (index) => `Skill ${index + 1}`),
          issues: many(14, (index) => ({ ...ISSUE, question: `Question ${index + 1}?` })),
        }),
      ),
    ]);

    const cv = await result;

    const content = CvContentSchema.parse(cv.content);
    const issues = GenerationIssuesSchema.parse(cv.issues);
    expect(content.contact.links.map((link) => link.label)).toEqual(
      many(10, (index) => `Link ${index + 1}`),
    );
    expect(content.experience).toHaveLength(30);
    expect(content.experience.at(-1)?.title).toBe('Role 30');
    expect(content.experience[0]?.bullets.map((bullet) => bullet.text)).toEqual(
      many(15, (bullet) => `Bullet ${bullet + 1}`),
    );
    expect(content.education).toHaveLength(15);
    expect(content.skills).toHaveLength(80);
    expect(content.skills.at(-1)?.name).toBe('Skill 80');
    expect(issues.map((issue) => issue.question)).toEqual(
      many(10, (index) => `Question ${index + 1}?`),
    );
  });

  it('allows exactly what a stored CV and its issues allow', async () => {
    const full = (length: number) => 'x'.repeat(length);
    const atLimits: AiCvDraft = {
      contact: {
        firstName: full(80),
        lastName: full(80),
        headline: full(160),
        email: full(254),
        phone: full(40),
        location: full(120),
        links: many(10, () => ({ label: full(40), url: full(300) })),
      },
      summary: full(2_000),
      experience: many(30, () => ({
        title: full(160),
        company: full(160),
        location: full(120),
        start: full(40),
        end: full(40),
        current: false,
        bullets: many(15, () => full(500)),
      })),
      education: many(15, () => ({
        degree: full(160),
        school: full(160),
        location: full(120),
        start: full(40),
        end: full(40),
        details: full(500),
      })),
      skills: many(80, () => full(60)),
      issues: many(10, () => ({
        section: 'general',
        kind: 'missing',
        target: full(120),
        question: full(300),
        why: full(400),
      })),
    };
    // The contact guard keeps the contact details only if the sources have them.
    const input = {
      ...INPUT,
      sourceText: null,
      sourceDocument: { ...INPUT.sourceDocument!, text: full(300) },
    };

    const cv = await run([answer(atLimits)], { input }).result;

    // Claude may fill every field and list of a stored CV to its limit…
    const content = CvContentSchema.parse(cv.content);
    const issues = GenerationIssuesSchema.parse(cv.issues);
    expect(cv.content).toEqual(content);
    // …and no further: one more character or entry anywhere is too much for both schemas.
    for (const path of growablePaths(atLimits)) {
      expect(AiCvDraftSchema.safeParse(grownAt(atLimits, path)).success, path.join('.')).toBe(
        false,
      );
    }
    for (const path of growablePaths(content)) {
      expect(CvContentSchema.safeParse(grownAt(content, path)).success, path.join('.')).toBe(false);
    }
    for (const path of growablePaths(issues)) {
      expect(GenerationIssuesSchema.safeParse(grownAt(issues, path)).success, path.join('.')).toBe(
        false,
      );
    }
  });

  describe('contact details', () => {
    it('clears one the sources don’t have and asks for it', async () => {
      const { result } = run([
        answer(draft({ contact: { ...CONTACT, email: 'jane.doe@gmail.com' } })),
      ]);

      const cv = await result;

      expect(CvContentSchema.parse(cv.content).contact).toMatchObject({
        email: '',
        phone: '+351 912 345 678',
      });
      expect(cv.issues).toEqual([
        ISSUE,
        {
          section: 'contact',
          kind: 'missing',
          target: 'Contact details',
          question: 'What email address should employers use to contact you?',
          why: expect.stringContaining('only keeps contact details found in your CV or notes'),
        },
      ]);
      expect(GenerationIssuesSchema.safeParse(cv.issues).success).toBe(true);
    });

    it('asks only while there is room for another issue', async () => {
      const issues = many(10, (index) => ({ ...ISSUE, question: `Question ${index + 1}?` }));
      const { result } = run([
        answer(draft({ contact: { ...CONTACT, email: 'invented@example.org' }, issues })),
      ]);

      const cv = await result;

      expect(CvContentSchema.parse(cv.content).contact.email).toBe('');
      expect(cv.issues).toEqual(issues);
    });
  });

  it('never logs the sources or the CV', async () => {
    const lines: string[] = [];
    const log = pino({ level: 'debug' }, { write: (line: string) => lines.push(line) });

    // An answer cut off in the middle, then one with an invented email.
    await run(
      [
        answer('{"summary": "Built the payments ledger at Northpay'),
        answer(draft({ contact: { ...CONTACT, email: 'jane.doe@gmail.com' } })),
      ],
      { hooks: { log } },
    ).result;
    // Answers that don't match the schema, with values over their limits.
    const tooLong = answer(draft({ contact: { ...CONTACT, firstName: 'Northpay'.repeat(20) } }));
    await run([tooLong, tooLong], { hooks: { log } }).result.catch(() => {});

    expect(lines.length).toBeGreaterThan(0);
    const logged = lines.join('\n');
    for (const secret of ['Northpay', 'ledger', 'jane.doe', 'gmail', '912 345', 'Lisbon']) {
      expect(logged).not.toContain(secret);
    }
  });
});

describe('AI_CV_DRAFT_FORMAT', () => {
  type Schema = Record<string, unknown>;
  const { schema } = AI_CV_DRAFT_FORMAT;

  /** The schema of a field, e.g. `field('issues', 'section')` (lists are looked into). */
  function field(...path: string[]): Schema {
    return path.reduce<Schema>((node, key) => {
      const object = node.type === 'array' ? (node.items as Schema) : node;
      return (object.properties as Record<string, Schema>)[key] ?? {};
    }, schema);
  }

  /** Every object in the schema, with its path. */
  function objects(node: Schema, path = '$'): [string, Schema][] {
    const own: [string, Schema][] = node.type === 'object' ? [[path, node]] : [];
    const properties = Object.entries((node.properties ?? {}) as Record<string, Schema>);
    return [
      ...own,
      ...properties.flatMap(([key, child]) => objects(child, `${path}.${key}`)),
      ...(node.items ? objects(node.items as Schema, `${path}[]`) : []),
    ];
  }

  it('is just the JSON schema, without the helper’s `parse`', () => {
    expect(Object.keys(AI_CV_DRAFT_FORMAT)).toEqual(['type', 'schema']);
    expect(AI_CV_DRAFT_FORMAT.type).toBe('json_schema');
  });

  it('is strict and inline, with nothing structured outputs don’t support', () => {
    for (const [path, object] of objects(schema)) {
      expect(object.additionalProperties, path).toBe(false);
      expect(object.required, path).toEqual(Object.keys(object.properties as Schema));
    }
    const json = JSON.stringify(schema);
    for (const keyword of [
      '$schema',
      '$ref',
      '$defs',
      'format',
      'pattern',
      'maxLength',
      'maxItems',
    ]) {
      expect(json).not.toContain(`"${keyword}"`);
    }
  });

  it('holds issues to their sections and kinds', () => {
    expect(field('issues', 'section').enum).toEqual([...GENERATION_ISSUE_SECTIONS]);
    expect(field('issues', 'kind').enum).toEqual([...GENERATION_ISSUE_KINDS]);
  });

  it('tells the model each limit in the field’s description', () => {
    expect(field('contact', 'email').description).toBe(
      'Exactly as in the sources; empty if they have none.\n\n{maxLength: 254}',
    );
    expect(field('experience').description).toMatch(/\n\n\{maxItems: 30\}$/);
    expect(field('issues', 'question').description).toMatch(/\{minLength: 1, maxLength: 300\}$/);
  });
});

type Path = (string | number)[];

/** Paths to every string and list in `value`, looking into each list's first entry; ids aside. */
function growablePaths(value: unknown, path: Path = []): Path[] {
  if (typeof value === 'string') return [path];
  if (Array.isArray(value)) return [path, ...growablePaths(value[0], [...path, 0])];
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, child]) =>
      key === 'id' ? [] : growablePaths(child, [...path, key]),
    );
  }
  return [];
}

/** A copy of `value` with one more character, or one more entry, at `path`. */
function grownAt<T>(value: T, path: Path): T {
  const root = { value: structuredClone(value) };
  const keys: Path = ['value', ...path];
  const last = keys.pop()!;
  const parent = keys.reduce<unknown>(
    (node, key) => (node as Record<string | number, unknown>)[key],
    root,
  ) as Record<string | number, unknown>;
  const target = parent[last];
  parent[last] = Array.isArray(target) ? [...target, target.at(-1)] : `${String(target)}x`;
  return root.value;
}
