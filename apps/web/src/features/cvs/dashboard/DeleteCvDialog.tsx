import type { CvSummary } from '@cv-builder/shared';
import { useEffect, useRef } from 'react';
import { errorMessage } from '../../../lib/api-client';
import { formatRelativeTime } from '../../../lib/format';
import { classes } from '../../../lib/classes';
import { CvThumbIcon, ErrorIcon, TrashIcon } from '../../../ui/icons';
import { StatusChip } from '../../../ui/StatusChip';

interface Props {
  cv: CvSummary;
  now: number;
  /** The request is in flight: the dialog can't be dismissed, and the button shows it. */
  pending: boolean;
  /** Why the last attempt failed; `null` if it hasn't. */
  error: unknown;
  /** The dialog is on its way out (its animation). */
  leaving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * "Delete this CV?": a dialog on desktop, a sheet from the bottom edge on a phone. It is a modal
 * `<dialog>`, so the browser keeps focus inside it and the page behind inert. Focus starts on
 * Cancel, the safe choice.
 */
export function DeleteCvDialog({ cv, now, pending, error, leaving, onCancel, onConfirm }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className={classes('dlg', leaving && 'is-leaving')}
      role="alertdialog"
      aria-labelledby="del-title"
      aria-describedby="del-desc"
      onCancel={(event) => {
        // Escape: closed by our own animation, and not at all while the request runs.
        event.preventDefault();
        if (!pending) onCancel();
      }}
      // Some browsers close a dialog whose Escape was refused twice; our state must follow.
      onClose={(event) => {
        if (!event.currentTarget.open && !pending && !leaving) onCancel();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
    >
      <div className="dlg-panel">
        <span className="dlg-grabber" aria-hidden="true" />
        <div className="dlg-head">
          <span className="dlg-icon" aria-hidden="true">
            <TrashIcon size={20} />
          </span>
          <div>
            <h2 id="del-title" className="dlg-title">
              Delete this CV?
            </h2>
            <p id="del-desc" className="dlg-text">
              This permanently removes the CV and everything in it from your account. You can’t undo
              this.
            </p>
          </div>
        </div>

        <div className="dlg-subject">
          <CvThumbIcon className="dlg-thumb" />
          <span className="dlg-subject-text">
            <span className="dlg-subject-title">{cv.title}</span>
            <span className="dlg-subject-meta">
              Updated {formatRelativeTime(cv.updatedAt, now)}
            </span>
          </span>
          <StatusChip status={cv.status} />
        </div>

        {error != null && (
          <p className="error" role="alert">
            <ErrorIcon />
            <span>{errorMessage(error)}</span>
          </p>
        )}

        <div className="dlg-actions">
          <button
            type="button"
            className="btn btn-secondary"
            autoFocus
            aria-disabled={pending || undefined}
            onClick={() => {
              if (!pending) onCancel();
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            aria-busy={pending || undefined}
            onClick={() => {
              if (!pending) onConfirm();
            }}
          >
            {pending ? <span className="spinner" aria-hidden="true" /> : <TrashIcon />}
            <span>{pending ? 'Deleting…' : 'Delete CV'}</span>
          </button>
        </div>
      </div>
    </dialog>
  );
}
