import {
  type CvDetail,
  SOURCE_PDF_MAX_BYTES,
  SOURCE_TEXT_MAX_LENGTH,
  SOURCE_TEXT_MIN_LENGTH,
  type SourceDocumentDto,
  TARGET_ROLE_MIN_LENGTH,
} from '@cv-builder/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router';
import { ApiError } from '../../../lib/api-client';
import { useCurrentUser } from '../../auth/api';
import { cacheStartedJob, cvKeys, cvsApi } from '../api';
import { clearSavedForm, hasUnsentInput, readSavedForm, writeSavedForm } from './saved-form';

export type PdfState =
  | { phase: 'uploading'; name: string; size: number; progress: number }
  | { phase: 'reading'; name: string; size: number }
  | { phase: 'ready'; document: SourceDocumentDto };

export type SubmitState = 'idle' | 'queued' | 'starting';

const UPLOAD_ERRORS: Record<string, string> = {
  UNSUPPORTED_FILE_TYPE: 'That file isn’t a PDF. Export your CV as a PDF and try again.',
  FILE_TOO_LARGE: 'That file is over 10 MB. Try a smaller PDF.',
  PDF_NO_TEXT:
    'This PDF has no selectable text — it looks like a scan. Upload a text-based PDF or describe your experience below.',
  PDF_UNREADABLE: 'We couldn’t read that PDF. It may be damaged or password-protected.',
  PDF_TOO_MANY_PAGES: 'That PDF is over 20 pages. Upload just your CV.',
  PDF_TOO_MUCH_TEXT: 'That PDF has far more text than a CV. Upload just your CV.',
  NETWORK_ERROR: 'Upload failed. Check your connection and try again.',
};
const UPLOAD_FAILED = 'Upload failed. Try again in a moment.';

const STARTER_LINES = {
  role: '• Job title at Company (2021–now): what you owned and the result.',
  win: '• Achievement: what you changed and the measurable result.',
  skills: 'Skills: ',
};

export type StarterLine = keyof typeof STARTER_LINES;

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

/** Fields the form moves focus to; owned by the page so `useCvDraft`'s result holds no refs. */
export interface FormRefs {
  role: RefObject<HTMLInputElement | null>;
  text: RefObject<HTMLTextAreaElement | null>;
  drop: RefObject<HTMLButtonElement | null>;
}

interface InFlightUpload {
  controller: AbortController;
  /** The PDF it replaces, which the server keeps if this upload fails. */
  previous: SourceDocumentDto | null;
  /** All bytes reached the server, so it may have stored the file already. */
  sent: boolean;
  /** The user removed it (✕) after it was sent: whatever it stored is deleted once it ends. */
  cancelled: boolean;
  /** Resolves with the stored document, or `null` if the upload failed or was cancelled. */
  done: Promise<SourceDocumentDto | null>;
}

/**
 * State and actions of the "Create a new CV" form. The CV is created on the server as a draft the
 * first time it is needed (a PDF is chosen, or Generate is pressed), so uploads can start at once;
 * from then on the page's address is the draft's, so a reload reopens it with its PDF. The role and
 * description typed so far go with the draft when it is created; later changes are saved when
 * Generate is pressed. Until then they are mirrored to the tab's `sessionStorage` (see
 * `saved-form.ts`), so a reload brings them back, and closing the tab asks first. `initial` is an
 * existing draft being edited.
 */
