import {
  ANSWER_MAX_LENGTH,
  type CvContent,
  type CvDetail,
  type CvQuestionDto,
  isUpdating,
} from '@cv-builder/shared';
import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';
import { type KeyboardEvent, type ReactNode, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, Navigate, useParams } from 'react-router';
import { ApiError } from '../../lib/api-client';
import { NotFoundPage } from '../../pages/NotFoundPage';
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  CheckIcon,
  ClockIcon,
  ErrorIcon,
  SmallArrowIcon,
} from '../../ui/icons';
import { StateIcon, StatePanel } from '../../ui/StatePanel';
import { cacheQuestion, cvKeys, cvsApi, useCv, useQuestionUpdates } from '../cvs/api';
import './clarify.css';

/** The finish bar's primary action, where focus goes once no question is left to answer. */
const FINISH_PRIMARY_ID = 'cq-finish-primary';
const SAVE_FAILED = 'Something went wrong. Try again in a moment.';

function classes(...names: (string | false | null | undefined)[]) {
  return names.filter(Boolean).join(' ');
}

const answerInputId = (questionId: string) => `cq-${questionId}-answer`;

/**
 * The questions this page asks: not dismissed, and still about something in the CV (a question
 * about a role or an education entry that has since been deleted has nothing left to change).
 */
function shownQuestions(cv: CvDetail, content: CvContent): CvQuestionDto[] {
  const entries = new Set([...content.experience, ...content.education].map((entry) => entry.id));
  return cv.questions.filter(
    (question) =>
      question.status !== 'dismissed' && !(question.itemId && !entries.has(question.itemId)),
  );
}

/**
 * Whether the question takes an answer (again): while open or skipped, or after the update from
 * its answer failed. An answer that is applied, or being applied, can't be changed here.
 */
function canAnswer(question: CvQuestionDto): boolean {
  return (
    question.status === 'open' ||
    question.status === 'skipped' ||
    (question.status === 'answered' && question.update?.status === 'FAILED')
  );
}

/** The next question still waiting for an answer after `from`, wrapping around; -1 if none. */
function nextOpenIndex(questions: CvQuestionDto[], from: number, exceptId: string): number {
  for (let step = 1; step <= questions.length; step += 1) {
    const index = (from + step) % questions.length;
    const question = questions[index];
    if (question && question.id !== exceptId && question.status === 'open') return index;
  }
  return -1;
}

/** The answer field starts with the earlier answer when that answer needs another go. */
function startingText(question: CvQuestionDto): string {
  const again = question.followUp !== null || question.update?.status === 'FAILED';
  return again ? (question.answer ?? '') : '';
}

function isFieldDetail(value: unknown): value is { message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof value.message === 'string'
  );
}

/** What went wrong, in the API's words: a rejected answer names its problem in `details`. */
function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return SAVE_FAILED;
  if (error.code === 'VALIDATION_ERROR' && Array.isArray(error.details)) {
    const detail: unknown = error.details[0];
    if (isFieldDetail(detail)) return detail.message;
  }
  return error.message;
}

/**
 * The question changed elsewhere (answered, skipped or dismissed in another tab, or its last
 * answer is still being applied): fetch the CV again, so the card shows where it stands now.
 */
function refetchIfStale(queryClient: QueryClient, cvId: string, error: unknown) {
  if (
    error instanceof ApiError &&
    (error.code === 'QUESTION_CLOSED' || error.code === 'QUESTION_BUSY')
  ) {
    void queryClient.invalidateQueries({ queryKey: cvKeys.detail(cvId) });
  }
}

/**
 * `/cvs/:cvId/questions`: the AI's questions about a freshly generated draft. Only a ready CV
 * with readable content has questions to answer; any other CV is sent to the page that fits it,
 * and a CV with nothing left to ask goes straight to the editor.
 */
