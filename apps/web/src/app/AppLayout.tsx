import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { useCurrentUser } from '../features/auth/api';
import {
  flushEditorSessions,
  hasUnsavedEdits,
  retryFailedEditorSessions,
} from '../features/editor/editor-session';
import { AppHeader } from './AppHeader';
import { UserMenu } from './UserMenu';
import './layout.css';

/** Page chrome from the design: a sticky, translucent header; each page renders its own `<main>`. */
export function AppLayout() {
  const user = useCurrentUser();
  const location = useLocation();
  // The account menu belongs to the page it was opened on, so going anywhere else (a link, Back
  // or Forward) closes it. A stale page is forgotten during render (React's pattern for state that
  // follows a changing value), so coming back to that page later doesn't reopen the menu.
  const [menuOpenOn, setMenuOpenOn] = useState<string | null>(null);
  if (menuOpenOn !== null && menuOpenOn !== location.key) {
    setMenuOpenOn(null);
  }
  const menuOpen = menuOpenOn === location.key;

  // CV edits are saved even when the page is left (saves carry on after leaving the editor):
  // closing the tab while some are unsaved makes the browser ask first; a page put in the
  // background (switching apps on a phone, where it may be closed without that question) saves
  // them at once; and saves that failed for lack of a connection go out again when it is back.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (hasUnsavedEdits()) event.preventDefault();
    };
    const saveWhenHidden = () => {
      if (document.visibilityState === 'hidden') void flushEditorSessions();
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('visibilitychange', saveWhenHidden);
    window.addEventListener('online', retryFailedEditorSessions);
    return () => {
      window.removeEventListener('beforeunload', warn);
      document.removeEventListener('visibilitychange', saveWhenHidden);
      window.removeEventListener('online', retryFailedEditorSessions);
    };
  }, []);
  const setMenuOpen = (open: boolean) => setMenuOpenOn(open ? location.key : null);

  return (
    <>
      <AppHeader>
        {user && <UserMenu user={user} open={menuOpen} onOpenChange={setMenuOpen} />}
      </AppHeader>
      <Outlet />
      {menuOpen && (
        // Outside the header: its backdrop-filter would confine a fixed element to the header.
        <button
          type="button"
          className="menu-backdrop for-user"
          tabIndex={-1}
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
        />
      )}
    </>
  );
}