export function useCvDraft(initial: CvDetail | null, refs: FormRefs) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const userId = useCurrentUser()?.id ?? '';

  const [cvId, setCvId] = useState(initial?.id ?? null);
  // What a reload interrupted wins over what the server has: it is newer.
  const [restored] = useState(() => (userId ? readSavedForm(userId, initial?.id ?? null) : null));
  const [role, setRole] = useState(restored?.role ?? initial?.targetRole ?? '');
  const [text, setText] = useState(restored?.text ?? initial?.sourceText ?? '');
  const [pdf, setPdf] = useState<PdfState | null>(
    initial?.sourceDocument ? { phase: 'ready', document: initial.sourceDocument } : null,
  );
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [live, setLive] = useState('');

  // Only read in event handlers: the draft being created, the upload in flight, the latest input.
  const draft = useRef<Promise<string> | null>(null);
  const upload = useRef<InFlightUpload | null>(null);
  const latest = useRef({ role, text });
  useEffect(() => {
    latest.current = { role, text };
  });
  // What the server has: the draft as loaded, then whatever the draft was created with.
  const sent = useRef({ role: initial?.targetRole ?? '', text: initial?.sourceText ?? '' });

  // Mirror the form to this tab's storage, so a reload brings it back; leaving the form by a link
  // (or starting the generation) drops it, so a later "Create a new CV" opens empty.
  useEffect(() => {
    if (userId) writeSavedForm(userId, cvId, { role, text });
  }, [userId, cvId, role, text]);
  useEffect(() => clearSavedForm, []);

  // Closing the tab discards what the server doesn't have yet, so ask first. A reload also asks,
  // though the mirror above would bring the form back.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (hasUnsentInput(latest.current, sent.current)) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  // Leaving the page cancels an upload in flight, and a generation that starts afterwards
  // doesn't pull the user back here.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      upload.current?.controller.abort();
    };
  }, []);

  /** Opens the CV's status page, unless the user has already left the form. */
  function showStatus(cvId: string) {
    if (mounted.current) navigate(`/cvs/${cvId}`, { replace: true });
  }

  const roleValue = role.trim();
  const roleOk = roleValue.length >= TARGET_ROLE_MIN_LENGTH;
  const textLength = text.trim().length;
  const textOk = textLength >= SOURCE_TEXT_MIN_LENGTH;
  const pdfOk = pdf?.phase === 'ready';
  const pdfBusy = pdf !== null && pdf.phase !== 'ready';
  const sourceOk = pdfOk || textOk;
  const ready = roleOk && sourceOk && !pdfBusy;

  // Errors appear only after Generate was pressed, as in the design.
  const roleError = showErrors && !roleOk ? 'Add the role you’re applying for.' : null;
  let sourceError: string | null = null;
  if (showErrors && !pdfBusy && !sourceOk) {
    sourceError =
      textLength > 0
        ? 'Add a little more — a sentence or two about your experience.'
        : 'Upload your CV above or describe your experience here.';
  }

  function ensureDraft(): Promise<string> {
    if (initial) return Promise.resolve(initial.id);
    if (!draft.current) {
      const { role: currentRole, text: currentText } = latest.current;
      const sentRole = currentRole.trim().length >= TARGET_ROLE_MIN_LENGTH ? currentRole : '';
      const creating = cvsApi
        .create({ targetRole: sentRole || undefined, sourceText: currentText || undefined })
        .then((cv) => {
          sent.current = { role: sentRole, text: currentText };
          setCvId(cv.id);
          // The form now edits this draft: a reload or Back reopens it (with its PDF) instead of
          // starting another. Not navigate(), which would remount the form and cancel the upload.
          if (mounted.current) {
            window.history.replaceState(window.history.state, '', `/cvs/${cv.id}/edit`);
          }
          void queryClient.invalidateQueries({ queryKey: cvKeys.list() });
          return cv.id;
        });
      draft.current = creating;
      creating.catch(() => {
        if (draft.current === creating) draft.current = null;
      });
    }
    return draft.current;
  }

  async function choosePdf(file: File) {
    if (submitState !== 'idle' || upload.current) return;
    if (!isPdfFile(file)) {
      setPdfError(UPLOAD_ERRORS.UNSUPPORTED_FILE_TYPE ?? UPLOAD_FAILED);
      setLive('That file is not a PDF.');
      return;
    }
    if (file.size > SOURCE_PDF_MAX_BYTES) {
      setPdfError(UPLOAD_ERRORS.FILE_TOO_LARGE ?? UPLOAD_FAILED);
      setLive('That file is over 10 MB.');
      return;
    }

    let finish!: (document: SourceDocumentDto | null) => void;
    const current: InFlightUpload = {
      controller: new AbortController(),
      previous: pdf?.phase === 'ready' ? pdf.document : null,
      sent: false,
      cancelled: false,
      done: new Promise((resolve) => (finish = resolve)),
    };
    upload.current = current;
    setPdfError(null);
    setPdf({ phase: 'uploading', name: file.name, size: file.size, progress: 0 });
    setLive(`Uploading ${file.name}.`);

    let document: SourceDocumentDto | null = null;
    try {
      const cvId = await ensureDraft();
      document = await cvsApi.uploadSourceDocument(cvId, file, {
        signal: current.controller.signal,
        onProgress: (fraction) =>
          setPdf((state) =>
            state?.phase === 'uploading'
              ? { ...state, progress: Math.round(fraction * 100) }
              : state,
          ),
        onSent: () => {
          current.sent = true;
          setPdf((state) =>
            state?.phase === 'uploading'
              ? { phase: 'reading', name: state.name, size: state.size }
              : state,
          );
        },
      });
      // A cancelled upload is removed again by `removePdf`, which also updates the card.
      if (!current.cancelled) {
        setPdf({ phase: 'ready', document });
        setLive(`${document.originalName} uploaded.`);
      }
      void queryClient.invalidateQueries({ queryKey: cvKeys.all });
    } catch (error) {
      if (!current.controller.signal.aborted && !current.cancelled) {
        const message =
          error instanceof ApiError ? (UPLOAD_ERRORS[error.code] ?? UPLOAD_FAILED) : UPLOAD_FAILED;
        // A failed replacement leaves the previous file on the server, so its card comes back.
        setPdf(current.previous ? { phase: 'ready', document: current.previous } : null);
        setPdfError(message);
        setLive(message);
      }
    } finally {
      if (upload.current === current) upload.current = null;
      finish(document);
    }
  }

  /** ✕ on the file card: cancels the upload in flight, or removes the uploaded PDF. */
  async function removePdf() {
    const inFlight = upload.current;
    if (inFlight && !inFlight.sent) {
      // Nothing reached the server: back to how it was.
      inFlight.controller.abort();
      upload.current = null;
      setPdf(inFlight.previous ? { phase: 'ready', document: inFlight.previous } : null);
      setLive('Upload cancelled.');
      return;
    }

    setRemoving(true);
    setPdfError(null);
    let stored: SourceDocumentDto | null = pdf?.phase === 'ready' ? pdf.document : null;
    try {
      if (inFlight) {
        // Every byte was sent, so the server finishes reading the file even if the request is
        // aborted. Removing it before then would race that upload, which would store the file
        // afterwards; so wait for it, then remove what it stored. The card stays until then.
        inFlight.cancelled = true;
        stored = await inFlight.done;
        if (!stored) {
          // It failed: nothing was stored, and the PDF it was replacing is still there.
          setPdf(inFlight.previous ? { phase: 'ready', document: inFlight.previous } : null);
          setLive('Upload cancelled.');
          return;
        }
      }
      await cvsApi.removeSourceDocument(await ensureDraft());
      flushSync(() => setPdf(null));
      setLive('CV removed.');
      refs.drop.current?.focus();
      void queryClient.invalidateQueries({ queryKey: cvKeys.all });
    } catch {
      // The card shows what the server still has, so ✕ can be pressed again.
      setPdf(stored ? { phase: 'ready', document: stored } : null);
      setPdfError('We couldn’t remove the file. Try again.');
    } finally {
      setRemoving(false);
    }
  }

  function addStarterLine(kind: StarterLine) {
    const separator = text && !text.endsWith('\n') ? '\n' : '';
    const next = (text + separator + STARTER_LINES[kind]).slice(0, SOURCE_TEXT_MAX_LENGTH);
    flushSync(() => setText(next));
    const textarea = refs.text.current;
    textarea?.focus();
    textarea?.setSelectionRange(next.length, next.length);
  }

  function revealErrors(focusRole: boolean) {
    flushSync(() => setShowErrors(true));
    (focusRole ? refs.role : refs.text).current?.focus();
  }

  async function start() {
    setSubmitState('starting');
    setSubmitError(null);
    try {
      const cvId = await ensureDraft();
      const inputs = latest.current;
      // An emptied description is cleared, so it isn't used for the generation.
      const cv = await cvsApi.update(cvId, { targetRole: inputs.role, sourceText: inputs.text });
      sent.current = { role: inputs.role, text: inputs.text };
      const job = await cvsApi.startGeneration(cvId);
      cacheStartedJob(queryClient, cv, job);
      clearSavedForm();
      showStatus(cvId);
    } catch (error) {
      setSubmitState('idle');
      if (error instanceof ApiError && error.code === 'GENERATION_IN_PROGRESS') {
        // Already running (another tab): show it.
        const cvId = await ensureDraft();
        await queryClient.invalidateQueries({ queryKey: cvKeys.detail(cvId) });
        showStatus(cvId);
        return;
      }
      if (error instanceof ApiError && error.code === 'CV_NOT_READY') {
        revealErrors(!roleOk);
        return;
      }
      setSubmitError(
        error instanceof ApiError ? error.message : 'Something went wrong. Try again in a moment.',
      );
    }
  }

  /** Generate is never disabled: it explains what's missing, or waits for an upload to finish. */
  async function generate() {
    // A PDF being removed must not go into the generation.
    if (submitState !== 'idle' || removing) return;

    const waitingFor = upload.current;
    if (roleOk && waitingFor) {
      setSubmitState('queued');
      setSubmitError(null);
      setLive('Your CV is still uploading. Generation starts as soon as it’s ready.');
      const document = await waitingFor.done;
      setSubmitState('idle');
      // A failed or cancelled upload has already explained itself.
      if (!document || waitingFor.cancelled) return;
      if (latest.current.role.trim().length < TARGET_ROLE_MIN_LENGTH) {
        revealErrors(true);
        return;
      }
      await start();
      return;
    }

    if (!ready) {
      setLive('');
      revealErrors(!roleOk);
      return;
    }
    await start();
  }

  return {
    /** The draft's id once it exists on the server. */
    cvId,
    role,
    setRole,
    text,
    setText,
    pdf,
    pdfError,
    removing,
    submitState,
    submitError,
    live,
    roleValue,
    roleOk,
    textOk,
    pdfOk,
    pdfBusy,
    sourceOk,
    ready,
    roleError,
    sourceError,
    choosePdf,
    removePdf,
    addStarterLine,
    generate,
  };
}

export type CvDraft = ReturnType<typeof useCvDraft>;
