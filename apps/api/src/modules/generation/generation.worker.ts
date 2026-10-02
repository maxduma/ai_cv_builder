import { setTimeout as sleep } from 'node:timers/promises';
import { CvContentSchema } from '@cv-builder/shared';
import type { Logger } from '../../lib/logger';
import { type CvGenerator, GenerationError } from './cv-generator';
import { GenerationInputSchema } from './generation.input';
import type {
  ClaimedJob,
  GenerationRepository,
  JobFailure,
  JobLease,
} from './generation.repository';

export type GenerationWorkerRepository = Pick<
  GenerationRepository,
  'recoverStale' | 'claimNext' | 'heartbeat' | 'succeed' | 'fail' | 'release'
>;

interface Options {
  repository: GenerationWorkerRepository;
  generator: CvGenerator;
  logger: Logger;
  /** Wait between queue checks while there is nothing to do. */
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  /** A RUNNING job without a heartbeat for this long is considered abandoned. */
  staleAfterMs?: number;
  maxAttempts?: number;
}

/** Another run claimed the job after this one went stale; this run must not write anymore. */
class LeaseLostError extends Error {
  override name = 'LeaseLostError';
}

const FAILURES = {
  invalidInput: {
    code: 'INVALID_INPUT',
    message: 'The saved details for this CV couldn’t be read. Edit them and try again.',
  },
  invalidOutput: {
    code: 'INVALID_OUTPUT',
    message: 'The AI returned a CV we couldn’t use. Try again.',
  },
  unexpected: {
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong while writing your CV. Try again.',
  },
} satisfies Record<string, JobFailure>;

/**
 * Runs queued generation jobs inside the API process, one at a time. Nothing depends on the
 * browser: the job's state lives in PostgreSQL, and a job whose worker died is picked up again.
 */
export function createGenerationWorker({
  repository,
  generator,
  logger,
  pollIntervalMs = 1_000,
  heartbeatIntervalMs = 5_000,
  staleAfterMs = 30_000,
  maxAttempts = 3,
}: Options) {
  let running = false;
  let stopping = false;
  let loop: Promise<void> | undefined;
  let currentJob: AbortController | undefined;
  let idleWait: AbortController | undefined;

  async function recordFailure(lease: JobLease, failure: JobFailure, log: Logger, cause: unknown) {
    const recorded = await repository.fail(lease, failure);
    log.warn({ err: cause, code: failure.code, recorded }, 'Generation failed');
  }

  async function processJob(job: ClaimedJob) {
    const lease: JobLease = { jobId: job.jobId, attempts: job.attempts };
    const log = logger.child({ jobId: job.jobId, cvId: job.cvId, attempt: job.attempts });

    // Claimed just as the worker was stopping: hand it straight back.
    if (stopping) {
      await repository.release(lease);
      return;
    }

    const controller = new AbortController();
    currentJob = controller;
    const heartbeat = setInterval(() => {
      repository.heartbeat(lease).then(
        (held) => {
          if (!held) controller.abort(new LeaseLostError());
        },
        (error: unknown) => log.warn({ err: error }, 'Heartbeat failed'),
      );
    }, heartbeatIntervalMs);

    try {
      // The input was validated when the job was created, but it comes back from the database.
      const input = GenerationInputSchema.safeParse(job.input);
      if (!input.success) {
        await recordFailure(lease, FAILURES.invalidInput, log, input.error);
        return;
      }

      const output = await generator.generate(input.data, {
        signal: controller.signal,
        onStep: async (step) => {
          if (!(await repository.heartbeat(lease, step))) throw new LeaseLostError();
        },
      });

      // Generated content is never trusted: it must match the CV content schema.
      const content = CvContentSchema.safeParse(output);
      if (!content.success) {
        await recordFailure(lease, FAILURES.invalidOutput, log, content.error);
        return;
      }

      if (await repository.succeed(lease, content.data)) {
        log.info('Generation succeeded');
      } else {
        log.warn('Lost the job before its result could be saved');
      }
    } catch (error) {
      if (error instanceof LeaseLostError || controller.signal.reason instanceof LeaseLostError) {
        log.warn('Another run took over this job; dropping this one');
      } else if (controller.signal.aborted && stopping) {
        await repository.release(lease);
        log.info('Interrupted by shutdown; job returned to the queue');
      } else if (error instanceof GenerationError) {
        await recordFailure(lease, { code: error.code, message: error.userMessage }, log, error);
      } else {
        await recordFailure(lease, FAILURES.unexpected, log, error);
      }
    } finally {
      clearInterval(heartbeat);
      currentJob = undefined;
    }
  }

  /** One round: recover abandoned jobs, then run the oldest queued one. True if there was work. */
  async function tick(): Promise<boolean> {
    const recovered = await repository.recoverStale(
      new Date(Date.now() - staleAfterMs),
      maxAttempts,
    );
    if (recovered.requeued > 0 || recovered.failed > 0) {
      logger.warn(recovered, 'Recovered abandoned generation jobs');
    }

    const job = await repository.claimNext();
    if (!job) return false;
    await processJob(job);
    return true;
  }

  async function run() {
    while (running) {
      let foundWork = false;
      try {
        foundWork = await tick();
      } catch (error) {
        logger.error({ err: error }, 'Generation worker round failed');
      }
      if (!foundWork && running) {
        idleWait = new AbortController();
        await sleep(pollIntervalMs, undefined, { signal: idleWait.signal }).catch(() => {});
        idleWait = undefined;
      }
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      stopping = false;
      loop = run();
    },

    /** Stops the worker. A job in progress is interrupted and returned to the queue. */
    async stop() {
      running = false;
      stopping = true;
      currentJob?.abort();
      idleWait?.abort();
      await loop;
    },

    tick,
  };
}

export type GenerationWorker = ReturnType<typeof createGenerationWorker>;
