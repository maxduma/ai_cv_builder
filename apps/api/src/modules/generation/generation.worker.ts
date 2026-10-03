import { setTimeout as sleep } from 'node:timers/promises';
import {
  CvContentSchema,
  type GenerationIssue,
  GenerationIssuesSchema,
  isStorableText,
} from '@cv-builder/shared';
import type { Logger } from '../../lib/logger';
import { applyAnswerChanges, resolveAnswer } from './answers/answer-changes';
import { AnswerInputSchema, type AnswerUpdater } from './answers/answer-input';
import { ANSWER_UPDATE_SCHEMAS } from './answers/answer-update.schema';
import { type CvGenerator, GenerationError } from './cv-generator';
import { JOB_FAILURES } from './generation.failures';
import { GenerationInputSchema } from './generation.input';
import type {
  ClaimedJob,
  GenerationRepository,
  JobFailure,
  JobLease,
} from './generation.repository';

export type GenerationWorkerRepository = Pick<
  GenerationRepository,
  'recoverStale' | 'claimNext' | 'heartbeat' | 'succeed' | 'completeAnswer' | 'fail' | 'release'
>;

interface Options {
  repository: GenerationWorkerRepository;
  generator: CvGenerator;
  /** Applies answers to questions (APPLY_ANSWER jobs). */
  answerUpdater: AnswerUpdater;
  logger: Logger;
  /**
   * How many jobs run at the same time, each in its own loop. A CV takes Claude a minute or more,
   * so one at a time would keep every other user waiting in line.
   */
  concurrency?: number;
  /**
   * Deadline for one generation, the generator's own retries included. Past it the job fails with
   * `AI_TIMEOUT`, even if the generator ignores its abort signal.
   */
  jobTimeoutMs?: number;
  /** The same for applying one answer. */
  answerTimeoutMs?: number;
  /** Wait between queue checks while there is nothing to do. */
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  /** A PROCESSING job without a heartbeat for this long is considered abandoned. */
  staleAfterMs?: number;
  maxAttempts?: number;
}

/**
 * The job is no longer this run's: another run claimed it after this one went stale, or its CV was
 * deleted (which deletes its jobs). This run must not write anymore.
 */
class LeaseLostError extends Error {
  override name = 'LeaseLostError';
}

/**
 * Settles like `work`, or rejects with the abort reason as soon as `signal` aborts, so a generator
 * that ignores its signal can't hold on to a job (and a worker loop) forever.
 */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/**
 * The issues only advise the user, so an invalid list is dropped rather than failing the CV, and so
 * is an issue whose text PostgreSQL can't store (it would fail the whole save).
 */
function validIssues(issues: unknown, log: Logger): GenerationIssue[] {
  const parsed = GenerationIssuesSchema.safeParse(issues);
  if (!parsed.success) {
    log.warn(
      { err: parsed.error },
      'The generated issues were invalid; saving the CV without them',
    );
    return [];
  }
  const storable = parsed.data.filter((issue) =>
    [issue.target, issue.question, issue.why].every(isStorableText),
  );
  if (storable.length < parsed.data.length) {
    log.warn({ dropped: parsed.data.length - storable.length }, 'Dropped unstorable issues');
  }
  return storable;
}

/**
 * Runs pending AI jobs inside the API process, `concurrency` at a time: CV generations, and
 * answers applied to questions. Nothing depends on the browser: the job's state lives in
 * PostgreSQL, and a job whose worker died is picked up again.
 */
