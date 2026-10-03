import type { CvSummary } from '@cv-builder/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link } from 'react-router';
import { ApiError } from '../../../lib/api-client';
import { useMediaQuery } from '../../../lib/use-media-query';
import { useNow } from '../../../lib/use-now';
import { FloatingDocArt } from '../../../ui/FloatingDocArt';
import { AlertCircleIcon, PlusIcon, RetryIcon } from '../../../ui/icons';
import { StateIcon, StatePanel } from '../../../ui/StatePanel';
import { Toast } from '../../../ui/Toast';
import { forgetCv, useCvs, useDeleteCv } from '../api';
import { CvCard, CvCardSkeleton } from './CvCard';
import { moreButtonId } from './CvCardMenu';
import { DeleteCvDialog } from './DeleteCvDialog';
import './dashboard.css';

const SKELETON_DELAYS_MS = [0, 140, 280];
/** The design's exits: the dialog fades, then the card leaves, then the others close the gap. */
const DIALOG_LEAVE_MS = 150;
const CARD_LEAVE_MS = 200;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** "My CVs": the signed-in user's CVs, with loading, empty and error states from the design. */
export function CvListPage() {
  const { data, error, isFetching, refetch } = useCvs();
  const queryClient = useQueryClient();
  const deleteCv = useDeleteCv();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const now = useNow(60_000);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  // Only one card's menu is open at a time, and the delete dialog belongs to one CV.
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ cv: CvSummary; leaving: boolean } | null>(null);
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ id: number; title: string } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const toastCount = useRef(0);

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

  function askDelete(cv: CvSummary) {
    setOpenMenuId(null);
    deleteCv.reset();
    setDialog({ cv, leaving: false });
  }

  async function cancelDelete() {
    if (!dialog || dialog.leaving || deleteCv.isPending) return;
    const { cv } = dialog;
    setDialog({ cv, leaving: true });
    await pause(reduceMotion ? 0 : DIALOG_LEAVE_MS);
    // The dialog has to be gone before focus can go back: while it is a modal, the page is inert.
    flushSync(() => setDialog(null));
    // Back to the card's ⋯, where the person came from.
    document.getElementById(moreButtonId(cv.id))?.focus();
  }

  /**
   * Deletes on the server first; only then does the card leave, so a failure leaves the card (and
   * the dialog, with the reason) as it was. Async on purpose: it carries on if the person leaves
   * the page meanwhile, so the cached list never keeps a deleted CV.
   */
  async function confirmDelete() {
    if (!dialog || dialog.leaving || deleteCv.isPending) return;
    const { cv } = dialog;
    try {
      await deleteCv.mutateAsync(cv.id);
    } catch {
      return; // The dialog stays open and says why.
    }

    setDialog({ cv, leaving: true });
    await pause(reduceMotion ? 0 : DIALOG_LEAVE_MS);
    setDialog(null);
    setLeavingId(cv.id);
    await pause(reduceMotion ? 0 : CARD_LEAVE_MS);
    await forgetCv(queryClient, cv.id);
    setLeavingId(null);
    toastCount.current += 1;
    setToast({ id: toastCount.current, title: cv.title });
    // The card that had focus is gone; the page's own heading is the next place to be.
    titleRef.current?.focus();
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
          <p className="page-sub">Create and edit your CVs in one place.</p>
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
            <CvCard
              key={cv.id}
              cv={cv}
              index={index}
              now={now}
              menuOpen={openMenuId === cv.id}
              onMenuOpenChange={(open) => setOpenMenuId(open ? cv.id : null)}
              leaving={leavingId === cv.id}
              onAskDelete={() => askDelete(cv)}
              onRenamed={(title) => setAnnouncement(`Renamed to “${title}”`)}
            />
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
        {isLoading ? 'Loading your CVs…' : announcement}
      </p>

      {openMenuId && (
        // Outside the cards: it covers the page (and the header) so a click anywhere else closes
        // the menu and does nothing more.
        <button
          type="button"
          className="menu-backdrop for-card"
          tabIndex={-1}
          aria-label="Close menu"
          onClick={() => setOpenMenuId(null)}
        />
      )}

      {dialog && (
        <DeleteCvDialog
          cv={dialog.cv}
          now={now}
          pending={deleteCv.isPending}
          error={deleteCv.error}
          leaving={dialog.leaving}
          onCancel={() => void cancelDelete()}
          onConfirm={() => void confirmDelete()}
        />
      )}

      {/* Always in the page, so a screen reader hears what appears in it. */}
      <div className="toast-region for-page" role="status" aria-live="polite">
        {toast && (
          <Toast key={toast.id} onDone={() => setToast(null)}>
            Deleted <strong>“{toast.title}”</strong>
          </Toast>
        )}
      </div>
    </main>
  );
}
