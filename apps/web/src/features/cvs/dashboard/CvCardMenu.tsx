import { type KeyboardEvent, useEffect, useEffectEvent, useRef } from 'react';
import { MoreIcon, PencilIcon, TrashIcon } from '../../../ui/icons';
import { menuKeyAction } from './card-menu-keys';

/** The id of a card's ⋯ button, so focus can return to it after a dialog or a rename. */
export const moreButtonId = (cvId: string) => `more-${cvId}`;

interface Props {
  cvId: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: () => void;
  onDelete: () => void;
}

/**
 * A card's ⋯ button and its menu (Rename, Delete…). The page owns whether it is open: the
 * backdrop that closes it, and the card that rises over it, sit outside this component.
 */
export function CvCardMenu({ cvId, title, open, onOpenChange, onRename, onDelete }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = `menu-${cvId}`;
  const close = useEffectEvent(() => onOpenChange(false));

  // Escape closes the menu wherever focus is: a click on the menu's edge leaves focus on the page
  // body (Safari and Firefox on macOS don't focus clicked buttons).
  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
      // Back to ⋯, unless the person has already put focus somewhere else on the page.
      const active = document.activeElement;
      if (!active || active === document.body || wrapRef.current?.contains(active)) {
        buttonRef.current?.focus();
      }
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!open) return;
    const items = Array.from(wrapRef.current?.querySelectorAll<HTMLElement>('.menu-item') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const action = menuKeyAction(event, at, items.length);
    if (!action) return;

    event.preventDefault();
    if (action.kind === 'rename') onRename();
    else if (action.kind === 'delete') onDelete();
    else items[action.index]?.focus();
  }

  return (
    <div ref={wrapRef} className="more-wrap" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        id={moreButtonId(cvId)}
        className="more-btn"
        aria-label={`More actions for ${title}`}
        // A disclosure, as in the editor's entries: its items are plain buttons.
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => onOpenChange(!open)}
      >
        <MoreIcon />
      </button>
      {open && (
        <div id={menuId} className="menu menu-card">
          <button type="button" className="menu-item" aria-keyshortcuts="R" onClick={onRename}>
            <PencilIcon className="mi-icon" />
            <span>Rename</span>
            <kbd className="kbd">R</kbd>
          </button>
          <span className="menu-sep" aria-hidden="true" />
          <button
            type="button"
            className="menu-item is-danger"
            aria-keyshortcuts="Delete"
            onClick={onDelete}
          >
            <TrashIcon className="mi-icon" />
            <span>Delete…</span>
            <kbd className="kbd">⌫</kbd>
          </button>
        </div>
      )}
    </div>
  );
}