export function ClarifyPage() {
  const { cvId = '' } = useParams();
  const { data: cv, error } = useCv(cvId);
  // Answers update the CV in the background; this follows them and refetches the CV after each.
  useQuestionUpdates(cv);

  // A failed background refetch keeps the page as it is: errors only matter with nothing to show.
  if (!cv) {
    if (error) {
      // An unknown or malformed id, or someone else's CV.
      if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
        return <NotFoundPage />;
      }
      throw error;
    }
    return <main className="cq-main" aria-busy="true" />;
  }
  if (cv.status === 'generating' || cv.status === 'failed') {
    return <Navigate to={`/cvs/${cv.id}`} replace />;
  }
  if (cv.status === 'draft') {
    return <Navigate to={`/cvs/${cv.id}/edit`} replace />;
  }
  // Ready, but its content can't be read: a redirect to the editor would only come back here.
  if (!cv.content) {
    return <UnreadableCv />;
  }
  const questions = shownQuestions(cv, cv.content);
  if (questions.length === 0) {
    return <Navigate to={`/cvs/${cv.id}/editor`} replace />;
  }
  return <ClarifyQuestions cv={cv} questions={questions} />;
}

/** A ready CV whose saved draft can't be read: says so in place of the questions. */
function UnreadableCv() {
  return (
    <main className="page-main">
      <title>We couldn’t open this CV · CV Builder</title>
      <StatePanel
        tone="error"
        headingLevel="h1"
        visual={
          <StateIcon tone="error">
            <AlertCircleIcon />
          </StateIcon>
        }
        title="We couldn’t open this CV"
        description="Its saved draft couldn’t be read. Your other CVs are safe — go back to My CVs."
        action={
          <Link to="/" className="btn btn-primary empty-cta">
            <ArrowLeftIcon />
            <span>Back to My CVs</span>
          </Link>
        }
      />
    </main>
  );
}

/** What a finished update did, for screen readers; nothing for one still running. */
function outcomeMessage(question: CvQuestionDto, questions: CvQuestionDto[]): string | null {
  const number = questions.indexOf(question) + 1;
  const update = question.update;
  if (update?.status === 'FAILED') {
    return `Question ${number}: your answer couldn’t be added to the CV. Nothing was changed.`;
  }
  if (update?.status !== 'COMPLETED') return null;
  if (update.outcome === 'needs_more_info' && question.followUp) {
    return `Question ${number} needs a bit more detail: ${question.followUp}`;
  }
  return update.outcome === 'updated' ? `Question ${number}: added to ${question.target}.` : null;
}

/**
 * The questions, one open at a time, and the way on to the editor. Each answer is saved when the
 * person moves on, and the server then updates the CV from it; which questions are answered,
 * skipped or still updating always comes from the server, so a reload picks up where things stand
 * (the first question still waiting opens).
 */
