import {
  ANSWER_MAX_LENGTH,
  type CvContent,
  type CvDetail,
  type CvQuestionDto,
  isUpdating,
} from '@cv-builder/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type KeyboardEvent, type RefObject, useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '../../lib/api-client';
import { CloseIcon, ErrorIcon, SparkleIcon } from '../../ui/icons';
import { cacheQuestion, cvKeys, cvsApi } from '../cvs/api';
import type { EditorSession } from './editor-session';

type CardState = 'failed' | 'updating' | 'waiting';

function stateOf(question: CvQuestionDto): CardState {
  if (isUpdating(question)) return 'updating';
  if (question.status === 'answered' && question.update?.status === 'FAILED') return 'failed';
  return 'waiting';
}

const RANK: Record<CardState, number> = { failed: 0, updating: 1, waiting: 2 };

/**
 * The questions that still need the person, most urgent first: an answer that couldn't be
 * applied, one being applied, then those waiting for an answer (open before skipped). Questions
 * about an entry the person has deleted no longer apply.
 */
export function pendingQuestions(questions: CvQuestionDto[], draft: CvContent): CvQuestionDto[] {
  const entries = new Set([...draft.experience, ...draft.education].map((entry) => entry.id));
  return questions
    .filter((question) => {
      if (question.status === 'dismissed') return false;
      if (question.itemId && !entries.has(question.itemId)) return false;
      if (question.status === 'answered')
        return isUpdating(question) || stateOf(question) === 'failed';
      return true;
    })
    .map((question, index) => ({ question, index }))
    .sort(
      (a, b) =>
        RANK[stateOf(a.question)] - RANK[stateOf(b.question)] ||
        Number(a.question.status === 'skipped') - Number(b.question.status === 'skipped') ||
        a.index - b.index,
    )
    .map(({ question }) => question);
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function kicker(question: CvQuestionDto, waiting: CvQuestionDto[]): string {
  const state = stateOf(question);
  if (state === 'failed') return 'Your answer wasn’t added';
  if (state === 'updating') return 'Adding your answer';
  return waiting.every((q) => q.status === 'skipped')
    ? plural(waiting.length, 'question you skipped', 'questions you skipped')
    : plural(waiting.length, 'open question', 'open questions');
}

/** What a finished update did, for screen readers. */
function outcomeMessage(question: CvQuestionDto): string | null {
  const update = question.update;
  if (update?.status === 'FAILED')
    return 'Your answer couldn’t be added to the CV. Nothing was changed.';
  if (update?.status !== 'COMPLETED') return null;
  if (update.outcome === 'updated') return `Updated ${question.target} from your answer.`;
  if (update.outcome === 'needs_more_info')
    return 'The AI needs a bit more detail for that question.';
  return 'Your answer didn’t change the CV.';
}

/**
 * The AI's questions about the CV, one at a time, above the sections (the design's "question you
 * skipped" card, with a free-text answer). An answer is applied in the background to its section
 * only; the person can keep editing meanwhile, and their edits win (see `editor-session.ts`).
 */
export function QuestionsPanel({
  cv,
  draft,
  session,
}: {
  cv: CvDetail;
  draft: CvContent;
  session: EditorSession;
}) {
  const queue = pendingQuestions(cv.questions, draft);
  const current = queue[0];
  const waiting = queue.filter((question) => stateOf(question) === 'waiting');

  // Announce how each update ended, once: compare with the statuses seen before.
  const seen = useRef(new Map<string, string>());
  useEffect(() => {
    for (const question of cv.questions) {
      const key = question.update ? `${question.update.jobId}:${question.update.status}` : '';
      const before = seen.current.get(question.id);
      seen.current.set(question.id, key);
      if (before === undefined || before === key) continue;
      const message = outcomeMessage(question);
      if (message) session.announce(message);
    }
  }, [cv.questions, session]);

  // Keeps focus in the card when an action replaces it (answered, dismissed, next question).
  const restoreFocus = useRef(false);
  const cardRef = useRef<HTMLElement>(null);
  const state = current ? stateOf(current) : null;
  useEffect(() => {
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    const card = cardRef.current;
    if (card) {
      (card.querySelector<HTMLElement>('input, .btn') ?? card).focus();
    } else {
      document.querySelector<HTMLElement>('#sec-contact .ed-toggle')?.focus();
    }
  }, [current?.id, state]);

  if (!current) return null;
  return (
    <QuestionCard
      // A new card per question, update and state, so the answer field starts over (prefilled
      // after a failure or a follow-up).
      key={`${current.id}:${current.update?.jobId ?? ''}:${stateOf(current)}:${current.followUp ?? ''}`}
      cardRef={cardRef}
      cv={cv}
      question={current}
      kicker={kicker(current, waiting)}
      session={session}
      onAction={() => {
        restoreFocus.current = true;
      }}
    />
  );
}

function QuestionCard({
  cardRef,
  cv,
  question,
  kicker: kickerText,
  session,
  onAction,
}: {
  cardRef: RefObject<HTMLElement | null>;
  cv: CvDetail;
  question: CvQuestionDto;
  kicker: string;
  session: EditorSession;
  onAction: () => void;
}) {
  const queryClient = useQueryClient();
  const state = stateOf(question);
  const id = useId();
  const titleId = `${id}-title`;
  const inputId = `${id}-answer`;
  // After a follow-up or a failed update, the person extends what they wrote.
  const [answer, setAnswer] = useState(
    question.followUp || state === 'failed' ? (question.answer ?? '') : '',
  );
  const [empty, setEmpty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const text = answer.trim();
    if (!text) {
      setEmpty(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Edits waiting to be saved go first, so the AI sees them; it never blocks the answer:
      // whatever is saved later still wins over the AI's change.
      await session.flush().catch(() => {});
      const updated = await cvsApi.answerQuestion(cv.id, question.id, { answer: text });
      onAction();
      void cacheQuestion(queryClient, cv.id, updated);
      session.announce(`Adding your answer to ${question.target}…`);
    } catch (caught) {
      setBusy(false);
      setError(caught instanceof Error ? caught.message : 'Something went wrong. Try again.');
      if (caught instanceof ApiError && caught.code === 'QUESTION_CLOSED') {
        void queryClient.invalidateQueries({ queryKey: cvKeys.detail(cv.id) });
      }
    }
  }

  async function dismiss() {
    setBusy(true);
    try {
      const updated = await cvsApi.updateQuestion(cv.id, question.id, { status: 'dismissed' });
      onAction();
      void cacheQuestion(queryClient, cv.id, updated);
      session.announce('Question dismissed.');
    } catch (caught) {
      setBusy(false);
      setError(caught instanceof Error ? caught.message : 'Something went wrong. Try again.');
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <section
      ref={cardRef}
      className="ask-card"
      aria-labelledby={titleId}
      aria-busy={state === 'updating'}
      tabIndex={-1}
    >
      <div className="ask-head">
        <span className="ask-ico" aria-hidden="true">
          <SparkleIcon width={15} height={15} />
        </span>
        <span className="ask-titles">
          <span className="ask-kicker">{kickerText}</span>
          <h2 className="ask-title" id={titleId}>
            {question.question}
          </h2>
        </span>
        {state !== 'updating' && (
          <button
            type="button"
            className="icon-btn"
            aria-label="Dismiss this question"
            title="Dismiss"
            disabled={busy}
            onClick={() => void dismiss()}
          >
            <CloseIcon />
          </button>
        )}
      </div>

      {state === 'updating' ? (
        <div className="ask-body">
          <p className="ask-status" role="status">
            <span className="spinner" aria-hidden="true" />
            <span>Updating {question.target} from your answer… You can keep editing.</span>
          </p>
        </div>
      ) : (
        <>
          <div className="ask-body">
            {state === 'failed' && (
              <div className="alert is-inline" role="alert">
                <ErrorIcon width={16} height={16} />
                <p className="alert-text">
                  Couldn’t update your CV from this answer. Nothing was changed.
                </p>
                {question.update?.errorCode && (
                  <span className="ask-ref">Ref. {question.update.errorCode}</span>
                )}
              </div>
            )}
            {question.followUp && (
              <p className="ask-note is-hint">Need a bit more detail: {question.followUp}</p>
            )}
            <label className="sr-only" htmlFor={inputId}>
              Your answer
            </label>
            <input
              id={inputId}
              className="input"
              type="text"
              autoComplete="off"
              enterKeyHint="send"
              maxLength={ANSWER_MAX_LENGTH}
              placeholder="Type your answer"
              value={answer}
              aria-invalid={empty}
              onChange={(event) => {
                setAnswer(event.target.value);
                setEmpty(false);
              }}
              onKeyDown={onKeyDown}
            />
            {error && (
              <div className="alert is-inline" role="alert">
                <ErrorIcon width={16} height={16} />
                <p className="alert-text">{error}</p>
              </div>
            )}
          </div>
          <div className="ask-foot">
            {empty ? (
              <p className="ask-note is-hint" role="alert">
                Write an answer, or dismiss this question.
              </p>
            ) : (
              <p className="ask-note">Updates {question.target}</p>
            )}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              aria-busy={busy}
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  <span>Saving…</span>
                </>
              ) : state === 'failed' ? (
                'Try again'
              ) : (
                'Add to CV'
              )}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
