import { useEffect, useRef } from 'react';
import { TrashIcon } from '../../ui/icons';
import type { EditorSession, Undo } from './editor-session';

/** How long the design keeps an undo toast up. */
const UNDO_MS = 6_000;

/**
 * "Deleted “Software Engineer · Fieldline”" with Undo, for six seconds. Hovering or focusing it
 * keeps it up; any other edit retires it (the session drops the offer), so Undo never rolls back
 * later work.
 */
export function UndoToast({ undo, session }: { undo: Undo | null; session: EditorSession }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const id = undo?.id;
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const start = () => {
    stop();
    if (id !== undefined) timer.current = setTimeout(() => session.dismissUndo(id), UNDO_MS);
  };

  useEffect(() => {
    if (id === undefined) return;
    const handle = setTimeout(() => session.dismissUndo(id), UNDO_MS);
    timer.current = handle;
    return () => {
      clearTimeout(handle);
      // A timer restarted on hover belongs to this offer too.
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [id, session]);

  if (!undo) return null;
  return (
    <div className="toast-region">
      <div className="toast" onMouseEnter={stop} onMouseLeave={start} onFocus={stop} onBlur={start}>
        <span className="toast-ico" aria-hidden="true">
          <TrashIcon size={12} />
        </span>
        <p className="toast-text">Deleted “{undo.label}”</p>
        <button type="button" className="toast-btn" onClick={() => session.undo()}>
          Undo
        </button>
      </div>
    </div>
  );
}