export function createGenerationWorker({
  repository,
  generator,
  answerUpdater,
  logger,
  concurrency = 3,
  jobTimeoutMs = 240_000,
  answerTimeoutMs = 120_000,
  pollIntervalMs = 1_000,
  heartbeatIntervalMs = 5_000,
  staleAfterMs = 30_000,
  maxAttempts = 3,
}: Options) {
  let running = false;
  let stopping = false;
  let loops: Promise<void>[] = [];
  // What `stop()` interrupts: the jobs in progress and the loops waiting for work.
  const jobs = new Set<AbortController>();
  const idleWaits = new Set<AbortController>();

  async function recordFailure(lease: JobLease, failure: JobFailure, log: Logger, cause: unknown) {
    const recorded = await repository.fail(lease, failure);
    log.warn({ err: cause, code: failure.code, recorded }, 'Generation failed');
  }

  async function processJob(job: ClaimedJob) {
    const lease: JobLease = { jobId: job.jobId, attempts: job.attempts };
    const log = logger.child({
      jobId: job.jobId,
      cvId: job.cvId,
      kind: job.kind,
      attempt: job.attempts,
    });

    // Claimed just as the worker was stopping: hand it straight back.
    if (stopping) {
      await repository.release(lease);
      return;
    }

    // The work is stopped by the worker (shutdown, a lost lease) or by the job's deadline; which
    // of them fired decides what happens to the job (see the catch below).
    const controller = new AbortController();
    const deadline = AbortSignal.timeout(job.kind === 'GENERATE' ? jobTimeoutMs : answerTimeoutMs);
    const signal = AbortSignal.any([controller.signal, deadline]);
    jobs.add(controller);
    const heartbeat = setInterval(() => {
      repository.heartbeat(lease).then(
        (held) => {
          if (!held) controller.abort(new LeaseLostError());
        },
        (error: unknown) => log.warn({ err: error }, 'Heartbeat failed'),
      );
    }, heartbeatIntervalMs);

    try {
      if (job.kind === 'GENERATE') await generate(job, lease, signal, log);
      else await applyAnswer(job, lease, signal, log);
    } catch (error) {
      if (error instanceof LeaseLostError || controller.signal.reason instanceof LeaseLostError) {
        log.warn('The job is gone (taken over by another run, or its CV was deleted); dropping it');
      } else if (controller.signal.aborted && stopping) {
        await repository.release(lease);
        log.info('Interrupted by shutdown; job returned to the queue');
      } else if (deadline.aborted) {
        await recordFailure(lease, JOB_FAILURES.aiTimeout, log, error);
      } else if (error instanceof GenerationError) {
        await recordFailure(lease, { code: error.code, message: error.userMessage }, log, error);
      } else {
        await recordFailure(lease, JOB_FAILURES.internal, log, error);
      }
    } finally {
      clearInterval(heartbeat);
      jobs.delete(controller);
    }
  }

  async function generate(job: ClaimedJob, lease: JobLease, signal: AbortSignal, log: Logger) {
    // The input was validated when the job was created, but it comes back from the database.
    const input = GenerationInputSchema.safeParse(job.input);
    if (!input.success) {
      await recordFailure(lease, JOB_FAILURES.invalidInput, log, input.error);
      return;
    }

    const output = await abortable(
      generator.generate(input.data, {
        signal,
        log,
        onStep: async (step) => {
          // A database error isn't a lost lease: every write stays fenced by the lease, and the
          // periodic heartbeat and stale recovery cover a longer outage.
          const held = await repository.heartbeat(lease, step).catch((error: unknown) => {
            log.warn({ err: error }, 'Heartbeat failed');
            return true;
          });
          if (!held) throw new LeaseLostError();
        },
      }),
      signal,
    );

    // Generated content is never trusted: it must match the CV content schema.
    const content = CvContentSchema.safeParse(output.content);
    if (!content.success) {
      await recordFailure(lease, JOB_FAILURES.invalidOutput, log, content.error);
      return;
    }
    const issues = validIssues(output.issues, log);

    if (await repository.succeed(lease, content.data, issues)) {
      log.info({ issues: issues.length }, 'Generation completed');
    } else {
      log.warn('Lost the job before its result could be saved');
    }
  }

  /**
   * Applies an answer: Claude turns it into changes to one section of the CV as it was when the
   * job started (`job.base`), and those changes are merged into the CV as it is when they land,
   * so the person's edits made meanwhile win (see `resolveAnswer`).
   */
  async function applyAnswer(
    job: Extract<ClaimedJob, { kind: 'APPLY_ANSWER' }>,
    lease: JobLease,
    signal: AbortSignal,
    log: Logger,
  ) {
    const input = AnswerInputSchema.safeParse(job.input);
    const base = CvContentSchema.safeParse(job.base);
    if (!input.success || !base.success) {
      await recordFailure(lease, JOB_FAILURES.invalidInput, log, input.error ?? base.error);
      return;
    }
    const request = { ...input.data, cv: base.data };

    const output = await abortable(answerUpdater.apply(request, { signal, log }), signal);

    // Never trusted either: it must match the schema of the question's section.
    const update = ANSWER_UPDATE_SCHEMAS[request.question.section].safeParse(output);
    if (!update.success) {
      await recordFailure(lease, JOB_FAILURES.invalidOutput, log, update.error);
      return;
    }
    const changes = applyAnswerChanges(request, update.data);

    const result = await repository.completeAnswer(lease, (current) =>
      resolveAnswer(base.data, changes, current),
    );
    if (result === 'invalid') {
      await recordFailure(lease, JOB_FAILURES.aiInvalidUpdate, log, undefined);
    } else if (result === 'lost') {
      log.warn('Lost the job before its result could be saved');
    } else {
      log.info({ followUp: changes.kind === 'follow_up' }, 'Answer applied');
    }
  }

  /** One round: recover abandoned jobs, then run the oldest pending one. True if there was work. */
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

  /** One of the `concurrency` loops; they share nothing but the queue. */
  async function run() {
    while (running) {
      let foundWork = false;
      try {
        foundWork = await tick();
      } catch (error) {
        logger.error({ err: error }, 'Generation worker round failed');
      }
      if (!foundWork && running) {
        const idleWait = new AbortController();
        idleWaits.add(idleWait);
        await sleep(pollIntervalMs, undefined, { signal: idleWait.signal }).catch(() => {});
        idleWaits.delete(idleWait);
      }
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      stopping = false;
      loops = Array.from({ length: concurrency }, () => run());
    },

    /** Stops the worker. Jobs in progress are interrupted and returned to the queue. */
    async stop() {
      running = false;
      stopping = true;
      for (const job of jobs) job.abort();
      for (const idleWait of idleWaits) idleWait.abort();
      await Promise.all(loops);
    },

    tick,
  };
}

export type GenerationWorker = ReturnType<typeof createGenerationWorker>;
