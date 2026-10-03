import {
  type ContentConflictDetails,
  type CvContent,
  type CvDetail,
  contentEditIssues,
  deepEqual,
  mergeCvContent,
  savableContent,
} from '@cv-builder/shared';
import { ApiError } from '../../lib/api-client';
import { cvsApi } from '../cvs/api';

/** Matches the design: "Saving…" turns to "Saved" 700 ms after the last edit. */
const SAVE_DELAY_MS = 700;
/** Conflicts merged and retried in a row before giving up (someone else keeps saving). */
const MAX_CONFLICT_RETRIES = 3;

export type SaveStatus = 'saved' | 'saving' | 'failed';

/** A deletion that can be undone for a few seconds (see `UndoToast`). */
export interface Undo {
  id: number;
  /** What was deleted, e.g. "Software Engineer · Fieldline". */
  label: string;
  restore: (cv: CvContent) => CvContent;
}

export interface EditorSnapshot {
  /** The CV as the person sees it, unsaved edits included. */
  draft: CvContent;
  status: SaveStatus;
  /** Problems with values typed into the draft, by path (`contact.email`); those stay unsaved. */
  errors: Record<string, string>;
  undo: Undo | null;
  /** The latest screen-reader announcement; `seq` changes even when the text repeats. */
  live: { text: string; seq: number };
}

export interface EditorSession {
  subscribe(listener: () => void): () => void;
  getSnapshot(): EditorSnapshot;
  /** Changes the draft and saves it shortly. `undo` offers to take a deletion back. */
  edit(recipe: (cv: CvContent) => CvContent, undo?: Omit<Undo, 'id'>): void;
  /** Takes the last deletion back, if it can still be. */
  undo(): void;
  /** Takes the offer of undo `id` away; a later offer stays. */
  dismissUndo(id: number): void;
  /** Sends what is waiting now and resolves once it is saved, or the save has failed. */
  flush(): Promise<void>;
  /** "Try again" after a failed save. */
  retry(): void;
  /** A newer copy of the CV from the server: an answer applied, another tab's save. */
  receive(cv: CvDetail): void;
  announce(text: string): void;
  hasUnsavedChanges(): boolean;
  dispose(): void;
}

/**
 * The editing state of one CV, outside React so it outlives the page: a save in flight finishes,
 * and edits made just before leaving still go out, wherever the person goes next.
 *
 * It keeps `base`, the content as last synced with the server, next to the `draft`. Anything newer
 * from the server (an applied answer, another tab, a `409` after a conflicting save) is merged
 * three ways from `base` (see the shared `mergeCvContent`), so unsaved edits are never lost and
 * never overwritten. Saves go out one at a time, each over the version it was made from.
 */
