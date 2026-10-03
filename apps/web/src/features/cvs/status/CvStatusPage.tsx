import {
  type CvDetail,
  GENERATION_STEP_COUNT,
  type GenerationJobDto,
  isTerminalJobStatus,
} from '@cv-builder/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type RefObject, useEffect, useRef } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { ApiError } from '../../../lib/api-client';
import { formatDuration, formatRelativeTime } from '../../../lib/format';
import { useNow } from '../../../lib/use-now';
import { NotFoundPage } from '../../../pages/NotFoundPage';
import { FloatingDocArt } from '../../../ui/FloatingDocArt';
import {
  ArrowRightIcon,
  CheckIcon,
  CloseIcon,
  CvThumbIcon,
  ErrorIcon,
  RetryIcon,
} from '../../../ui/icons';
import { StatusChip } from '../../../ui/StatusChip';
import { cacheStartedJob, cvKeys, cvsApi, useCv, useGenerationJob } from '../api';
import './status.css';

/** Where the bar stands when each step begins (the design's progress marks). */
const STEP_MARKS = [0, 22, 42, 86, 100];
/** "Usually about 1 min": the bar advances with time, but never past the current step. */
const EXPECTED_DURATION_MS = 60_000;

const ACTIVE_DETAILS = [
  'Pulling out roles, dates and skills…',
  'Comparing your experience with the role…',
  'Rewriting each role around results…',
  'Checking length, tone and spelling…',
];

function classes(...names: (string | false | null | undefined)[]) {
  return names.filter(Boolean).join(' ');
}

function stepLabels(cv: CvDetail): string[] {
  let reading = 'Reading your notes';
  if (cv.sourceDocument && cv.sourceText) reading = 'Reading your CV and notes';
  else if (cv.sourceDocument) reading = 'Reading your CV';
  return [
    reading,
    'Matching it to the role',
    'Writing your experience',
    'Formatting and final checks',
  ];
}

/** Time counts from the moment Generate was pressed, queue wait included, as the user sees it. */
function requestedAt(job: GenerationJobDto): number {
  return Date.parse(job.createdAt);
}

function progressPercent(job: GenerationJobDto, now: number): number {
  if (job.status === 'COMPLETED') return 100;
  const step = Math.min(job.step, GENERATION_STEP_COUNT - 1);
  const stepStart = STEP_MARKS[step] ?? 0;
  if (job.status === 'FAILED') return stepStart;
  const nextStep = STEP_MARKS[step + 1] ?? 100;
  const byTime = Math.round(((now - requestedAt(job)) / EXPECTED_DURATION_MS) * 100);
  return Math.min(Math.max(byTime, stepStart), nextStep - 1);
}

/** `/cvs/:cvId`: where a CV's generation can be followed, retried, or seen finished. */
export function CvStatusPage() {
  const { cvId = '' } = useParams();
  const queryClient = useQueryClient();
  const { data: cv, error } = useCv(cvId);
  const { data: polledJob } = useGenerationJob(cv?.latestGeneration ?? null);
  const job = polledJob ?? cv?.latestGeneration ?? null;

  // Once the job finishes, the CV (and its card in My CVs) has a new status.
  const finishedStatus = job && isTerminalJobStatus(job.status) ? job.status : null;
  useEffect(() => {
    if (finishedStatus) void queryClient.invalidateQueries({ queryKey: cvKeys.all });
  }, [finishedStatus, queryClient]);

  // A failed background refetch keeps the CV on screen: only a first load can fail here.
  if (!cv) {
    if (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
        return <NotFoundPage />;
      }
      throw error;
    }
    return <main className="page-main is-gen" aria-busy="true" />;
  }
  // Never generated: the CV is still a draft, so open the form.
  if (!job) {
    return <Navigate to="edit" replace />;
  }
  return <GenerationStatus cv={cv} job={job} />;
}

