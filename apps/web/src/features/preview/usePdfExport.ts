import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../lib/api-client';
import { saveFile } from '../../lib/save-file';
import { cvsApi } from '../cvs/api';
import { findEditorSession } from '../editor/editor-session';

export type ExportPhase = 'idle' | 'preparing' | 'ready' | 'failed';

/** A PDF made on this page: "Download again" saves the same file. */
export interface MadePdf {
  blob: Blob;
  fileName: string;
  /** From the API; `null` if it didn't say. */
  pageCount: number | null;
}

/**
 * The design's steps while the PDF is made. The request reports no progress, so they advance on
 * a timer and wait on the last one.
 */
export const EXPORT_STEPS = ['Laying out your page', 'Embedding fonts', 'Adding clickable links'];
const STEP_MS = 550;

/**
 * Making and saving a CV's PDF. Edits the editor is still saving go out first (and a save that
 * failed is tried again), so the PDF has the CV as saved now. Leaving the page cancels a download
 * in progress, so it can't start on another page.
 */
export function usePdfExport(cvId: string) {
  const [phase, setPhase] = useState<ExportPhase>('idle');
  const [step, setStep] = useState(0);
  const [pdf, setPdf] = useState<MadePdf | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  useEffect(() => {
    if (phase !== 'preparing') return;
    const timer = setInterval(
      () => setStep((current) => Math.min(current + 1, EXPORT_STEPS.length - 1)),
      STEP_MS,
    );
    return () => clearInterval(timer);
  }, [phase]);

  /** Makes the PDF and saves it as `fileName`; resolves to whether it was saved. */
  async function download(fileName: string): Promise<boolean> {
    if (phase === 'preparing') return false;
    const controller = new AbortController();
    request.current = controller;
    setPhase('preparing');
    setStep(0);
    setError(null);
    try {
      await findEditorSession(cvId)?.flush();
      const made = await cvsApi.downloadPdf(cvId, controller.signal);
      saveFile(made.blob, fileName);
      setPdf({ ...made, fileName });
      setPhase('ready');
      return true;
    } catch (failure) {
      if (controller.signal.aborted) return false;
      setError(
        failure instanceof ApiError
          ? failure
          : new ApiError(0, 'NETWORK_ERROR', 'The PDF could not be downloaded.'),
      );
      setPhase('failed');
      return false;
    }
  }

  return {
    phase,
    step,
    pdf,
    error,
    download,
    downloadAgain: () => {
      if (pdf) saveFile(pdf.blob, pdf.fileName);
    },
    /** Back to the download settings ("Change settings", or closing "Your PDF is ready"). */
    close: () => setPhase('idle'),
  };
}