function ClarifyQuestions({ cv, questions }: { cv: CvDetail; questions: CvQuestionDto[] }) {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(
    () => questions.find((question) => question.status === 'open')?.id ?? null,
  );
  // Follows `activeId` from the handlers that change it: a save that finishes after the person
  // has opened another question must not pull them away from it.
  const activeRef = useRef(activeId);
  // What was typed into each question, kept while another one is open.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [live, setLive] = useState('');

  const total = questions.length;
  // The active question shows its form only while it can take an answer: one that was answered
  // elsewhere (another tab) closes by itself.
  const openQuestion = questions.find(
    (question) => question.id === activeId && canAnswer(question),
  );
  const answered = questions.filter((question) => question.status === 'answered').length;
  // Answers whose update failed aren't going into the CV until they're tried again.
  const failed = questions.filter(
    (question) => question.status === 'answered' && question.update?.status === 'FAILED',
  ).length;
  const remaining = questions.filter((question) => question.status === 'open').length;
  const hasAnswers = answered > 0;
  const allDone = remaining === 0;
  const editorPath = `/cvs/${cv.id}/editor`;

  let finishTitle = 'Not now?';
  if (failed > 0) {
    finishTitle =
      failed === 1
        ? '1 answer couldn’t be added · try it again above'
        : `${failed} answers couldn’t be added · try them again above`;
  } else if (hasAnswers && allDone) {
    finishTitle =
      answered === 1
        ? '1 answer will be added to your CV'
        : `${answered} answers will be added to your CV`;
  } else if (hasAnswers) {
    finishTitle = `${answered} answered so far · ${remaining} to go`;
  }

  // How each update ends reaches screen readers too: a follow-up reopens its question, a failure
  // waits for "Try again". Compared with the updates seen before, during render (the outcome
  // arrives with the CV, not from an event here).
  const updates = Object.fromEntries(
    questions.map((question) => [
      question.id,
      `${question.update?.jobId ?? ''}:${question.update?.status ?? ''}`,
    ]),
  );
  const [seenUpdates, setSeenUpdates] = useState(updates);
  const changed = questions.filter((question) => seenUpdates[question.id] !== updates[question.id]);
  if (changed.length > 0) {
    setSeenUpdates(updates);
    const message = changed.map((question) => outcomeMessage(question, questions)).find(Boolean);
    if (message) setLive(message);
  }

  function describe(index: number): string {
    const question = questions[index];
    return question ? `Question ${index + 1} of ${total}: ${question.question}` : '';
  }

  /** Opens a question and puts focus in its answer (a closed card's button is gone once open). */
  function openAt(index: number, message: string) {
    const question = questions[index];
    if (!question) return;
    activeRef.current = question.id;
    // Rendered first, so the field exists to take focus.
    flushSync(() => {
      setActiveId(question.id);
      setLive(message);
    });
    document.getElementById(answerInputId(question.id))?.focus();
  }

  /** After an answer or a skip is saved: on to the next waiting question, or to the finish bar. */
  function moveOn(saved: CvQuestionDto, done: string) {
    void cacheQuestion(queryClient, cv.id, saved);
    if (activeRef.current !== saved.id) {
      setLive(done);
      return;
    }
    const from = questions.findIndex((question) => question.id === saved.id);
    const next = nextOpenIndex(questions, from, saved.id);
    if (next !== -1) {
      openAt(next, `${done} ${describe(next)}`);
      return;
    }
    activeRef.current = null;
    flushSync(() => {
      setActiveId(null);
      setLive(`${done} All questions done.`);
    });
    document.getElementById(FINISH_PRIMARY_ID)?.focus();
  }

  function onAnswered(saved: CvQuestionDto) {
    // The server has the answer now; reopening the question starts from what it kept.
    setDrafts((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => id !== saved.id)),
    );
    moveOn(saved, 'Saved your answer.');
  }

  return (
    <main className="cq-main">
      <title>A few quick questions · CV Builder</title>
      <div className="cvb-rise">
        <span className="ok-chip">
          <CheckCircleIcon />
          {cv.targetRole ? `Draft saved · ${cv.targetRole}` : 'Draft saved'}
        </span>
        <h1 className="cq-title-xl">A few quick questions</h1>
        <p className="cq-sub">
          The AI found a few gaps in your draft. Answers make your CV more specific — each takes a
          few seconds, and you can skip any of them.
        </p>
        <div className="cq-progress">
          <span
            className="cq-segs"
            aria-hidden="true"
            style={{ gridTemplateColumns: `repeat(${total}, 32px)` }}
          >
            {questions.map((question) => (
              <span
                key={question.id}
                className={classes(
                  'cq-seg',
                  question.status === 'answered'
                    ? 'is-on'
                    : question.status === 'skipped'
                      ? 'is-skip'
                      : question.id === openQuestion?.id && 'is-cur',
                )}
              />
            ))}
          </span>
          <span className="cq-count">
            {answered} of {total} answered
          </span>
          <span className="cq-time">
            <ClockIcon />
            About a minute in total
          </span>
        </div>
      </div>

      <ol className="cq-list" aria-label="Questions">
        {questions.map((question, index) => {
          const isOpen = question.id === openQuestion?.id;
          return (
            <li
              key={question.id}
              className={classes(
                'cq-card',
                isOpen ? 'is-active' : question.status === 'open' && 'is-pending',
              )}
              style={{ animationDelay: `${60 + index * 50}ms` }}
            >
              {isOpen ? (
                <OpenCard
                  cvId={cv.id}
                  question={question}
                  number={index + 1}
                  text={drafts[question.id] ?? startingText(question)}
                  isLast={
                    !questions.some((other) => other.id !== question.id && other.status === 'open')
                  }
                  onTextChange={(text) =>
                    setDrafts((current) => ({ ...current, [question.id]: text }))
                  }
                  onAnswered={onAnswered}
                  onSkipped={(saved) => moveOn(saved, 'Skipped.')}
                />
              ) : (
                <ClosedCard
                  cvId={cv.id}
                  question={question}
                  number={index + 1}
                  onOpen={() => openAt(index, describe(index))}
                />
              )}
            </li>
          );
        })}
      </ol>

      <div className={classes('cq-finish', allDone && hasAnswers && failed === 0 && 'is-ready')}>
        <span className="cq-finish-text">
          <span className="cq-finish-title">{finishTitle}</span>
          <span className="cq-finish-sub">
            {hasAnswers
              ? 'Your answers go straight into the draft. You can change any of it in the editor.'
              : 'Open the editor with your draft as it is. These questions will wait there.'}
          </span>
        </span>
        <span className="cq-finish-actions">
          {hasAnswers && (
            <Link to={editorPath} className="btn btn-ghost">
              Skip the rest
            </Link>
          )}
          {/* One element in both variants, so focus put on it survives the first answer. */}
          <Link
            id={FINISH_PRIMARY_ID}
            to={editorPath}
            className={hasAnswers ? 'btn btn-primary btn-lg' : 'btn btn-secondary btn-lg'}
          >
            {hasAnswers ? (
              <>
                <span>Update my CV</span>
                <ArrowRightIcon />
              </>
            ) : (
              'Open the editor'
            )}
          </Link>
        </span>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {live}
      </p>
    </main>
  );
}

