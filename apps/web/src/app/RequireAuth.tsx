import { Navigate, Outlet, useLocation } from 'react-router';
import { useSession } from '../features/auth/api';
import { ApiError } from '../lib/api-client';
import { AlertCircleIcon, RetryIcon } from '../ui/icons';
import { StateIcon, StatePanel } from '../ui/StatePanel';
import { AppHeader } from './AppHeader';
import './layout.css';

/**
 * The app's pages are for signed-in users. Until the session is known nothing is shown; without
 * one, the login page opens and remembers where the user was going (`GuestOnly` returns there).
 * If the session can't be checked at all, that's a connection problem, not a reason to log in.
 */
export function RequireAuth() {
  const session = useSession();
  const location = useLocation();

  if (session.data) {
    return <Outlet />;
  }
  if (session.data === null) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  if (session.isError) {
    // The header stays, as on the design's "couldn't load" pages; without a user it has no menu.
    // While Try again runs, the query is pending again, so the empty page below shows meanwhile.
    return (
      <>
        <AppHeader />
        <main className="page-main">
          <title>Something went wrong · CV Builder</title>
          <StatePanel
            tone="error"
            headingLevel="h1"
            visual={
              <StateIcon tone="error">
                <AlertCircleIcon />
              </StateIcon>
            }
            title="We couldn’t load this page"
            description="Your CVs are safe — this is usually a connection problem. Check your internet and try again."
            action={
              <button
                type="button"
                className="btn btn-primary empty-cta"
                onClick={() => void session.refetch()}
              >
                <RetryIcon />
                <span>Try again</span>
              </button>
            }
            note={
              session.error instanceof ApiError && session.error.status > 0
                ? `Error ${session.error.status}`
                : undefined
            }
          />
        </main>
      </>
    );
  }
  return <main className="page-main" aria-busy="true" />;
}