export function createEditorSession(cvId: string, content: CvContent, contentVersion: number) {
  let base = content;
  let version = contentVersion;
  let draft = content;
  let undo: Undo | null = null;
  let undoSeq = 0;
  let live = { text: '', seq: 0 };

  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  /** Server data that arrived while a save was in flight; applied once it settles. */
  let pending: CvDetail | null = null;
  let failed = false;

  /** What a save would send: the draft without the values that break a rule. */
  const payload = () => savableContent(base, draft);
  const isDirty = () => !deepEqual(payload(), base);

  const listeners = new Set<() => void>();
  let snapshot = build();

  function build(): EditorSnapshot {
    const busy = inFlight !== null || timer !== null;
    const errors = Object.fromEntries(
      contentEditIssues(base, draft).map((issue) => [issue.path.join('.'), issue.message]),
    );
    const dirty = isDirty();
    const status: SaveStatus = failed && dirty ? 'failed' : busy || dirty ? 'saving' : 'saved';
    return { draft, status, errors, undo, live };
  }

  function emit() {
    snapshot = build();
    for (const listener of listeners) listener();
  }

  function schedule(delay = SAVE_DELAY_MS) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void save();
    }, delay);
  }

  /** Takes newer server content in, keeping every unsaved edit (they win any conflict). */
  function adopt(content: CvContent, contentVersion: number) {
    draft = mergeCvContent(base, draft, content);
    base = content;
    version = contentVersion;
    // What a deletion would restore may predate the merge.
    undo = null;
  }

  function save(): Promise<void> {
    if (inFlight) return inFlight;
    if (!isDirty()) {
      emit();
      return Promise.resolve();
    }
    failed = false;
    inFlight = send().finally(() => {
      inFlight = null;
      settle();
    });
    emit();
    return inFlight;
  }

  /** Sends the draft; on a conflict, merges the newer content in and sends again. */
  async function send() {
    for (let conflicts = 0; ; conflicts += 1) {
      const sending = payload();
      if (deepEqual(sending, base)) return;
      try {
        const saved = await cvsApi.saveContent(cvId, { baseVersion: version, content: sending });
        base = sending;
        version = saved.contentVersion;
        return;
      } catch (error) {
        const conflict = conflictOf(error);
        if (conflict && conflicts < MAX_CONFLICT_RETRIES) {
          adopt(conflict.content, conflict.contentVersion);
          emit();
          continue;
        }
        failed = true;
        // A 401 signs the app out; anything else stays on the page, ready to try again.
        if (!(error instanceof ApiError && error.status === 401)) {
          announce('Your latest changes couldn’t be saved. They’re kept on this page.');
        }
        return;
      }
    }
  }

  /** After a save: server data that came meanwhile, then any edit made meanwhile. */
  function settle() {
    const waiting = pending;
    pending = null;
    if (waiting) receive(waiting);
    if (!failed && isDirty() && !timer) schedule();
    emit();
  }

  function receive(cv: CvDetail) {
    if (!cv.content || cv.contentVersion <= version) return;
    if (inFlight) {
      pending = cv;
      return;
    }
    adopt(cv.content, cv.contentVersion);
    if (isDirty() && !timer) schedule();
    emit();
  }

  function announce(text: string) {
    live = { text, seq: live.seq + 1 };
    emit();
  }

  const session: EditorSession = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    edit(recipe, offer) {
      const next = recipe(draft);
      if (next === draft) return;
      draft = next;
      undoSeq += 1;
      undo = offer ? { ...offer, id: undoSeq } : null;
      if (offer) {
        live = {
          text: `Deleted “${offer.label}”. Press Undo to bring it back.`,
          seq: live.seq + 1,
        };
      }
      schedule();
      emit();
    },
    undo() {
      if (!undo) return;
      draft = undo.restore(draft);
      undo = null;
      schedule();
      announce('Restored.');
    },
    dismissUndo(id) {
      if (!undo || undo.id !== id) return;
      undo = null;
      emit();
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      // A save in flight first; edits made meanwhile go out right after it.
      if (inFlight) {
        await inFlight;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (failed) return;
      }
      await save();
    },
    retry() {
      failed = false;
      void save();
    },
    receive,
    announce,
    hasUnsavedChanges: () => inFlight !== null || timer !== null || isDirty(),
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      listeners.clear();
    },
  };
  return session;
}

function conflictOf(error: unknown): ContentConflictDetails | null {
  if (!(error instanceof ApiError) || error.code !== 'CONTENT_CONFLICT') return null;
  const details = error.details as Partial<ContentConflictDetails> | undefined;
  return details?.content && typeof details.contentVersion === 'number'
    ? (details as ContentConflictDetails)
    : null;
}

const sessions = new Map<string, EditorSession>();
/** Whose edits the sessions hold. */
let owner: string | null = null;

/**
 * The editing session of a CV, created the first time it is opened. It stays for as long as the
 * page is loaded, so coming back to the editor finds unsaved edits and saves still in progress.
 */
export function editorSessionFor(
  cv: CvDetail & { content: CvContent },
  userId: string,
): EditorSession {
  claimEditorSessions(userId);
  let session = sessions.get(cv.id);
  if (!session) {
    session = createEditorSession(cv.id, cv.content, cv.contentVersion);
    sessions.set(cv.id, session);
  }
  return session;
}

/** The editing session of a CV, if it has been opened since the page loaded; never creates one. */
export function findEditorSession(cvId: string): EditorSession | undefined {
  return sessions.get(cvId);
}

/**
 * Called when someone signs in: another user starts from the server's copies, while the same
 * user (back after their session expired) keeps their unsaved edits, and saves that failed
 * meanwhile go out again.
 */
export function claimEditorSessions(userId: string) {
  if (owner !== null && owner !== userId) clearEditorSessions();
  owner = userId;
  retryFailedEditorSessions();
}

/** Sends the saves that failed again, e.g. once the connection is back. */
export function retryFailedEditorSessions() {
  for (const session of sessions.values()) {
    if (session.getSnapshot().status === 'failed') session.retry();
  }
}

/**
 * Saves every CV's waiting edits now (retrying a failed save), e.g. before logging out or when a
 * phone puts the page in the background, where it may be closed without warning.
 */
export async function flushEditorSessions() {
  await Promise.allSettled([...sessions.values()].map((session) => session.flush()));
}

/** True while any CV has edits not yet saved: leaving the page now would lose them. */
export function hasUnsavedEdits(): boolean {
  return [...sessions.values()].some((session) => session.hasUnsavedChanges());
}

/** Forgets every session, on logout: the next user starts from the server's copy. */
export function clearEditorSessions() {
  for (const session of sessions.values()) session.dispose();
  sessions.clear();
  owner = null;
}
