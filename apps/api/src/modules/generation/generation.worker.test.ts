import { type CvContent, CvContentSchema } from '@cv-builder/shared';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createInMemoryRepositories } from '../../test/in-memory-repositories';
import { type CvGenerator, GenerationError } from './cv-generator';
import { toGenerationInput } from './generation.service';
import { createGenerationWorker } from './generation.worker';
import { createMockCvGenerator } from './mock-cv-generator';

const USER = '0199a000-0000-7000-8000-00000000000a';

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

/** A CV with a queued generation job, plus a worker wired to the in-memory repository. */
async function setup(generator: CvGenerator) {
  const { repositories, db } = createInMemoryRepositories();
  const cv = await repositories.cvs.create(USER, {
    title: 'AI Engineer',
    targetRole: 'AI Engineer',
    sourceText: 'Built retrieval pipelines and evaluation tooling for three years.',
  });
  const started = await repositories.generation.startJob(USER, cv.id, toGenerationInput);
  if (started.kind !== 'created') throw new Error('job not created');

  const worker = createGenerationWorker({
    repository: repositories.generation,
    generator,
    logger: pino({ level: 'silent' }),
    pollIntervalMs: 5,
  });
  const job = () => db.jobs[0]!;
  return { worker, db, job, cvRow: () => db.cvs[0]! };
}

/** Walks through the four steps, recording them, and returns `output`. */
function scriptedGenerator(output: unknown, steps: number[] = []): CvGenerator {
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
  it('runs a queued job through its steps and saves the result on the CV', async () => {
    const steps: number[] = [];
    const { worker, job, cvRow } = await setup(scriptedGenerator(CONTENT, steps));

    expect(await worker.tick()).toBe(true);

    expect(steps).toEqual([0, 1, 2, 3]);
    expect(job()).toMatchObject({ status: 'SUCCEEDED', progressStep: 4, attempts: 1 });
    expect(cvRow()).toMatchObject({ content: CONTENT, contentVersion: 1 });
    expect(await worker.tick()).toBe(false);
  });

  it('records a generator failure with its user-facing message', async () => {
    const { worker, job, cvRow } = await setup({
      async generate() {
        throw new GenerationError('AI_TIMEOUT', 'The AI service didn’t respond in time.');
      },
    });

    await worker.tick();

    expect(job()).toMatchObject({
      status: 'FAILED',
      errorCode: 'AI_TIMEOUT',
      errorMessage: 'The AI service didn’t respond in time.',
    });
    expect(cvRow().content).toBeNull();
  });

  it('never saves output that fails validation', async () => {
    const { worker, job, cvRow } = await setup(scriptedGenerator({ version: 2, summary: 42 }));

    await worker.tick();

    expect(job()).toMatchObject({ status: 'FAILED', errorCode: 'INVALID_OUTPUT' });
    expect(cvRow().content).toBeNull();
  });

  it('stops writing once another run has taken the job over', async () => {
    const { worker, job } = await setup({
      async generate(_input, { onStep }) {
        await onStep(0);
        // Meanwhile the job went stale and another worker claimed it (a new attempt).
        Object.assign(job(), { attempts: job().attempts + 1 });
        await onStep(1);
        return CONTENT;
      },
    });

    await worker.tick();

    expect(job()).toMatchObject({ status: 'RUNNING', attempts: 2 });
  });

  it('puts abandoned jobs back in the queue and fails them after three attempts', async () => {
    const { worker, job } = await setup(scriptedGenerator(CONTENT));
    Object.assign(job(), { status: 'RUNNING', attempts: 1, heartbeatAt: new Date(0) });

    await worker.tick();
    expect(job()).toMatchObject({ status: 'SUCCEEDED', attempts: 2 });

    Object.assign(job(), { status: 'RUNNING', attempts: 3, heartbeatAt: new Date(0) });
    expect(await worker.tick()).toBe(false);
    expect(job()).toMatchObject({ status: 'FAILED', errorCode: 'WORKER_LOST' });
  });

  it('hands a running job back to the queue when it stops', async () => {
    let started!: () => void;
    const running = new Promise<void>((resolve) => (started = resolve));
    const { worker, job } = await setup({
      async generate(_input, { signal, onStep }) {
        await onStep(1);
        started();
        await new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason)),
        );
        return CONTENT;
      },
    });

    worker.start();
    await running;
    await worker.stop();

    expect(job()).toMatchObject({ status: 'QUEUED', attempts: 0, progressStep: 0 });
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
  });

  it('walks the four steps and returns valid sample content', async () => {
    const steps: number[] = [];
    const output = await createMockCvGenerator({ stepMs: 0, failRate: 0 }).generate(
      input,
      hooks(steps),
    );

    expect(steps).toEqual([0, 1, 2, 3]);
    expect(CvContentSchema.parse(output).contact.headline).toBe('Data Engineer');
  });

  it('can be told to fail, to try the failure screen', async () => {
    const generator = createMockCvGenerator({ stepMs: 0, failRate: 1 });

    await expect(generator.generate(input, hooks())).rejects.toBeInstanceOf(GenerationError);
  });
});
