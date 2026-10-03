import type { CvDetail } from '@cv-builder/shared';
import { Link } from 'react-router';
import { StatusChip } from '../../ui/StatusChip';
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, ErrorIcon } from '../../ui/icons';
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

/**
 * "Preview & download". A link in this tab: edits still waiting to be saved are saved on the way,
 * which a new tab couldn't do.
 */
export function PreviewLink({ cvId, className }: { cvId: string; className?: string }) {
  return (
    <Link
      to={`/cvs/${cvId}/preview`}
      className={className ? `btn btn-primary ${className}` : 'btn btn-primary'}
    >
      <span>Preview &amp; download</span>
      <ArrowRightIcon />
    </Link>
  );
}

/**
 * The editor's bar under the app header: back to My CVs, the CV's name, the save status and the
 * way on to the preview and the PDF (in the bottom bar on small screens).
 */
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
        <PreviewLink cvId={cv.id} className="ed-cta" />
      </div>
    </div>
  );
}
