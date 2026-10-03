import { setTimeout as sleep } from 'node:timers/promises';
import {
  CV_LIMITS,
  type CvContent,
  CvContentSchema,
  type GenerationIssue,
  GenerationIssuesSchema,
} from '@cv-builder/shared';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Repositories } from '../../db/repositories';
import { createInMemoryRepositories } from '../../test/in-memory-repositories';
import { createMemoryStorage } from '../../test/start-app';
import { createCvsService } from '../cvs/cvs.service';
import { createQuestionsService } from '../questions/questions.service';
import type { AnswerHooks, AnswerRequest, AnswerUpdater } from './answers/answer-input';
import type { ContactChanges, RoleChanges } from './answers/answer-update.schema';
import { type CvGenerator, type GeneratedCv, GenerationError } from './cv-generator';
import { JOB_FAILURES } from './generation.failures';
import { toGenerationInput } from './generation.service';
import {
  createGenerationWorker,
  type GenerationWorker,
  type GenerationWorkerRepository,
} from './generation.worker';
import { createMockCvGenerator } from './mock-cv-generator';

const USER = '0199a000-0000-7000-8000-00000000000a';
const silent = pino({ level: 'silent' });

const CONTENT: CvContent = CvContentSchema.parse({
  version: 1,
  contact: {
    firstName: 'Alex',
    lastName: 'Morgan',
    headline: 'AI Engineer',
    email: '',
    phone: '',
    location: '',
    links: [],
  },
  summary: 'Summary',
  experience: [],
  education: [],
  skills: [],
});

const ISSUES: GenerationIssue[] = [
  {
    section: 'experience',
    kind: 'ambiguous',
    target: 'Experience · Northpay',
    question: 'Are you still working at Northpay?',
    why: 'Recruiters look at how recent your experience is.',
  },
];

/** Never settles and ignores the abort signal: a generator that hangs. */
const hang = () => new Promise<GeneratedCv>(() => {});

const workers: GenerationWorker[] = [];

afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.stop()));
});

/** For tests that only generate: fails if an answer job reaches it. */
const noAnswers: AnswerUpdater = {
  async apply() {
    throw new Error('No answer jobs expected');
  },
};

/** The worker's tuning options, plus how many CVs with a pending job to create. */
type SetupOptions = Omit<
  Parameters<typeof createGenerationWorker>[0],
  'repository' | 'generator' | 'logger' | 'answerUpdater'
> & {
  jobs?: number;
  answerUpdater?: AnswerUpdater;
  /** Wraps the repository the worker uses, e.g. to make one call fail. */
  wrap?: (repository: GenerationWorkerRepository) => GenerationWorkerRepository;
};

/** CVs with a pending generation job each, plus a worker wired to the in-memory repository. */
async function setup(
  generator: CvGenerator,
  { jobs = 1, wrap = (repository) => repository, ...options }: SetupOptions = {},
) {
  const { repositories, db } = createInMemoryRepositories();
  for (let index = 0; index < jobs; index += 1) {
    const cv = await repositories.cvs.create(USER, {
      title: 'AI Engineer',
      targetRole: 'AI Engineer',
      sourceText: 'Built retrieval pipelines and evaluation tooling for three years.',
    });
    const started = await repositories.generation.startJob(USER, cv.id, toGenerationInput);
    if (started.kind !== 'created') throw new Error('job not created');
  }

  const worker = createGenerationWorker({
    repository: wrap(repositories.generation),
    generator,
    answerUpdater: noAnswers,
    logger: silent,
    pollIntervalMs: 5,
    ...options,
  });
  workers.push(worker);
  const job = () => db.jobs[0]!;
  return { worker, db, repositories, job, cvRow: () => db.cvs[0]! };
}

/** Walks through the four steps, recording them, and returns `output`. */
function scriptedGenerator(output: GeneratedCv, steps: number[] = []): CvGenerator {
  return {
    async generate(_input, { onStep }) {
      for (const step of [0, 1, 2, 3]) {
        steps.push(step);
        await onStep(step);
      }
      return output;
    },
  };
}

