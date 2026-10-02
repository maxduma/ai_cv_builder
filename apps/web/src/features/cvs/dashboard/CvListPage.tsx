import { useRef } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../../../lib/api-client';
import { useNow } from '../../../lib/use-now';
import { FloatingDocArt } from '../../../ui/FloatingDocArt';
import { AlertCircleIcon, PlusIcon, RetryIcon } from '../../../ui/icons';
import { StateIcon, StatePanel } from '../../../ui/StatePanel';
import { useCvs } from '../api';
import { CvCard, CvCardSkeleton } from './CvCard';
import './dashboard.css';

const SKELETON_DELAYS_MS = [0, 140, 280];

/** "My CVs": the signed-in user's CVs, with loading, empty and error states from the design. */
export function CvListPage() {
  const { data, error, isFetching, refetch } = useCvs();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const now = useNow(60_000);

  const cvs = data?.items;
  // A retry after an error shows the skeleton again, then the list.
  const isLoading = !cvs && (isFetching || !error);
  const isError = !cvs && !!error && !isFetching;
  const isEmpty = cvs?.length === 0;
  const hasCvs = !!cvs && cvs.length > 0;

  async function retry() {
    const result = await refetch();
    if (result.isSuccess) {
      titleRef.current?.focus();
    }
  }

  return (
    <main className="page-main">
      <title>My CVs · CV Builder</title>

      <div className="page-head">
        <div className="dash-titles cvb-rise">
          <div className="dash-title-row">
            <h1 ref={titleRef} className="page-title" tabIndex={-1}>
              My CVs
            </h1>
            {hasCvs && (
              <span className="count-chip">
                {cvs.length}
                <span className="sr-only"> CVs</span>
              </span>
            )}
          </div>
          <p className="page-sub">Create, edit and manage your CVs in one place.</p>
        </div>
        {/* Empty and error states carry their own single action. */}
        {(isLoading || hasCvs) && (
          <Link
            to="/cvs/new"
            className="btn btn-primary cta cvb-rise"
            style={{ animationDelay: '80ms' }}
          >
            <PlusIcon />
            <span>Create new CV</span>
          </Link>
        )}
      </div>

      {isLoading && (
        <ul className="cv-grid" aria-label="Loading CVs" aria-busy="true">
          {SKELETON_DELAYS_MS.map((delayMs) => (
            <CvCardSkeleton key={delayMs} delayMs={delayMs} />
          ))}
        </ul>
      )}

      {hasCvs && (
        <ul className="cv-grid" aria-label="Saved CVs">
          {cvs.map((cv, index) => (
            <CvCard key={cv.id} cv={cv} index={index} now={now} />
          ))}
        </ul>
      )}

      {isEmpty && (
        <StatePanel
          visual={<FloatingDocArt variant="empty" />}
          title="Create your first CV"
          description="Turn your experience into a professional CV with AI."
          action={
            <Link to="/cvs/new" className="btn btn-primary empty-cta">
              <PlusIcon />
              <span>Create CV</span>
            </Link>
          }
        />
      )}

      {isError && (
        <StatePanel
          tone="error"
          visual={
            <StateIcon tone="error">
              <AlertCircleIcon />
            </StateIcon>
          }
          title="We couldn’t load your CVs"
          description="Your CVs are safe — this is usually a connection problem. Check your internet and try again."
          action={
            <button
              type="button"
              className="btn btn-primary empty-cta"
              onClick={() => void retry()}
            >
              <RetryIcon />
              <span>Try again</span>
            </button>
          }
          note={error instanceof ApiError && error.status > 0 ? `Error ${error.status}` : undefined}
        />
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {isLoading ? 'Loading your CVs…' : ''}
      </p>
    </main>
  );
}
