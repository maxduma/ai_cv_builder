import type { AuthResponse, AuthUser, LoginRequest, SignUpRequest } from '@cv-builder/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ApiError, api } from '../../lib/api-client';
import {
  claimEditorSessions,
  clearEditorSessions,
  flushEditorSessions,
  hasUnsavedEdits,
} from '../editor/editor-session';
import { clearSavedForm } from '../cvs/create/saved-form';

const UNSAVED_ON_LOGOUT =
  'Some changes to your CV couldn’t be saved. If you log out now, they will be lost. Log out anyway?';

/** Who is signed in: the user, or `null` for nobody. The session cookie itself is httpOnly. */
export const sessionKey = ['session'] as const;

async function fetchSession(): Promise<AuthUser | null> {
  try {
    const { user } = await api.get<AuthResponse>('/auth/me');
    return user;
  } catch (error) {
    // No session or an expired one: signed out, which isn't an error.
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

/**
 * The session, checked once per page load. It never goes stale: logging in or out, and any
 * request the API refuses for want of a session (see `main.tsx`), keep it current. It errors only
 * when the check itself fails (offline, server down).
 */
export function useSession() {
  return useQuery({
    queryKey: sessionKey,
    queryFn: fetchSession,
    staleTime: Infinity,
    // Once per page load means once: a failed check is retried only on request ("Try again"),
    // not every time the tab regains focus or the network returns.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/** The signed-in user. The app's pages render only inside `RequireAuth`, which waits for one. */
export function useCurrentUser(): AuthUser | null {
  return useSession().data ?? null;
}

/** Drops everything cached for the previous user; only the session itself stays. */
function removeUserData(queryClient: QueryClient) {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== sessionKey[0] });
}

/**
 * Starts a new session without anything cached for someone else, even for a moment. There's no
 * navigation here: `GuestOnly` sees the user and leaves the login page.
 */
function startSession(queryClient: QueryClient, user: AuthUser) {
  removeUserData(queryClient);
  // Edits in progress stay only if it's the same person, back after their session expired.
  claimEditorSessions(user.id);
  queryClient.setQueryData<AuthUser | null>(sessionKey, user);
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginRequest) => api.post<AuthResponse>('/auth/login', input),
    onSuccess: ({ user }) => startSession(queryClient, user),
  });
}

export function useSignUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SignUpRequest) => api.post<AuthResponse>('/auth/signup', input),
    onSuccess: ({ user }) => startSession(queryClient, user),
  });
}

/**
 * Logs out and opens the login page, in an order that shows nothing in between: requests in
 * flight stop, the session is cleared (so the login page doesn't send the user back), the page
 * changes at once — `flushSync`, so no protected page renders signed out and redirects with its
 * own `from` — and only then is the user's data dropped, with no page left mounted to refetch it.
 */
export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    // CV edits still waiting are saved first. If some can't be (no connection), the person decides
    // whether to log out anyway: logging out forgets them.
    mutationFn: async (): Promise<'done' | 'cancelled'> => {
      await flushEditorSessions();
      if (hasUnsavedEdits() && !window.confirm(UNSAVED_ON_LOGOUT)) return 'cancelled';
      await api.post<void>('/auth/logout');
      return 'done';
    },
    onSuccess: async (result) => {
      if (result === 'cancelled') return;
      await queryClient.cancelQueries();
      queryClient.setQueryData<AuthUser | null>(sessionKey, null);
      await navigate('/login', { replace: true, flushSync: true });
      removeUserData(queryClient);
      clearEditorSessions();
      clearSavedForm();
    },
  });
}