describe('generation worker', () => {
  it('runs a pending job through its steps and saves the CV and its issues', async () => {
    const steps: number[] = [];
    const { worker, job, cvRow } = await setup(
      scriptedGenerator({ content: CONTENT, issues: ISSUES }, steps),
    );

    expect(await worker.tick()).toBe(true);

    expect(steps).toEqual([0, 1, 2, 3]);
    expect(job()).toMatchObject({
      status: 'COMPLETED',
      progressStep: 4,
      attempts: 1,
      result: CONTENT,
      issues: ISSUES,
      errorCode: null,
    });
    // As in Prisma, completing also counts as the job's last heartbeat.
    expect(job().heartbeatAt).toEqual(job().finishedAt);
    expect(cvRow()).toMatchObject({ content: CONTENT, contentVersion: 1 });
    expect(await worker.tick()).toBe(false);
  });

  it('records a generator failure with its user-facing message', async () => {
    const { worker, job, cvRow } = await setup({
      async generate() {
        throw new GenerationError(JOB_FAILURES.aiRateLimited);
      },
    });

    await worker.tick();

    expect(job()).toMatchObject({
      status: 'FAILED',
      errorCode: 'AI_RATE_LIMITED',
      errorMessage: JOB_FAILURES.aiRateLimited.message,
    });
    expect(cvRow().content).toBeNull();
  });

  it('never saves content that fails validation', async () => {
    const { worker, job, cvRow } = await setup(
      scriptedGenerator({ content: { version: 2, summary: 42 }, issues: [] }),
    );

    await worker.tick();

    expect(job()).toMatchObject({
      status: 'FAILED',
      errorCode: 'INVALID_OUTPUT',
      errorMessage: JOB_FAILURES.invalidOutput.message,
      result: null,
    });
    expect(cvRow().content).toBeNull();
  });

  it('saves a valid CV without its issues when the issues are invalid', async () => {
    const { worker, job, cvRow } = await setup(
      scriptedGenerator({ content: CONTENT, issues: [{ section: 'hobbies', question: '' }] }),
    );

    await worker.tick();

    expect(job()).toMatchObject({ status: 'COMPLETED', issues: [] });
    expect(cvRow().content).toEqual(CONTENT);
  });

  it('drops an issue whose text the database can’t store, and keeps the rest', async () => {
    const unstorable = { ...ISSUES[0]!, question: 'Where were you based?\u0000' };
    const { worker, job, cvRow } = await setup(
      scriptedGenerator({ content: CONTENT, issues: [ISSUES[0], unstorable] }),
    );

    await worker.tick();

    expect(job()).toMatchObject({ status: 'COMPLETED', issues: ISSUES });
    expect(cvRow().content).toEqual(CONTENT);
  });

  it('fails a job whose saved input no longer reads with INVALID_INPUT, without generating', async () => {
    let generated = false;
    const { worker, job, cvRow } = await setup({
      async generate() {
        generated = true;
        return { content: CONTENT, issues: [] };
      },
    });
    Object.assign(job(), { input: { targetRole: '' } });

    await worker.tick();

    expect(generated).toBe(false);
    expect(job()).toMatchObject({ status: 'FAILED', errorCode: 'INVALID_INPUT' });
    expect(cvRow().content).toBeNull();
  });

  it('keeps a generation going when reporting one of its steps fails', async () => {
    let failed = false;
    const { worker, job, cvRow } = await setup(
      scriptedGenerator({ content: CONTENT, issues: [] }),
      {
        wrap: (repository) => ({
          ...repository,
          async heartbeat(lease, step) {
            if (step === 2 && !failed) {
              failed = true;
              throw new Error('Connection reset');
            }
            return repository.heartbeat(lease, step);
          },
        }),
      },
    );

    await worker.tick();

    expect(failed).toBe(true);
    expect(job()).toMatchObject({
      status: 'COMPLETED',
      attempts: 1,
      progressStep: 4,
      errorCode: null,
    });
    expect(cvRow().content).toEqual(CONTENT);
  });

  it('leaves a job alone while its heartbeat is fresh', async () => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => (markStarted = resolve));
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => (finish = resolve));
    let calls = 0;
    const { worker, job } = await setup({
      async generate(_input, { onStep }) {
        calls += 1;
        await onStep(1);
        markStarted();
        await finished;
        return { content: CONTENT, issues: [] };
      },
    });

    const first = worker.tick();
    await started;
    // A second round, as another loop or worker would run it, finds nothing to recover or claim.
    expect(await worker.tick()).toBe(false);
    expect(job()).toMatchObject({ status: 'PROCESSING', attempts: 1 });

    finish();
    await first;
    expect(calls).toBe(1);
    expect(job()).toMatchObject({ status: 'COMPLETED', attempts: 1 });
  });

  it('fails a hung job with AI_TIMEOUT at its deadline', async () => {
    const { worker, job, cvRow } = await setup(
      {
        async generate(_input, { onStep }) {
          await onStep(1);
          return hang();
        },
      },
      { jobTimeoutMs: 50 },
    );

    await worker.tick();

    expect(job()).toMatchObject({
      status: 'FAILED',
      progressStep: 1,
      errorCode: 'AI_TIMEOUT',
      errorMessage: JOB_FAILURES.aiTimeout.message,
    });
    expect(cvRow().content).toBeNull();
  });

  it('aborts the generator at the deadline and fails the job with AI_TIMEOUT', async () => {
    let seen!: AbortSignal;
    const { worker, job } = await setup(
      {
        async generate(_input, { signal }) {
          seen = signal;
          await sleep(60_000, undefined, { signal });
          return { content: CONTENT, issues: [] };
        },
      },
      { jobTimeoutMs: 50 },
    );

    await worker.tick();

    expect(seen.reason.name).toBe('TimeoutError');
    expect(job()).toMatchObject({ status: 'FAILED', errorCode: 'AI_TIMEOUT' });
  });

  it('stops writing once another run has taken the job over', async () => {
    const { worker, job } = await setup({
      async generate(_input, { onStep }) {
        await onStep(0);
        // Meanwhile the job went stale and another worker claimed it (a new attempt).
        Object.assign(job(), { attempts: job().attempts + 1 });
        await onStep(1);
        return { content: CONTENT, issues: [] };
      },
    });

    await worker.tick();

    expect(job()).toMatchObject({ status: 'PROCESSING', attempts: 2, errorCode: null });
  });

  it('lets go of a lost job even if its generator ignores the signal', async () => {
    const { worker, job } = await setup(
      {
        async generate(_input, { onStep }) {
          await onStep(0);
          // Taken over by another run; the next heartbeat notices.
          Object.assign(job(), { attempts: job().attempts + 1 });
          return hang();
        },
      },
      { heartbeatIntervalMs: 5 },
    );

    await worker.tick();

    expect(job()).toMatchObject({ status: 'PROCESSING', attempts: 2, errorCode: null });
  });

  it('lets go of a job whose CV is deleted, even if its generator ignores the signal', async () => {
    const { worker, db, repositories } = await setup(
      {
        async generate(_input, { onStep }) {
          await onStep(0);
          // The person deletes the CV meanwhile, and its jobs go with it; the next heartbeat notices.
          await repositories.cvs.removeForUser(USER, db.cvs[0]!.id);
          return hang();
        },
      },
      { heartbeatIntervalMs: 5 },
    );

    await worker.tick();

    expect(db.cvs).toEqual([]);
    expect(db.jobs).toEqual([]);
  });

  it('writes nothing when its CV is deleted before the result arrives', async () => {
    const { worker, db, repositories } = await setup({
      async generate() {
        await repositories.cvs.removeForUser(USER, db.cvs[0]!.id);
        return { content: CONTENT, issues: ISSUES };
      },
    });

    // The steps weren't reported, so only `succeed` can notice: it finds neither job nor CV.
    await worker.tick();

    expect(db.cvs).toEqual([]);
    expect(db.jobs).toEqual([]);
    expect(db.questions).toEqual([]);
  });

  it('puts abandoned jobs back in the queue and fails them after three attempts', async () => {
    const { worker, job } = await setup(scriptedGenerator({ content: CONTENT, issues: [] }));
    Object.assign(job(), { status: 'PROCESSING', attempts: 1, heartbeatAt: new Date(0) });

    await worker.tick();
    expect(job()).toMatchObject({ status: 'COMPLETED', attempts: 2 });

    Object.assign(job(), { status: 'PROCESSING', attempts: 3, heartbeatAt: new Date(0) });
    expect(await worker.tick()).toBe(false);
    expect(job()).toMatchObject({
      status: 'FAILED',
      errorCode: 'WORKER_LOST',
      errorMessage: JOB_FAILURES.workerLost.message,
    });
  });

  it('hands a job in progress back to the queue when it stops', async () => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => (markStarted = resolve));
    const { worker, job } = await setup({
      async generate(_input, { signal, onStep }) {
        await onStep(1);
        markStarted();
        await sleep(60_000, undefined, { signal });
        return { content: CONTENT, issues: [] };
      },
    });

    worker.start();
    await started;
    await worker.stop();

    expect(job()).toMatchObject({
      status: 'PENDING',
      attempts: 0,
      progressStep: 0,
      errorCode: null,
    });
  });

  it('hands a job back on shutdown even if its generator ignores the signal', async () => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => (markStarted = resolve));
    const { worker, job } = await setup({
      async generate(_input, { onStep }) {
        await onStep(1);
        markStarted();
        return hang();
      },
    });

    worker.start();
    await started;
    await worker.stop();

    expect(job()).toMatchObject({ status: 'PENDING', attempts: 0, errorCode: null });
  });

  it('runs as many jobs at once as its concurrency allows', async () => {
    // Each generator waits until both have started: they finish only if they run side by side.
    let running = 0;
    let markBothRunning!: () => void;
    const bothRunning = new Promise<void>((resolve) => (markBothRunning = resolve));
    const { worker, db } = await setup(
      {
        async generate(_input, { onStep }) {
          await onStep(0);
          running += 1;
          if (running === 2) markBothRunning();
          await bothRunning;
          return { content: CONTENT, issues: [] };
        },
      },
      { jobs: 2, concurrency: 2 },
    );

    worker.start();

    await vi.waitFor(() => {
      expect(db.jobs.map((row) => row.status)).toEqual(['COMPLETED', 'COMPLETED']);
    });
  });
});

