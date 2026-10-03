import type { CvContent, CvDetail } from '@cv-builder/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api-client';
import { createEditorSession } from './editor-session';

// The session talks to the API only through `cvsApi.saveContent`.
const saveContent = vi.hoisted(() => vi.fn());
vi.mock('../cvs/api', () => ({ cvsApi: { saveContent } }));

const CONTENT: CvContent = {
  version: 1,
  contact: {
    firstName: 'Alex',
    lastName: 'Morgan',
    headline: 'Backend Engineer',
    email: 'alex@example.com',
    phone: '',
    location: '',
    workSetup: '',
    links: [],
  },
  summary: 'Builds payment APIs.',
  experience: [],
  education: [],
  skills: [],
};

const withSummary = (summary: string) => (cv: CvContent) => ({ ...cv, summary });

/** What the server sends back for a stale save: its newer copy of the content. */
const conflict = (content: CvContent, contentVersion: number) =>
  new ApiError(409, 'CONTENT_CONFLICT', 'The CV changed', { content, contentVersion });

/** A newer copy of the CV, as the server sends it (an applied answer, another tab's save). */
const newerCopy = (content: CvContent, contentVersion: number) =>
  ({ id: 'cv-1', content, contentVersion }) as CvDetail;

const SAVE_DELAY = 700;

