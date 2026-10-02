import type { CvContent, CvDetail } from '@cv-builder/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useCurrentUser } from '../auth/api';
import { type EditorSession, type EditorSnapshot, editorSessionFor } from './editor-session';

/**
 * The editing session of a CV (see `editor-session.ts`), kept in step with the server's copy:
 * every newer version the CV query brings (an applied answer, another tab) is merged in. Render
 * with `key={cv.id}`.
 */
export function useEditorSession(
  cv: CvDetail & { content: CvContent },
): [EditorSnapshot, EditorSession] {
  // The editor only renders for a signed-in user.
  const userId = useCurrentUser()?.id ?? '';
  const [session] = useState(() => editorSessionFor(cv, userId));
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => session.receive(cv), [session, cv]);
  return [snapshot, session];
}