function GenerationStatus({ cv, job }: { cv: CvDetail; job: GenerationJobDto }) {
  // The job may report COMPLETED a moment before the CV (with its questions) is fetched again:
  // until then the progress stays on screen, full, instead of flashing an incomplete "ready".
  const done = job.status === 'COMPLETED' && cv.status === 'ready';
  const running = !isTerminalJobStatus(job.status) || (job.status === 'COMPLETED' && !done);
  const now = useNow(running ? 1_000 : 60_000);
  const labels = stepLabels(cv);
  const role = cv.targetRole ?? 'your target role';

  // Focus follows the work: the title while it runs, then the next action.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLAnchorElement>(null);
  const view = done ? 'done' : job.status === 'FAILED' ? 'failed' : 'running';
  useEffect(() => {
    if (view === 'failed') retryRef.current?.focus();
    else if (view === 'done') doneRef.current?.focus();
    else titleRef.current?.focus();
  }, [view]);

  const step = Math.min(job.step, GENERATION_STEP_COUNT - 1);
  const percent = progressPercent(job, now);
  const elapsed = (job.finishedAt ? Date.parse(job.finishedAt) : now) - requestedAt(job);

  let live = '';
  if (running) live = `Step ${step + 1} of ${GENERATION_STEP_COUNT}: ${labels[step]}.`;
  else if (done) live = 'Your CV is ready.';

  return (
    <main className="page-main is-gen">
      <title>
        {running
          ? 'Generating your CV · CV Builder'
          : job.status === 'FAILED'
            ? 'Generation failed · CV Builder'
            : 'Your CV is ready · CV Builder'}
      </title>
      <section className="gen" aria-labelledby="gen-title">
        <FloatingDocArt
          variant={running ? 'generating' : job.status === 'FAILED' ? 'failed' : 'done'}
        />

        {running && (
          <>
            <h1 id="gen-title" ref={titleRef} className="gen-title" tabIndex={-1}>
              Creating your CV for <span className="gen-em">{role}</span>
            </h1>
            <p className="gen-sub">
              This can take a minute or two. Feel free to leave — we’ll save the draft to My CVs
              when it’s done.
            </p>
            <ProgressCard job={job} labels={labels} percent={percent} elapsed={elapsed} />
            <div className="gen-actions">
              <Link to="/" className="btn btn-secondary">
                Go to My CVs
              </Link>
            </div>
          </>
        )}

        {job.status === 'FAILED' && (
          <FailedView
            cv={cv}
            job={job}
            labels={labels}
            percent={percent}
            elapsed={elapsed}
            retryRef={retryRef}
          />
        )}

        {done && <ReadyView cv={cv} job={job} role={role} now={now} doneRef={doneRef} />}
      </section>

      <p className="sr-only" role="status" aria-live="polite">
        {live}
      </p>
    </main>
  );
}

/**
 * "Your CV is ready": on to the AI's questions when it has some, otherwise straight to the editor.
 */
function ReadyView({
  cv,
  job,
  role,
  now,
  doneRef,
}: {
  cv: CvDetail;
  job: GenerationJobDto;
  role: string;
  now: number;
  doneRef: RefObject<HTMLAnchorElement | null>;
}) {
  const questions = cv.questions.filter((question) => question.status === 'open').length;
  const quick = `${questions} quick ${questions === 1 ? 'question' : 'questions'}`;
  return (
    <>
      <h1 id="gen-title" className="gen-title">
        Your CV is ready
      </h1>
      {questions > 0 ? (
        <p className="gen-sub">
          A one-page draft for <strong>{role}</strong> is saved in My CVs. Answer {quick} to make it
          more specific, or go straight to the editor.
        </p>
      ) : (
        <p className="gen-sub">
          A first draft for <strong>{role}</strong> is saved in My CVs.
        </p>
      )}
      <div className="done-card">
        <CvThumbIcon className="done-thumb" />
        <span className="done-text">
          <span className="done-title">{cv.title}</span>
          <span className="done-meta">
            Created {formatRelativeTime(job.finishedAt ?? job.createdAt, now)}
          </span>
        </span>
        <StatusChip status="ready" />
      </div>
      <div className="gen-actions">
        {questions > 0 ? (
          <>
            <Link ref={doneRef} to={`/cvs/${cv.id}/questions`} className="btn btn-primary">
              <span>Answer {quick}</span>
              <ArrowRightIcon />
            </Link>
            <Link to={`/cvs/${cv.id}/editor`} className="btn btn-secondary">
              Open the editor
            </Link>
          </>
        ) : (
          <Link ref={doneRef} to={`/cvs/${cv.id}/editor`} className="btn btn-primary">
            <span>Open the editor</span>
            <ArrowRightIcon />
          </Link>
        )}
      </div>
    </>
  );
}