beforeEach(() => {
  vi.useFakeTimers();
  saveContent.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('editor session', () => {
  it('saves quick edits as one request, over the version they were made from', async () => {
    saveContent.mockResolvedValue({ contentVersion: 2 });
    const session = createEditorSession('cv-1', CONTENT, 1);

    session.edit(withSummary('Builds payment APIs in Go.'));
    session.edit(withSummary('Builds payment APIs in Go and Rust.'));

    expect(session.getSnapshot().status).toBe('saving');
    expect(session.hasUnsavedChanges()).toBe(true);
    expect(saveContent).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(SAVE_DELAY);

    expect(saveContent).toHaveBeenCalledTimes(1);
    expect(saveContent).toHaveBeenCalledWith('cv-1', {
      baseVersion: 1,
      content: { ...CONTENT, summary: 'Builds payment APIs in Go and Rust.' },
    });
    expect(session.getSnapshot().status).toBe('saved');
    expect(session.hasUnsavedChanges()).toBe(false);
  });

  it('builds the next save on the version the last one returned', async () => {
    saveContent.mockResolvedValueOnce({ contentVersion: 2 }).mockResolvedValueOnce({
      contentVersion: 3,
    });
    const session = createEditorSession('cv-1', CONTENT, 1);

    session.edit(withSummary('First.'));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY);
    session.edit(withSummary('Second.'));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY);

    expect(saveContent.mock.calls.map(([, body]) => body.baseVersion)).toEqual([1, 2]);
  });

  it('sends nothing when an edit changes nothing', async () => {
    const session = createEditorSession('cv-1', CONTENT, 1);

    session.edit((cv) => cv);
    session.edit(withSummary(CONTENT.summary));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY);

    expect(saveContent).not.toHaveBeenCalled();
    expect(session.getSnapshot().status).toBe('saved');
  });

  it('flushes waiting edits at once, without waiting for the timer', async () => {
    saveContent.mockResolvedValue({ contentVersion: 2 });
    const session = createEditorSession('cv-1', CONTENT, 1);

    session.edit(withSummary('Edited just before leaving.'));
    await session.flush();

    expect(saveContent).toHaveBeenCalledTimes(1);
    expect(session.hasUnsavedChanges()).toBe(false);
  });

  describe('when the server has a newer version', () => {
    it('merges it into the edit and sends the result, keeping both', async () => {
      const theirs: CvContent = { ...CONTENT, skills: [{ id: 'skill-1', name: 'Go' }] };
      saveContent
        .mockRejectedValueOnce(conflict(theirs, 5))
        .mockResolvedValueOnce({ contentVersion: 6 });
      const session = createEditorSession('cv-1', CONTENT, 1);

      session.edit(withSummary('Edited by hand.'));
      await vi.advanceTimersByTimeAsync(SAVE_DELAY);

      expect(saveContent).toHaveBeenCalledTimes(2);
      expect(saveContent).toHaveBeenLastCalledWith('cv-1', {
        baseVersion: 5,
        content: { ...theirs, summary: 'Edited by hand.' },
      });
      expect(session.getSnapshot().status).toBe('saved');
      expect(session.getSnapshot().draft).toEqual({ ...theirs, summary: 'Edited by hand.' });
    });

    it('lets the person’s edit win a field both sides changed', async () => {
      const theirs: CvContent = { ...CONTENT, summary: 'Written by the AI.' };
      saveContent
        .mockRejectedValueOnce(conflict(theirs, 5))
        .mockResolvedValueOnce({ contentVersion: 6 });
      const session = createEditorSession('cv-1', CONTENT, 1);

      session.edit(withSummary('Written by hand.'));
      await vi.advanceTimersByTimeAsync(SAVE_DELAY);

      expect(session.getSnapshot().draft.summary).toBe('Written by hand.');
      expect(saveContent).toHaveBeenLastCalledWith('cv-1', {
        baseVersion: 5,
        content: { ...theirs, summary: 'Written by hand.' },
      });
    });

    it('gives up after a few conflicts in a row, keeping the edit and offering a retry', async () => {
      saveContent.mockImplementation(async () => {
        throw conflict({ ...CONTENT, skills: [{ id: 'skill-1', name: 'Go' }] }, 5);
      });
      const session = createEditorSession('cv-1', CONTENT, 1);

      session.edit(withSummary('Edited by hand.'));
      await vi.advanceTimersByTimeAsync(SAVE_DELAY);

      // The first try plus three merged retries.
      expect(saveContent).toHaveBeenCalledTimes(4);
      expect(session.getSnapshot().status).toBe('failed');
      expect(session.getSnapshot().draft.summary).toBe('Edited by hand.');
    });

    it('applies a newer copy that arrives during a save once the save is done', async () => {
      let finishSave: (value: { contentVersion: number }) => void = () => {};
      saveContent
        .mockReturnValueOnce(
          new Promise((resolve) => {
            finishSave = resolve;
          }),
        )
        .mockResolvedValueOnce({ contentVersion: 4 });
      const session = createEditorSession('cv-1', CONTENT, 1);

      // The summary is saved (version 2)…
      session.edit(withSummary('Edited by hand.'));
      await vi.advanceTimersByTimeAsync(SAVE_DELAY);
      // …while the person edits another field and an applied answer (version 3) arrives.
      session.edit((cv) => ({ ...cv, contact: { ...cv.contact, headline: 'Staff Engineer' } }));
      const answered: CvContent = {
        ...CONTENT,
        summary: 'Edited by hand.',
        skills: [{ id: 'skill-1', name: 'Go' }],
      };
      session.receive(newerCopy(answered, 3));

      // Mid-flight the draft is untouched; the copy waits.
      expect(session.getSnapshot().draft.skills).toEqual([]);

      finishSave({ contentVersion: 2 });
      await vi.advanceTimersByTimeAsync(0);

      // All three survive: the saved summary, the answer's skill and the headline typed meanwhile.
      const merged: CvContent = {
        ...answered,
        contact: { ...answered.contact, headline: 'Staff Engineer' },
      };
      expect(session.getSnapshot().draft).toEqual(merged);

      // The headline still has to be saved, over the answer's version.
      await vi.advanceTimersByTimeAsync(SAVE_DELAY);
      expect(saveContent).toHaveBeenLastCalledWith('cv-1', { baseVersion: 3, content: merged });
      expect(session.getSnapshot().status).toBe('saved');
    });

    it('ignores a copy that is not newer than what it already has', () => {
      const session = createEditorSession('cv-1', CONTENT, 3);

      session.receive(newerCopy({ ...CONTENT, summary: 'Old.' }, 3));
      session.receive(newerCopy({ ...CONTENT, summary: 'Older.' }, 2));

      expect(session.getSnapshot().draft).toEqual(CONTENT);
    });

    it('merges a newer copy into unsaved edits, and saves the result', async () => {
      saveContent.mockResolvedValue({ contentVersion: 6 });
      const session = createEditorSession('cv-1', CONTENT, 1);
      const answered: CvContent = { ...CONTENT, skills: [{ id: 'skill-1', name: 'Go' }] };

      session.edit(withSummary('Edited by hand.'));
      session.receive(newerCopy(answered, 5));

      expect(session.getSnapshot().draft).toEqual({ ...answered, summary: 'Edited by hand.' });
      await vi.advanceTimersByTimeAsync(SAVE_DELAY);
      expect(saveContent).toHaveBeenCalledWith('cv-1', {
        baseVersion: 5,
        content: { ...answered, summary: 'Edited by hand.' },
      });
    });
  });

  describe('when a save fails', () => {
    it('keeps the edit, says so, and sends it again on retry', async () => {
      saveContent
        .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server.'))
        .mockResolvedValueOnce({ contentVersion: 2 });
      const session = createEditorSession('cv-1', CONTENT, 1);

      session.edit(withSummary('Edited offline.'));
      await vi.advanceTimersByTimeAsync(SAVE_DELAY);

      const failed = session.getSnapshot();
      expect(failed.status).toBe('failed');
      expect(failed.draft.summary).toBe('Edited offline.');
      expect(failed.live.text).toContain('couldn’t be saved');
      expect(session.hasUnsavedChanges()).toBe(true);

      session.retry();
      await vi.advanceTimersByTimeAsync(0);

      expect(saveContent).toHaveBeenCalledTimes(2);
      expect(session.getSnapshot().status).toBe('saved');
    });

    it('does not announce an expired session: the app signs out instead', async () => {
      saveContent.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'Log in again.'));
      const session = createEditorSession('cv-1', CONTENT, 1);

      session.edit(withSummary('Edited too late.'));
      await vi.advanceTimersByTimeAsync(SAVE_DELAY);

      expect(session.getSnapshot().status).toBe('failed');
      expect(session.getSnapshot().live.text).toBe('');
    });
  });

  it('holds back a value that breaks a rule and saves the rest', async () => {
    saveContent.mockResolvedValue({ contentVersion: 2 });
    const session = createEditorSession('cv-1', CONTENT, 1);

    session.edit((cv) => ({
      ...cv,
      summary: 'A better summary.',
      contact: { ...cv.contact, email: 'not-an-email' },
    }));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY);

    expect(saveContent).toHaveBeenCalledWith('cv-1', {
      baseVersion: 1,
      content: { ...CONTENT, summary: 'A better summary.' },
    });
    const snapshot = session.getSnapshot();
    expect(snapshot.errors['contact.email']).toBeDefined();
    // What was typed stays on the page, with its error, until it is fixed.
    expect(snapshot.draft.contact.email).toBe('not-an-email');
  });

  it('takes a deletion back with undo', async () => {
    saveContent.mockResolvedValue({ contentVersion: 2 });
    const withSkill: CvContent = { ...CONTENT, skills: [{ id: 'skill-1', name: 'Go' }] };
    const session = createEditorSession('cv-1', withSkill, 1);

    session.edit((cv) => ({ ...cv, skills: [] }), {
      label: 'Go',
      restore: (cv) => ({ ...cv, skills: withSkill.skills }),
    });
    expect(session.getSnapshot().undo?.label).toBe('Go');
    session.undo();

    expect(session.getSnapshot().draft.skills).toEqual(withSkill.skills);
    // Back to what the server has: nothing to save.
    await vi.advanceTimersByTimeAsync(SAVE_DELAY);
    expect(saveContent).not.toHaveBeenCalled();
  });
});
