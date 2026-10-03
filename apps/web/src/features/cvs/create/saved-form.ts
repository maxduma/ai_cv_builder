import { SOURCE_TEXT_MAX_LENGTH, TARGET_ROLE_MAX_LENGTH } from '@cv-builder/shared';

/**
 * What was typed into the "Create a new CV" form but not yet sent to the server, kept in this
 * tab's `sessionStorage` so a reload (or the browser discarding the tab on a phone) brings it back.
 * It belongs to one account and one draft (`cvId` is `null` before the draft exists), is dropped
 * when the form is left by a link or Generate starts, and goes away with the tab. Every access is
 * guarded: storage can be unavailable (private windows, blocked site data) and the form works
 * without it.
 */
const KEY = 'cvb:create-form';

export interface FormValues {
  role: string;
  text: string;
}

interface SavedForm extends FormValues {
  userId: string;
  cvId: string | null;
}

/** The values saved for this account and draft, or `null` when there are none. */
export function readSavedForm(userId: string, cvId: string | null): FormValues | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<SavedForm> | null;
    if (
      !saved ||
      saved.userId !== userId ||
      (saved.cvId ?? null) !== cvId ||
      typeof saved.role !== 'string' ||
      typeof saved.text !== 'string'
    ) {
      return null;
    }
    return {
      role: saved.role.slice(0, TARGET_ROLE_MAX_LENGTH),
      text: saved.text.slice(0, SOURCE_TEXT_MAX_LENGTH),
    };
  } catch {
    return null;
  }
}

/** Saves the values, or clears the entry when the form is empty. */
export function writeSavedForm(userId: string, cvId: string | null, values: FormValues): void {
  try {
    if (values.role === '' && values.text === '') {
      window.sessionStorage.removeItem(KEY);
      return;
    }
    const saved: SavedForm = { userId, cvId, ...values };
    window.sessionStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Storage is full or unavailable: the form keeps working, it just can't be restored.
  }
}

export function clearSavedForm(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // See above.
  }
}

/** Whether the form holds input the server doesn't have yet (compared as the server stores it). */
export function hasUnsentInput(typed: FormValues, sent: FormValues): boolean {
  return typed.role.trim() !== sent.role.trim() || typed.text.trim() !== sent.text.trim();
}