function FailedView({
  cv,
  job,
  labels,
  percent,
  elapsed,
  retryRef,
}: {
  cv: CvDetail;
  job: GenerationJobDto;
  labels: string[];
  percent: number;
  elapsed: number;
  retryRef: RefObject<HTMLButtonElement | null>;
}) {
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: () => cvsApi.startGeneration(cv.id),
    onSuccess: (newJob) => cacheStartedJob(queryClient, cv, newJob),
    onError: (error) => {
      // Already running again (another tab): pick that job up.
      if (error instanceof ApiError && error.code === 'GENERATION_IN_PROGRESS') {
        void queryClient.invalidateQueries({ queryKey: cvKeys.detail(cv.id) });
      }
    },
  });
  const failedStep = labels[Math.min(job.step, GENERATION_STEP_COUNT - 1)] ?? 'Generation';
  const retryError =
    retry.error &&
    !(retry.error instanceof ApiError && retry.error.code === 'GENERATION_IN_PROGRESS')
      ? retry.error instanceof ApiError
        ? retry.error.message
        : 'Something went wrong. Try again in a moment.'
      : null;

  return (
    <>
      <div role="alert">
        <h1 id="gen-title" className="gen-title">
          We couldn’t finish your CV
        </h1>
        <p className="gen-sub">
          {failedStep} didn’t finish. Your role, CV and notes are saved, so you can try again right
          away.
        </p>
      </div>
      <ProgressCard job={job} labels={labels} percent={percent} elapsed={elapsed} />
      <div className="gen-actions">
        <button
          ref={retryRef}
          type="button"
          className={classes('btn btn-primary', retry.isPending && 'is-loading')}
          aria-busy={retry.isPending}
          onClick={() => retry.mutate()}
        >
          {retry.isPending ? <span className="spinner" aria-hidden="true" /> : <RetryIcon />}
          <span>Try again</span>
        </button>
        <Link to={`/cvs/${cv.id}/edit`} className="btn btn-secondary">
          Edit details
        </Link>
      </div>
      {retryError && (
        <p className="error" role="alert" style={{ marginTop: 12 }}>
          <ErrorIcon />
          <span>{retryError}</span>
        </p>
      )}
      <p className="gen-help">
        Still failing? A text-based PDF (not a scan) or a shorter description usually helps.
        <span className="gen-ref">
          Ref. {job.errorCode ?? 'UNKNOWN'} · {job.id.slice(-8).toUpperCase()}
        </span>
      </p>
    </>
  );
}

function ProgressCard({
  job,
  labels,
  percent,
  elapsed,
}: {
  job: GenerationJobDto;
  labels: string[];
  percent: number;
  elapsed: number;
}) {
  const failed = job.status === 'FAILED';
  const current = Math.min(job.step, GENERATION_STEP_COUNT - 1);

  return (
    <div className="gen-card">
      <span
        className={classes('gbar', failed && 'is-failed')}
        role="progressbar"
        aria-label="Generation progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span className="gbar-fill" style={{ width: `${percent}%` }} />
      </span>
      <div className={classes('gmeta', failed && 'is-failed')}>
        {failed ? (
          <span>
            Stopped at <strong>{percent}%</strong>
          </span>
        ) : (
          <span>
            <strong>{percent}%</strong> complete
          </span>
        )}
        <span className="gtime">{formatDuration(elapsed)} elapsed · usually about 1 min</span>
      </div>
      <ol className="gsteps">
        {labels.map((label, index) => {
          let state: 'done' | 'active' | 'failed' | 'pending' = 'pending';
          if (index < current) state = 'done';
          else if (index === current) state = failed ? 'failed' : 'active';

          let detail = '';
          if (state === 'active') detail = ACTIVE_DETAILS[index] ?? '';
          if (state === 'failed') detail = job.errorMessage ?? 'Something went wrong.';

          return (
            <li key={label} className={`gstep is-${state}`}>
              <span className="gstep-ico" aria-hidden="true">
                {state === 'done' && <CheckIcon />}
                {state === 'active' && <span className="gstep-spin" />}
                {state === 'failed' && <CloseIcon width={12} height={12} />}
              </span>
              <span className="gstep-text">
                <span className="gstep-label">
                  {label}
                  <span className="sr-only">
                    {state === 'done'
                      ? ', done'
                      : state === 'active'
                        ? ', in progress'
                        : state === 'failed'
                          ? ', failed'
                          : ', not started'}
                  </span>
                </span>
                {detail && <span className="gstep-detail">{detail}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