describe('mock generator', () => {
  const input = toGenerationInput({
    targetRole: 'Data Engineer',
    sourceText: 'Six years with Spark, Airflow and dbt at two retailers.',
    sourceDocument: null,
  });
  const hooks = (steps: number[] = []) => ({
    signal: new AbortController().signal,
    onStep: async (step: number) => void steps.push(step),
    log: silent,
  });

  it('walks the four steps and returns valid sample content and questions', async () => {
    const steps: number[] = [];
    const output = await createMockCvGenerator({ stepMs: 0, failRate: 0 }).generate(
      input,
      hooks(steps),
    );

    expect(steps).toEqual([0, 1, 2, 3]);
    // Like the real generator, the mock never makes the target role the person's own title.
    expect(CvContentSchema.parse(output.content).contact.headline).toBe('');
    expect(GenerationIssuesSchema.parse(output.issues).map((issue) => issue.section)).toEqual([
      'experience',
      'education',
      'contact',
    ]);
  });

  it('can be told to fail, to try the failure screen', async () => {
    const generator = createMockCvGenerator({ stepMs: 0, failRate: 1 });

    await expect(generator.generate(input, hooks())).rejects.toMatchObject({
      name: 'GenerationError',
      code: 'AI_TIMEOUT',
    });
  });
});

