import { Navigate, Outlet, useLocation } from 'react-router';
import { useSession } from '../features/auth/api';
import { AuthLayout } from '../features/auth/AuthLayout';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Where to go once signed in: the page `RequireAuth` sent the user away from (kept in the
 * history state, so it's checked to be a path inside the app), or My CVs.
 */
function returnPath(state: unknown): string {
  const from = isRecord(state) ? state.from : undefined;
  if (!isRecord(from) || typeof from.pathname !== 'string') return '/';
  if (!from.pathname.startsWith('/') || from.pathname.startsWith('//')) return '/';
  const search = typeof from.search === 'string' ? from.search : '';
  const hash = typeof from.hash === 'string' ? from.hash : '';
  return from.pathname + search + hash;
}

/**
 * Log in and Sign up, for signed-out users. These pages never navigate themselves: once the
 * session has a user (they just logged in, or already were), this sends them on.
 */
export function GuestOnly() {
  const session = useSession();
  const location = useLocation();

  if (session.data) {
    return <Navigate to={returnPath(location.state)} replace />;
  }
  if (session.isPending && !session.isFetched) {
    // An empty page until the first check answers: a signed-in user never sees the form flash.
    // Later re-checks keep the form mounted, so nothing typed is lost.
    return <div className="auth" aria-busy="true" />;
  }
  // Signed out — or the check failed, in which case logging in is still worth a try.
  return (
    <AuthLayout>
      <Outlet />
    </AuthLayout>
  );
}