/**
 * The question being answered: why it is asked, where the answer goes, and one free-text field.
 * Enter or Next saves the answer and moves on; an empty answer gets the design's amber hint
 * instead, and a failed save keeps the text and shows the reason in the card. A question the AI
 * asked again shows what it still needs, with the earlier answer ready to extend.
 */
function OpenCard({
  cvId,
  question,
  number,
  text,
  isLast,
  onTextChange,
  onAnswered,
  onSkipped,
}: {
  cvId: string;
  question: CvQuestionDto;
  number: number;
  text: string;
  /** No other question is waiting: the button says Done. */
  isLast: boolean;
  onTextChange: (text: string) => void;
  onAnswered: (saved: CvQuestionDto) => void;
  onSkipped: (saved: CvQuestionDto) => void;
}) {
  const queryClient = useQueryClient();
  const [hint, setHint] = useState(false);
  // Moving on happens in the mutation's own callbacks, which run even if this card has closed.
  const answer = useMutation({
    mutationFn: (value: string) => cvsApi.answerQuestion(cvId, question.id, { answer: value }),
    onSuccess: (saved) => onAnswered(saved),
    onError: (error) => refetchIfStale(queryClient, cvId, error),
  });
  const skip = useMutation({
    mutationFn: () => cvsApi.updateQuestion(cvId, question.id, { status: 'skipped' }),
    onSuccess: (saved) => onSkipped(saved),
    onError: (error) => refetchIfStale(queryClient, cvId, error),
  });

  const busy = answer.isPending || skip.isPending;
  // An answer whose update failed is changed and sent again; the API only skips unanswered ones.
  const canSkip = question.status !== 'answered';
  const failure = answer.error ?? skip.error;
  const titleId = `cq-title-${question.id}`;
  const inputId = answerInputId(question.id);
  const followId = `cq-${question.id}-follow`;
  const hintId = `cq-${question.id}-hint`;
  const errorId = `cq-${question.id}-error`;
  const describedBy = [question.followUp && followId, hint && hintId, failure && errorId].filter(
    Boolean,
  );

  function submit() {
    // Repeat presses are ignored while a save runs.
    if (busy) return;
    const value = text.trim();
    if (!value) {
      setHint(true);
      return;
    }
    skip.reset();
    answer.mutate(value);
  }

  function skipQuestion() {
    if (busy) return;
    setHint(false);
    answer.reset();
    skip.mutate();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Enter answers and moves on, but not while an input method is still composing a character.
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  }

  return (
    <>
      <div className="cq-head">
        <span className="num is-cur" aria-hidden="true">
          {number}
        </span>
        <div className="cq-titles">
          <h2 className="cq-q" id={titleId}>
            {question.question}
          </h2>
          <p className="cq-why">{question.why}</p>
        </div>
        <span className="cq-target">
          <SmallArrowIcon />
          {question.target}
        </span>
      </div>
      <div className="cq-body" role="group" aria-labelledby={titleId}>
        {question.followUp && (
          <p id={followId} className="cq-hint is-follow">
            <ErrorIcon />
            <span>Need a bit more detail: {question.followUp}</span>
          </p>
        )}
        <div className="field">
          <label className="label" htmlFor={inputId}>
            Your answer
          </label>
          <input
            id={inputId}
            className="input"
            type="text"
            autoComplete="off"
            maxLength={ANSWER_MAX_LENGTH}
            value={text}
            aria-describedby={describedBy.length > 0 ? describedBy.join(' ') : undefined}
            onChange={(event) => {
              onTextChange(event.target.value);
              setHint(false);
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        {hint && (
          <p id={hintId} className="cq-hint" role="alert">
            <ErrorIcon />
            <span>
              {canSkip ? 'Write an answer, or skip this question.' : 'Write an answer first.'}
            </span>
          </p>
        )}
        {failure && (
          <div id={errorId} className="alert is-inline" role="alert">
            <ErrorIcon width={16} height={16} />
            <p className="alert-text">{errorMessage(failure)}</p>
          </div>
        )}
        <div className="cq-foot">
          <span className="cq-kbd">
            <kbd>Enter</kbd> to continue
          </span>
          <span className="cq-foot-r">
            {canSkip && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-busy={skip.isPending}
                // Not `disabled`: that would drop focus from a pressed button.
                aria-disabled={answer.isPending || undefined}
                onClick={skipQuestion}
              >
                Skip
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              aria-busy={answer.isPending}
              aria-disabled={skip.isPending || undefined}
              onClick={submit}
            >
              {answer.isPending ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  <span>Saving…</span>
                </>
              ) : (
                <>
                  <span>{isLast ? 'Done' : 'Next'}</span>
                  <ArrowRightIcon />
                </>
              )}
            </button>
          </span>
        </div>
      </div>
    </>
  );
}

/** The line under an answer: how the update of the CV from it went. */
function updateLine(question: CvQuestionDto): { tone: string; content: ReactNode } | null {
  const { update } = question;
  if (!update) return null;
  if (isUpdating(question)) {
    return {
      tone: 'is-busy',
      content: (
        <>
          <span className="spinner" aria-hidden="true" />
          <span>Updating your CV…</span>
        </>
      ),
    };
  }
  if (update.status === 'FAILED') {
    return {
      tone: 'is-failed',
      content: (
        <>
          <ErrorIcon />
          <span>Couldn’t update your CV from this answer.</span>
        </>
      ),
    };
  }
  if (update.outcome === 'updated') {
    return {
      tone: 'is-ok',
      content: (
        <>
          <CheckIcon />
          <span>Added to {question.target}</span>
        </>
      ),
    };
  }
  if (update.outcome === 'no_change') {
    return { tone: 'is-quiet', content: <span>Nothing to change</span> };
  }
  return null;
}

/**
 * A question that isn't open: its number or state, and the answer given. The whole head opens it,
 * except for answers that are applied or being applied, which can't be changed here. Under an
 * answer, a status line follows its update of the CV (announced as it changes); a failed update
 * can be tried again with the same answer, or the card opened to change the answer first.
 */
function ClosedCard({
  cvId,
  question,
  number,
  onOpen,
}: {
  cvId: string;
  question: CvQuestionDto;
  number: number;
  onOpen: () => void;
}) {
  const queryClient = useQueryClient();
  const statusRef = useRef<HTMLDivElement>(null);
  const retry = useMutation({
    mutationFn: (value: string) => cvsApi.answerQuestion(cvId, question.id, { answer: value }),
    onSuccess: (saved) => {
      // Try again is about to disappear: keep focus on the status that replaces it.
      statusRef.current?.focus();
      void cacheQuestion(queryClient, cvId, saved);
    },
    onError: (error) => refetchIfStale(queryClient, cvId, error),
  });

  const { status, update } = question;
  const isAnswered = status === 'answered';
  const isSkipped = status === 'skipped';
  const failed = isAnswered && update?.status === 'FAILED';

  let label = `${question.question} — not answered yet. Answer now`;
  if (isAnswered) label = `${question.question} — answered: ${question.answer ?? ''}. Edit`;
  else if (isSkipped) label = `${question.question} — skipped. Answer now`;
  // The follow-up itself is read with the answer field, once the card is open.
  else if (question.followUp) label = `${question.question} — needs a bit more detail. Answer now`;

  const head = (
    <>
      {isAnswered ? (
        <span className="num is-done" aria-hidden="true">
          <CheckIcon size={14} />
        </span>
      ) : isSkipped ? (
        <span className="num is-skip" aria-hidden="true">
          <SmallArrowIcon size={14} />
        </span>
      ) : (
        <span className="num" aria-hidden="true">
          {number}
        </span>
      )}
      <span className="cq-titles">
        <span className="cq-q">{question.question}</span>
        {isAnswered && <span className="cq-answer">{question.answer}</span>}
        {isSkipped && (
          <span className="cq-answer is-skip">Skipped — you can answer it later in the editor</span>
        )}
        {status === 'open' && question.followUp && (
          <span className="cq-answer is-follow">Need a bit more detail: {question.followUp}</span>
        )}
      </span>
    </>
  );

  const line = updateLine(question);

  return (
    <>
      {canAnswer(question) ? (
        <button
          type="button"
          className="cq-head is-btn"
          aria-expanded={false}
          aria-label={label}
          onClick={onOpen}
        >
          {head}
          {(isAnswered || isSkipped) && (
            <span className="cq-edit">{isAnswered ? 'Edit' : 'Answer'}</span>
          )}
        </button>
      ) : (
        <div className="cq-head is-static">{head}</div>
      )}

      {isAnswered && update && (
        // Outside the head: Try again can't sit inside the button that opens the card.
        <div ref={statusRef} className="cq-status" tabIndex={-1}>
          {/* Kept in place while the update runs, so each change of its text is announced. */}
          <p className={classes('cq-status-line', line?.tone)} role="status">
            {line?.content}
          </p>
          {failed && (
            <span className="cq-status-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                aria-busy={retry.isPending}
                onClick={() => {
                  if (!retry.isPending && question.answer) retry.mutate(question.answer);
                }}
              >
                {retry.isPending && <span className="spinner" aria-hidden="true" />}
                <span>Try again</span>
              </button>
              {update.errorCode && <span className="cq-ref">Ref. {update.errorCode}</span>}
            </span>
          )}
          {retry.isError && (
            <p className="error" role="alert">
              <ErrorIcon />
              <span>{errorMessage(retry.error)}</span>
            </p>
          )}
        </div>
      )}
    </>
  );
}