/** A generated CV with one role, for the answer tests. */
const DRAFT: CvContent = CvContentSchema.parse({
  version: 1,
  contact: {
    firstName: 'Alex',
    lastName: 'Morgan',
    headline: 'ML Engineer',
    email: '',
    phone: '',
    location: 'Berlin',
    links: [],
  },
  summary: 'Builds retrieval pipelines and evaluation tooling.',
  experience: [
    {
      id: 'experience-1',
      title: 'ML Engineer',
      company: 'Northpay',
      location: 'Berlin',
      start: 'Mar 2021',
      end: '',
      current: true,
      bullets: [{ id: 'bullet-1', text: 'Built the retrieval pipeline behind support search.' }],
    },
  ],
  education: [],
  skills: [
    { id: 'skill-1', name: 'Python' },
    { id: 'skill-2', name: 'PyTorch' },
  ],
});

/** One question per section the tests answer; the role question is about `experience-1`. */
const QUESTIONS: GenerationIssue[] = [
  {
    section: 'experience',
    kind: 'incomplete',
    target: 'Experience · Northpay',
    itemId: 'experience-1',
    question: 'How big was the team you led at Northpay?',
    why: 'Team size shows the scope of your role.',
  },
  {
    section: 'skills',
    kind: 'missing',
    target: 'Skills',
    question: 'Which cloud platforms have you worked with?',
    why: 'Most AI Engineer roles ask for one.',
  },
  {
    section: 'contact',
    kind: 'missing',
    target: 'Contact details',
    question: 'Which email should recruiters use?',
    why: 'Your CV has no way to reach you yet.',
  },
];

/** Changes to `experience-1` only; every field left out stays as it is. */
function roleUpdate(changes: Partial<RoleChanges>, followUp = '') {
  return {
    followUp,
    experience: [
      {
        id: 'experience-1',
        title: '',
        company: '',
        location: '',
        start: '',
        end: '',
        current: 'keep',
        editBullets: [],
        addBullets: [],
        ...changes,
      } satisfies RoleChanges,
    ],
  };
}

