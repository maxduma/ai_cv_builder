import type { AuthUser } from '@cv-builder/shared';
import { useEffect, useRef } from 'react';
import { useLogout } from '../features/auth/api';
import { ApiError } from '../lib/api-client';
import { ChevronDownIcon, ErrorIcon, LogoutIcon } from '../ui/icons';

/** "AM" for "Alex Morgan": the first letters of the first and the last name. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  const first = words[0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1] ?? '') : '';
  // Array.from splits by character, so a letter outside the BMP isn't cut in half.
  return [first, last]
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toUpperCase();
}

/**
 * The account button in the header: who is signed in, and Log out. `AppLayout` owns whether it's
 * open, because the backdrop that closes it sits outside the header.
 */
export function UserMenu({
  user,
  open,
  onOpenChange,
}: {
  user: AuthUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const logout = useLogout();
  const letters = initials(user.name);

  function toggle() {
    // A failed Log out from before is no longer news.
    if (!open) logout.reset();
    onOpenChange(!open);
  }

  // Escape closes the menu wherever focus is: a mouse click on the menu's header leaves focus on
  // the page body (Safari and Firefox on macOS don't focus clicked buttons either).
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onOpenChange(false);
      // Back to the button, unless the user has already put focus somewhere else on the page.
      const active = document.activeElement;
      if (!active || active === document.body || wrapRef.current?.contains(active)) {
        buttonRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  return (
    <div ref={wrapRef} className="user-wrap">
      <button
        ref={buttonRef}
        type="button"
        className="user-btn"
        aria-label={`${user.name}, account menu`}
        // A disclosure, not an ARIA menu: the popup also holds the name, email and errors.
        aria-expanded={open}
        aria-controls="user-menu"
        onClick={toggle}
      >
        <span className="avatar" aria-hidden="true">
          {letters}
        </span>
        <span className="user-name">{user.name}</span>
        <ChevronDownIcon className="user-chev" />
      </button>

      {open && (
        <div id="user-menu" className="menu menu-user">
          <div className="um-head">
            <span className="avatar avatar-lg" aria-hidden="true">
              {letters}
            </span>
            <span className="um-id">
              <span className="um-name">{user.name}</span>
              <span className="um-mail">{user.email}</span>
            </span>
          </div>
          <span className="menu-sep" aria-hidden="true" />
          <button
            type="button"
            className="menu-item"
            aria-busy={logout.isPending}
            onClick={() => {
              if (!logout.isPending) logout.mutate();
            }}
          >
            <LogoutIcon className="mi-icon" />
            <span>Log out</span>
          </button>
          {logout.isError && (
            // Still signed in: the session cookie can only be cleared by the server.
            <p className="error menu-error" role="alert">
              <ErrorIcon />
              <span>
                {logout.error instanceof ApiError
                  ? logout.error.message
                  : 'Something went wrong. Try again in a moment.'}
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
