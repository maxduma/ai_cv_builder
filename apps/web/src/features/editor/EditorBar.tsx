import type { CvDetail } from '@cv-builder/shared';
import { Link } from 'react-router';
import { StatusChip } from '../../ui/StatusChip';
import { ArrowLeftIcon, CheckIcon, ErrorIcon } from '../../ui/icons';
import type { SaveStatus } from './editor-session';

/**
 * The quiet save status of the design: "Saving…" while edits wait or travel, then "Saved". A
 * failed save says so, with a way to try again (the edits stay on the page). Not a live region:
 * it changes after every pause in typing; failures are announced separately.
 */
export function SaveStatusText({
  status,
  savedLabel = 'Saved',
  onRetry,
}: {
  status: SaveStatus;
  savedLabel?: string;
  onRetry: () => void;
}) {
  if (status === 'failed') {
    return (
      <span className="ed-save">
        <span className="ed-net">
          <ErrorIcon />
          <span className="ed-net-text">Couldn’t save</span>
        </span>
        <button type="button" className="ed-retry" onClick={onRetry}>
          Try again
        </button>
      </span>
    );
  }
  return (
    <span className="ed-save">
      {status === 'saving' ? (
        <>
          <span className="spinner" aria-hidden="true" />
          <span>Saving…</span>
        </>
      ) : (
        <>
          <CheckIcon size={14} />
          <span>{savedLabel}</span>
        </>
      )}
    </span>
  );
}

/** The editor's bar under the app header: back to My CVs, the CV's name and the save status. */
export function EditorBar({
  cv,
  status,
  onRetry,
}: {
  cv: CvDetail;
  status: SaveStatus;
  onRetry: () => void;
}) {
  return (
    <div className="ed-bar">
      <div className="ed-bar-in">
        <Link to="/" className="back-link" aria-label="Back to My CVs">
          <ArrowLeftIcon />
          <span>My CVs</span>
        </Link>
        <span className="ed-sep" aria-hidden="true" />
        <span className="ed-doc">
          <h1 className="ed-doc-title">{cv.title}</h1>
          <StatusChip status={cv.status} />
        </span>
        <SaveStatusText status={status} onRetry={onRetry} />
      </div>
    </div>
  );
}