/** Changes to the contact details; every field left out stays as it is. */
function contactUpdate(changes: Partial<ContactChanges>) {
  return {
    followUp: '',
    contact: {
      firstName: '',
      lastName: '',
      headline: '',
      email: '',
      phone: '',
      location: '',
      workSetup: '',
      addLinks: [],
      ...changes,
    } satisfies ContactChanges,
  };
}

/** A CV with a pending generation job; returns its id. */
async function queueGeneration(repositories: Repositories) {
  const cv = await repositories.cvs.create(USER, {
    title: 'AI Engineer',
    targetRole: 'AI Engineer',
    sourceText: 'Built retrieval pipelines and evaluation tooling for three years.',
  });
  const started = await repositories.generation.startJob(USER, cv.id, toGenerationInput);
  if (started.kind !== 'created') throw new Error('job not created');
  return cv.id;
}

type ApplyAnswer = (request: AnswerRequest, hooks: AnswerHooks) => unknown;

/**
 * A CV generated as `DRAFT` with `QUESTIONS` open, and a worker whose answer updater records each
 * request and returns what the test's `onApply` returns.
 */
async function setupAnswers(options: Omit<SetupOptions, 'jobs' | 'answerUpdater'> = {}) {
  const { repositories, db } = createInMemoryRepositories();
  const requests: AnswerRequest[] = [];
  let apply: ApplyAnswer = () => {
    throw new Error('No answer job expected');
  };
  const worker = createGenerationWorker({
    repository: repositories.generation,
    generator: scriptedGenerator({ content: DRAFT, issues: QUESTIONS }),
    answerUpdater: {
      async apply(request, hooks) {
        requests.push(structuredClone(request));
        return apply(request, hooks);
      },
    },
    logger: silent,
    pollIntervalMs: 5,
    ...options,
  });
  workers.push(worker);

  const cvId = await queueGeneration(repositories);
  await worker.tick();

  const questions = createQuestionsService(repositories.questions);
  const cvs = createCvsService({
    cvs: repositories.cvs,
    storage: createMemoryStorage().storage,
    logger: silent,
  });
  const cvRow = () => db.cvs.find((cv) => cv.id === cvId)!;
  const question = (section: GenerationIssue['section']) =>
    db.questions.find((row) => row.cvId === cvId && row.section === section)!;

  return {
    worker,
    repositories,
    db,
    requests,
    cvRow,
    question,
    onApply(next: ApplyAnswer) {
      apply = next;
    },
    /** Answers the question about `section`, as the API does. */
    answer: (section: GenerationIssue['section'], text: string) =>
      questions.answer(USER, cvId, question(section).id, { answer: text }),
    /** Saves an edit made in the editor to the CV as it is now. */
    edit(change: (content: CvContent) => void) {
      const content = CvContentSchema.parse(cvRow().content);
      change(content);
      return cvs.saveContent(USER, cvId, content, cvRow().contentVersion);
    },
    content: () => CvContentSchema.parse(cvRow().content),
    answerJobs: () => db.jobs.filter((job) => job.kind === 'APPLY_ANSWER'),
  };
}

