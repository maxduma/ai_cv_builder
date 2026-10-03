import type { CvContent, CvDetail } from '@cv-builder/shared';
import type { ReactNode } from 'react';
import { Link, Navigate } from 'react-router';
import { ApiError } from '../../lib/api-client';
import { NotFoundPage } from '../../pages/NotFoundPage';
import { AlertCircleIcon, RetryIcon } from '../../ui/icons';
import { StateIcon, StatePanel } from '../../ui/StatePanel';
import { useCv, useQuestionUpdates } from './api';

/** A generated CV whose content could be read. */
export type ReadyCv = CvDetail & { content: CvContent };

/**
 * Loads a CV for a page that shows its generated content (the editor, the preview). A CV that has
 * none yet is sent to the page that fits it; loading and load errors are shown here. Answers to
 * the AI's questions update the CV in the background, and this follows them, so the page shows
 * the content as saved now.
 */
export function ReadyCvGate({
  cvId,
  loadingClassName,
  children,
}: {
  cvId: string;
  /** The class of the empty `<main>` shown while loading, so the page doesn't jump. */
  loadingClassName: string;
  children: (cv: ReadyCv) => ReactNode;
}) {
  const { data: cv, error, refetch, isFetching } = useCv(cvId);
  useQuestionUpdates(cv);

  // A failed background refetch keeps the CV on screen: only a first load can fail here.
  if (!cv) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
      return <NotFoundPage />;
    }
    if (error) {
      return (
        <main className="page-main">
          <StatePanel
            tone="error"
            headingLevel="h1"
            visual={
              <StateIcon tone="error">
                <AlertCircleIcon />
              </StateIcon>
            }
            title="We couldn’t open this CV"
            description="Your CV is safe — this is usually a connection problem. Check your internet and try again."
            action={
              <button
                type="button"
                className="btn btn-primary empty-cta"
                aria-busy={isFetching}
                disabled={isFetching}
                onClick={() => void refetch()}
              >
                <RetryIcon />
                <span>Try again</span>
              </button>
            }
          />
        </main>
      );
    }
    return <main className={loadingClassName} aria-busy="true" />;
  }

  // Only a generated CV has content to show.
  if (cv.status === 'draft') return <Navigate to={`/cvs/${cv.id}/edit`} replace />;
  if (cv.status !== 'ready') return <Navigate to={`/cvs/${cv.id}`} replace />;
  if (!cv.content) {
    return (
      <main className="page-main">
        <StatePanel
          tone="error"
          headingLevel="h1"
          visual={
            <StateIcon tone="error">
              <AlertCircleIcon />
            </StateIcon>
          }
          title="We couldn’t open this CV"
          description="Its content couldn’t be read. Your other CVs aren’t affected."
          action={
            <Link to="/" className="btn btn-secondary">
              Back to My CVs
            </Link>
          }
        />
      </main>
    );
  }
  return children({ ...cv, content: cv.content });
}
