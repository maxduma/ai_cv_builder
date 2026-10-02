import { setTimeout as sleep } from 'node:timers/promises';
import { type CvContent, CvContentSchema, type GenerationIssue } from '@cv-builder/shared';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryRepositories } from '../../test/in-memory-repositories';
import { type CvGenerator, type GeneratedCv, GenerationError } from './cv-generator';
import { JOB_FAILURES } from './generation.failures';
import { toGenerationInput } from './generation.service';
import { createGenerationWorker, type GenerationWorker } from './generation.worker';
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

/** The worker's tuning options, plus how many CVs with a pending job to create. */
type SetupOptions = Omit<
  Parameters<typeof createGenerationWorker>[0],
  'repository' | 'generator' | 'logger'
> & { jobs?: number };

/** CVs with a pending generation job each, plus a worker wired to the in-memory repository. */
async function setup(generator: CvGenerator, { jobs = 1, ...options }: SetupOptions = {}) {
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
    repository: repositories.generation,
    generator,
    logger: silent,
    pollIntervalMs: 5,
    ...options,
  });
  workers.push(worker);
  const job = () => db.jobs[0]!;
  return { worker, db, job, cvRow: () => db.cvs[0]! };
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

  it('walks the four steps and returns valid sample content without issues', async () => {
    const steps: number[] = [];
    const output = await createMockCvGenerator({ stepMs: 0, failRate: 0 }).generate(
      input,
      hooks(steps),
    );

    expect(steps).toEqual([0, 1, 2, 3]);
    expect(CvContentSchema.parse(output.content).contact.headline).toBe('Data Engineer');
    expect(output.issues).toEqual([]);
  });

  it('can be told to fail, to try the failure screen', async () => {
    const generator = createMockCvGenerator({ stepMs: 0, failRate: 1 });

    await expect(generator.generate(input, hooks())).rejects.toMatchObject({
      name: 'GenerationError',
      code: 'AI_TIMEOUT',
    });
  });
});