describe('answer jobs', () => {
  it('applies an answer around the edits the person saved while it ran', async () => {
    const { worker, onApply, answer, edit, content, cvRow, question, answerJobs } =
      await setupAnswers();
    onApply(async () => {
      // While the AI works, the person edits another section and another field of the same role.
      await edit((cv) => {
        cv.summary = 'Leads a small ML team.';
        cv.experience[0]!.location = 'Lisbon';
      });
      return roleUpdate({
        title: 'Lead ML Engineer',
        addBullets: ['Led a team of five engineers.'],
      });
    });
    await answer('experience', 'I was the lead of a team of five engineers.');

    await worker.tick();

    const added = content().experience[0]!.bullets[1]!;
    expect(content()).toEqual({
      ...DRAFT,
      summary: 'Leads a small ML team.',
      experience: [
        {
          ...DRAFT.experience[0]!,
          title: 'Lead ML Engineer',
          location: 'Lisbon',
          bullets: [
            ...DRAFT.experience[0]!.bullets,
            { id: added.id, text: 'Led a team of five engineers.' },
          ],
        },
      ],
    });
    // Generated (1), the person's edit (2), the answer (3).
    expect(cvRow().contentVersion).toBe(3);
    expect(question('experience')).toMatchObject({ status: 'ANSWERED', followUp: null });
    expect(answerJobs()[0]).toMatchObject({
      status: 'COMPLETED',
      result: {
        outcome: 'updated',
        applied: ['experience.experience-1.title', `experience.experience-1.bullets.${added.id}`],
      },
    });
  });

  it('keeps the person’s value of a field they changed while the answer ran', async () => {
    const { worker, onApply, answer, edit, content, cvRow, question, answerJobs } =
      await setupAnswers();
    onApply(async () => {
      await edit((cv) => {
        cv.experience[0]!.title = 'Staff ML Engineer';
      });
      return roleUpdate({ title: 'Lead ML Engineer' });
    });
    await answer('experience', 'I was the team lead.');

    await worker.tick();

    expect(content().experience[0]!.title).toBe('Staff ML Engineer');
    // Only the person's edit was written.
    expect(cvRow().contentVersion).toBe(2);
    expect(question('experience')).toMatchObject({ status: 'ANSWERED' });
    expect(answerJobs()[0]).toMatchObject({
      status: 'COMPLETED',
      result: { outcome: 'no_change', applied: [] },
    });
  });

  it('changes nothing when the person deleted the role while the answer ran', async () => {
    const { worker, onApply, answer, edit, content, cvRow, answerJobs } = await setupAnswers();
    onApply(async () => {
      await edit((cv) => {
        cv.experience = [];
      });
      return roleUpdate({
        title: 'Lead ML Engineer',
        addBullets: ['Led a team of five engineers.'],
      });
    });
    await answer('experience', 'I was the lead of a team of five engineers.');

    await worker.tick();

    expect(content()).toEqual({ ...DRAFT, experience: [] });
    expect(cvRow().contentVersion).toBe(2);
    expect(answerJobs()[0]).toMatchObject({
      status: 'COMPLETED',
      result: { outcome: 'no_change', applied: [] },
    });
  });

  it('gives the updater the CV as it is when the job starts, with the question and the answer', async () => {
    const { worker, onApply, answer, edit, requests, answerJobs } = await setupAnswers();
    onApply(() => roleUpdate({}));
    await answer('experience', 'I led a team of five engineers.');
    // Saved after answering but before the job started: the update builds on it.
    await edit((cv) => {
      cv.summary = 'Leads a small ML team.';
    });

    await worker.tick();

    const input = {
      targetRole: 'AI Engineer',
      question: {
        section: 'experience',
        kind: 'incomplete',
        target: 'Experience · Northpay',
        itemId: 'experience-1',
        question: 'How big was the team you led at Northpay?',
        why: 'Team size shows the scope of your role.',
      },
      answer: 'I led a team of five engineers.',
      followUp: null,
      previousAnswer: null,
    };
    // The job keeps the answer, never a copy of the CV: that is read when the job starts.
    expect(answerJobs()[0]!.input).toEqual(input);
    expect(requests).toEqual([{ ...input, cv: { ...DRAFT, summary: 'Leads a small ML team.' } }]);
  });

  it('applies two answers to one CV one after the other, the second on top of the first', async () => {
    const { worker, repositories, onApply, answer, content, cvRow, requests, answerJobs } =
      await setupAnswers();
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    onApply(async (request) => {
      if (request.question.section === 'skills') return { followUp: '', addSkills: ['AWS'] };
      await released;
      return roleUpdate({ addBullets: ['Led a team of five engineers.'] });
    });
    await answer('experience', 'I led a team of five engineers.');
    await answer('skills', 'AWS');

    const first = worker.tick();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    // While the first runs, the second answer can't be claimed.
    expect(await repositories.generation.claimNext()).toBeNull();
    expect(answerJobs().map((job) => job.status)).toEqual(['PROCESSING', 'PENDING']);

    release();
    await first;
    const afterFirst = content();
    expect(await worker.tick()).toBe(true);

    expect(requests.map((request) => request.question.section)).toEqual(['experience', 'skills']);
    expect(requests[1]!.cv).toEqual(afterFirst);
    expect(content().experience[0]!.bullets.map((bullet) => bullet.text)).toEqual([
      'Built the retrieval pipeline behind support search.',
      'Led a team of five engineers.',
    ]);
    expect(content().skills.map((skill) => skill.name)).toEqual(['Python', 'PyTorch', 'AWS']);
    expect(cvRow().contentVersion).toBe(3);
    expect(answerJobs().map((job) => job.status)).toEqual(['COMPLETED', 'COMPLETED']);
  });

  it('claims answers before older pending generations', async () => {
    const { worker, repositories, db, onApply, answer, answerJobs } = await setupAnswers();
    onApply(() => ({ followUp: '', addSkills: ['AWS'] }));
    // Another CV's generation was queued before the answer.
    const otherCvId = await queueGeneration(repositories);
    await answer('skills', 'AWS');
    const generation = () => db.jobs.find((job) => job.cvId === otherCvId)!;

    await worker.tick();

    expect(answerJobs()[0]).toMatchObject({ status: 'COMPLETED' });
    expect(generation()).toMatchObject({ status: 'PENDING' });

    await worker.tick();

    expect(generation()).toMatchObject({ status: 'COMPLETED' });
  });

  it('reopens the question with the AI’s follow-up and leaves the CV as it is', async () => {
    const { worker, onApply, answer, cvRow, question, answerJobs } = await setupAnswers();
    onApply(() => roleUpdate({}, 'How many engineers were on the team?'));
    await answer('experience', 'A few people.');

    await worker.tick();

    expect(question('experience')).toMatchObject({
      status: 'OPEN',
      answer: 'A few people.',
      followUp: 'How many engineers were on the team?',
    });
    expect(cvRow().content).toEqual(DRAFT);
    expect(cvRow().contentVersion).toBe(1);
    expect(answerJobs()[0]).toMatchObject({
      status: 'COMPLETED',
      result: { outcome: 'needs_more_info', applied: [] },
    });
  });

  it('sends the follow-up and the earlier answer with the next answer, and asks only once', async () => {
    const { worker, onApply, answer, content, question, requests, answerJobs } =
      await setupAnswers();
    onApply(() => roleUpdate({}, 'How many engineers were on the team?'));
    await answer('experience', 'A few people.');
    await worker.tick();

    // The AI asks again, but a question gets one follow-up at most: what is clear is applied.
    onApply(() =>
      roleUpdate({ addBullets: ['Led a team of five engineers.'] }, 'Since when did you lead it?'),
    );
    await answer('experience', 'Five engineers.');
    await worker.tick();

    expect(requests[1]).toMatchObject({
      answer: 'Five engineers.',
      followUp: 'How many engineers were on the team?',
      previousAnswer: 'A few people.',
    });
    expect(question('experience')).toMatchObject({
      status: 'ANSWERED',
      answer: 'Five engineers.',
      followUp: null,
    });
    expect(content().experience[0]!.bullets.map((bullet) => bullet.text)).toEqual([
      'Built the retrieval pipeline behind support search.',
      'Led a team of five engineers.',
    ]);
    expect(answerJobs()[1]).toMatchObject({ status: 'COMPLETED', result: { outcome: 'updated' } });
  });

  it('fails an answer whose saved input no longer reads with INVALID_INPUT, changing nothing', async () => {
    const { worker, answer, cvRow, requests, answerJobs } = await setupAnswers();
    await answer('skills', 'AWS');
    Object.assign(answerJobs()[0]!, { input: {} });

    await worker.tick();

    expect(requests).toEqual([]);
    expect(answerJobs()[0]).toMatchObject({ status: 'FAILED', errorCode: 'INVALID_INPUT' });
    expect(cvRow().content).toEqual(DRAFT);
  });

  it('asks for the email itself when the AI’s email isn’t in the answer', async () => {
    const { worker, onApply, answer, cvRow, question, answerJobs } = await setupAnswers();
    onApply(() => contactUpdate({ email: 'alex.morgan@example.com' }));
    await answer('contact', 'Use my usual work email.');

    await worker.tick();

    expect(question('contact')).toMatchObject({
      status: 'OPEN',
      followUp: 'Type the full email address, like name@example.com.',
    });
    expect(cvRow().content).toEqual(DRAFT);
    expect(answerJobs()[0]).toMatchObject({
      status: 'COMPLETED',
      result: { outcome: 'needs_more_info', applied: [] },
    });
  });

  it('leaves out an addition that no longer fits once the person filled the list', async () => {
    const { worker, onApply, answer, edit, content, cvRow, answerJobs } = await setupAnswers();
    onApply(async () => {
      // Meanwhile the person fills the skills up to their limit.
      await edit((cv) => {
        for (let index = cv.skills.length; index < CV_LIMITS.skills; index += 1) {
          cv.skills.push({ id: `typed-${index}`, name: `Skill ${index}` });
        }
      });
      return { followUp: '', addSkills: ['AWS'] };
    });
    await answer('skills', 'AWS');

    await worker.tick();

    expect(content().skills).toHaveLength(CV_LIMITS.skills);
    expect(content().skills.map((skill) => skill.name)).not.toContain('AWS');
    expect(cvRow().contentVersion).toBe(2);
    expect(answerJobs()[0]).toMatchObject({
      status: 'COMPLETED',
      result: { outcome: 'no_change', applied: [] },
    });
  });

  it('fails with INVALID_OUTPUT when the update isn’t shaped for the question’s section', async () => {
    const { worker, onApply, answer, cvRow, question, answerJobs } = await setupAnswers();
    // An answer about a role can't rewrite the summary.
    onApply(() => ({ followUp: '', summary: 'A summary the question never asked about.' }));
    await answer('experience', 'I led a team of five engineers.');

    await worker.tick();

    expect(answerJobs()[0]).toMatchObject({
      status: 'FAILED',
      errorCode: 'INVALID_OUTPUT',
      errorMessage: JOB_FAILURES.invalidOutput.message,
      result: null,
    });
    expect(question('experience')).toMatchObject({ status: 'ANSWERED' });
    expect(cvRow().content).toEqual(DRAFT);
    expect(cvRow().contentVersion).toBe(1);
  });

  it('fails with AI_INVALID_UPDATE, writing nothing, when the merged CV can’t be stored', async () => {
    const { worker, onApply, answer, cvRow, question, answerJobs } = await setupAnswers();
    // Fits the answer schema, but CV content can't hold U+0000.
    onApply(() => roleUpdate({ title: 'Lead\u0000ML Engineer' }));
    await answer('experience', 'I was the team lead.');

    await worker.tick();

    expect(answerJobs()[0]).toMatchObject({
      status: 'FAILED',
      errorCode: 'AI_INVALID_UPDATE',
      errorMessage: JOB_FAILURES.aiInvalidUpdate.message,
      result: null,
    });
    expect(question('experience')).toMatchObject({ status: 'ANSWERED' });
    expect(cvRow().content).toEqual(DRAFT);
    expect(cvRow().contentVersion).toBe(1);
  });

  it('records an updater failure with its code, and the answer can be tried again', async () => {
    const { worker, onApply, answer, cvRow, question, answerJobs } = await setupAnswers();
    onApply(() => {
      throw new GenerationError(JOB_FAILURES.aiRateLimited);
    });
    await answer('experience', 'I led a team of five engineers.');

    await worker.tick();

    expect(answerJobs()[0]).toMatchObject({
      status: 'FAILED',
      errorCode: 'AI_RATE_LIMITED',
      errorMessage: JOB_FAILURES.aiRateLimited.message,
    });
    expect(question('experience')).toMatchObject({ status: 'ANSWERED' });
    expect(cvRow().content).toEqual(DRAFT);
    await expect(answer('experience', 'I led a team of five engineers.')).resolves.toMatchObject({
      status: 'ANSWERED',
    });
  });

  it('fails a hung answer with AI_TIMEOUT at its deadline', async () => {
    let seen!: AbortSignal;
    const { worker, onApply, answer, cvRow, answerJobs } = await setupAnswers({
      answerTimeoutMs: 50,
    });
    onApply((_request, { signal }) => {
      seen = signal;
      return hang();
    });
    await answer('experience', 'I led a team of five engineers.');

    await worker.tick();

    expect(seen.aborted).toBe(true);
    expect(answerJobs()[0]).toMatchObject({
      status: 'FAILED',
      errorCode: 'AI_TIMEOUT',
      errorMessage: JOB_FAILURES.aiTimeout.message,
    });
    expect(cvRow().content).toEqual(DRAFT);
  });

  it('never reopens a question dismissed while its answer ran', async () => {
    const { worker, onApply, answer, question, answerJobs } = await setupAnswers();
    onApply(() => roleUpdate({}, 'How many engineers were on the team?'));
    await answer('experience', 'A few people.');
    // The API can't dismiss it while the answer runs; the completion must not reopen it either.
    question('experience').status = 'DISMISSED';

    await worker.tick();

    expect(question('experience')).toMatchObject({ status: 'DISMISSED', followUp: null });
    expect(answerJobs()[0]).toMatchObject({
      status: 'COMPLETED',
      result: { outcome: 'needs_more_info', applied: [] },
    });
  });
});
