import { cleanPdfFileName, defaultPdfFileName, PDF_FILE_NAME_MAX_LENGTH } from '@cv-builder/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type KeyboardEvent, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { Link, useParams } from 'react-router';
import type { ApiError } from '../../lib/api-client';
import { formatFileSize } from '../../lib/format';
import { useMediaQuery } from '../../lib/use-media-query';
import { CvPage } from '../../ui/CvPage';
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  CheckIcon,
  CheckLargeIcon,
  CloseIcon,
  DownloadIcon,
  ErrorIcon,
  MinusIcon,
  PdfFileIcon,
  PlusIcon,
} from '../../ui/icons';
import { cvKeys } from '../cvs/api';
import { type ReadyCv, ReadyCvGate } from '../cvs/ReadyCvGate';
import { type EditorSnapshot, findEditorSession } from '../editor/editor-session';
import { estimatePages, pageLabel } from '../editor/estimate-pages';
import { EXPORT_STEPS, type ExportPhase, type MadePdf, usePdfExport } from './usePdfExport';
import { useZoom } from './useZoom';
import './preview.css';

/** The progress bar's width at each of the design's steps. */
const STEP_PROGRESS = ['28%', '64%', '92%'];
/** How long "Downloaded again" shows. */
const AGAIN_MS = 2_200;
/** Below this, one column, a bottom bar, and "Your PDF is ready" as a bottom sheet. */
const NARROW = '(max-width: 1023px)';

const noSubscription = () => () => {};
const noSnapshot = () => null;

/**
 * `/cvs/:cvId/preview`: the CV at full size, as its PDF will look, and the PDF download. The PDF
 * is made by the API from the saved CV; edits still being saved are saved first.
 */
export function CvPreviewPage() {
  const { cvId = '' } = useParams();
  return (
    <ReadyCvGate cvId={cvId} loadingClassName="fp-main">
      {(cv) => <Preview key={cv.id} cv={cv} />}
    </ReadyCvGate>
  );
}

/**
 * Edits made in the editor (in this tab) that aren't saved: they are saved as the page opens, and
 * the CV is read again so the preview shows them. True while some couldn't be saved (a failed
 * save, or a value with an error), as the PDF leaves those out.
 */
function useUnsavedEdits(cvId: string): boolean {
  const queryClient = useQueryClient();
  const session = findEditorSession(cvId);
  const snapshot = useSyncExternalStore<EditorSnapshot | null>(
    session?.subscribe ?? noSubscription,
    session?.getSnapshot ?? noSnapshot,
  );

  useEffect(() => {
    if (!session) return;
    let current = true;
    void session.flush().then(() => {
      if (current) void queryClient.invalidateQueries({ queryKey: cvKeys.detail(cvId) });
    });
    return () => {
      current = false;
    };
  }, [session, queryClient, cvId]);

  return (
    snapshot !== null && (snapshot.status === 'failed' || Object.keys(snapshot.errors).length > 0)
  );
}

/** Focuses the first of `ids` that is shown: the card's button, or the bottom bar's on a phone. */
function focusShown(ids: string[]) {
  for (const id of ids) {
    const element = document.getElementById(id);
    if (element && element.getClientRects().length > 0) {
      element.focus();
      return;
    }
  }
}

function Preview({ cv }: { cv: ReadyCv }) {
  const unsaved = useUnsavedEdits(cv.id);
  const exporter = usePdfExport(cv.id);
  const deskRef = useRef<HTMLElement>(null);
  const zoom = useZoom(deskRef);
  const narrow = useMediaQuery(NARROW);
  // The suggested name follows the CV until the person types their own.
  const [typedName, setTypedName] = useState<string | null>(null);
  const [nameError, setNameError] = useState(false);
  const [againSeq, setAgainSeq] = useState(0);
  const [live, setLive] = useState({ text: '', seq: 0 });

  useEffect(() => {
    if (!againSeq) return;
    const timer = setTimeout(() => setAgainSeq(0), AGAIN_MS);
    return () => clearTimeout(timer);
  }, [againSeq]);

  const announce = (text: string) => setLive((current) => ({ text, seq: current.seq + 1 }));
  const fileName = typedName ?? defaultPdfFileName(cv.content);
  // The real count once a PDF has been made; until then the editor's estimate.
  const pages = exporter.pdf?.pageCount ?? estimatePages(cv.content).pages;
  const editorPath = `/cvs/${cv.id}/editor`;
  const ready = exporter.phase === 'ready' && exporter.pdf !== null;

  const download = async () => {
    const name = fileName.trim();
    if (!name) {
      setNameError(true);
      announce('Add a file name to download your CV.');
      document.getElementById('fp-name')?.focus();
      return;
    }
    setNameError(false);
    const file = `${name}.pdf`;
    announce(`Preparing ${file}…`);
    if (await exporter.download(file)) {
      announce(`Your PDF is ready. ${file} is downloading.`);
    }
  };

  const closeReady = () => {
    flushSync(() => exporter.close());
    focusShown(['fp-download', 'fp-download-m']);
    announce('Download settings.');
  };

  const downloadAgain = (pdf: MadePdf) => {
    exporter.downloadAgain();
    setAgainSeq((seq) => seq + 1);
    announce(`Downloading ${pdf.fileName} again.`);
  };

  const zoomBy = (next: number | null) => {
    if (next !== null) announce(`Zoom ${Math.round(next * 100)}%`);
  };

  return (
    <>
      <title>{`Preview · ${cv.title} · CV Builder`}</title>
      <div className="fp-bar">
        <div className="fp-bar-in">
          <Link to={editorPath} className="back-link" aria-label="Back to editor">
            <ArrowLeftIcon />
            <span>Editor</span>
          </Link>
          <span className="fp-sep" aria-hidden="true" />
          <span className="fp-doc">
            <h1 className="fp-doc-title">{cv.title}</h1>
            <span className="fp-doc-meta">{pageLabel(pages)}</span>
            {ready && (
              <span className="fp-ready-chip">
                <CheckIcon />
                PDF ready
              </span>
            )}
          </span>
          <div className="fp-zoom" role="group" aria-label="Zoom">
            <button
              type="button"
              className="icon-btn"
              aria-label="Zoom out"
              disabled={!zoom.canZoomOut}
              onClick={() => zoomBy(zoom.zoomOut())}
            >
              <MinusIcon />
            </button>
            <button
              type="button"
              className="fp-zoom-val"
              aria-label={`Zoom ${Math.round(zoom.zoom * 100)}%. Reset to 100%`}
              title="Reset to 100%"
              onClick={() => {
                zoom.reset();
                announce('Zoom 100%');
              }}
            >
              {Math.round(zoom.zoom * 100)}%
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Zoom in"
              disabled={!zoom.canZoomIn}
              onClick={() => zoomBy(zoom.zoomIn())}
            >
              <PlusIcon size={14} />
            </button>
            <span className="fp-zoom-sep" aria-hidden="true" />
            <button
              type="button"
              className="fp-zoom-fit"
              aria-pressed={zoom.fitted}
              aria-label="Fit page to window"
              onClick={() => {
                zoom.fitToWindow();
                announce('Fit to window');
              }}
            >
              Fit
            </button>
          </div>
        </div>
      </div>

      <main className={exporter.phase === 'failed' ? 'fp-main has-err' : 'fp-main'}>
        <div className="fp-layout">
          <section ref={deskRef} className="fp-desk" aria-label="Full preview of your CV">
            <div className="fp-desk-in">
              <div className="fp-sheet" style={{ zoom: zoom.zoom }}>
                <CvPage content={cv.content} />
              </div>
              <p className="fp-caption">
                {pages === 1
                  ? 'Page 1 of 1 · A4 · 210 × 297 mm'
                  : `${pages} pages · A4 · 210 × 297 mm`}
              </p>
            </div>
          </section>

          <aside className={ready ? 'fp-panel is-ready' : 'fp-panel'} aria-label="Download">
            {ready && exporter.pdf ? (
              <ReadyCard
                pdf={exporter.pdf}
                narrow={narrow}
                again={againSeq > 0}
                editorPath={editorPath}
                onAgain={downloadAgain}
                onClose={closeReady}
              />
            ) : (
              <DownloadCard
                phase={exporter.phase}
                step={exporter.step}
                error={exporter.error}
                pages={pages}
                unsaved={unsaved}
                editorPath={editorPath}
                fileName={fileName}
                nameError={nameError}
                onName={(value) => {
                  setTypedName(cleanPdfFileName(value));
                  setNameError(false);
                }}
                onNameBlur={() => {
                  const name = fileName.trim();
                  if (typedName !== null) setTypedName(name);
                  setNameError(!name);
                }}
                onDownload={() => void download()}
              />
            )}
          </aside>
        </div>
      </main>

      {ready ? (
        <button
          type="button"
          className="fp-backdrop"
          tabIndex={-1}
          aria-label="Close"
          onClick={closeReady}
        />
      ) : (
        <MobileBar
          fileName={`${fileName.trim() || 'CV'}.pdf`}
          meta={pageLabel(pages)}
          phase={exporter.phase}
          onDownload={() => void download()}
        />
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {/* A different text each time, so a repeated message is announced again. */}
        {live.text + (live.seq % 2 ? '\u200b' : '')}
      </p>
    </>
  );
}

function failureText(error: ApiError | null): string {
  return error?.code === 'NETWORK_ERROR'
    ? 'We couldn’t reach the server. Check your connection and try again — your CV is safe.'
    : 'Something went wrong on our side. Your CV is safe and nothing was changed — try again in a moment.';
}

/** "Download PDF": the file name, what the PDF is like, and the button, with its progress. */
function DownloadCard({
  phase,
  step,
  error,
  pages,
  unsaved,
  editorPath,
  fileName,
  nameError,
  onName,
  onNameBlur,
  onDownload,
}: {
  phase: ExportPhase;
  step: number;
  error: ApiError | null;
  pages: number;
  unsaved: boolean;
  editorPath: string;
  fileName: string;
  nameError: boolean;
  onName: (value: string) => void;
  onNameBlur: () => void;
  onDownload: () => void;
}) {
  const preparing = phase === 'preparing';
  const failed = phase === 'failed';
  const checks = [
    pages === 1 ? 'Fits on one A4 page' : `Clean page breaks across ${pages} A4 pages`,
    'Selectable text, so applicant tracking systems can read it',
    'Email and profile links are clickable',
    'Fonts embedded — looks the same on every device',
  ];

  return (
    <div className="fp-card">
      <div className="fp-card-head">
        <h2 className="fp-card-title">Download PDF</h2>
        <p className="fp-card-sub">
          A clean, text-based PDF — ready to send or upload to any job site.
        </p>
      </div>

      {unsaved && (
        <div className="alert is-warn" role="status">
          <ErrorIcon width={16} height={16} />
          <div className="alert-body">
            <p className="alert-title">Some edits aren’t in this PDF</p>
            <p className="alert-text">
              They aren’t saved yet, so the preview and the PDF show your last saved version.{' '}
              <Link to={editorPath} className="link">
                Back to editor
              </Link>
            </p>
          </div>
        </div>
      )}

      {failed && (
        <div className="alert" role="alert">
          <ErrorIcon width={16} height={16} />
          <div className="alert-body">
            <p className="alert-title">We couldn’t create your PDF</p>
            <p className="alert-text">
              {failureText(error)} {error && <span className="fp-ref">Ref. {error.code}</span>}
            </p>
          </div>
        </div>
      )}

      <div className="field">
        <label className="label" htmlFor="fp-name">
          File name
        </label>
        <div className="fp-name-wrap">
          <input
            id="fp-name"
            className="input"
            type="text"
            autoComplete="off"
            spellCheck={false}
            maxLength={PDF_FILE_NAME_MAX_LENGTH}
            value={fileName}
            aria-invalid={nameError}
            aria-describedby={nameError ? 'fp-name-error' : undefined}
            onChange={(event) => onName(event.target.value)}
            onBlur={onNameBlur}
          />
          <span className="fp-name-suffix" aria-hidden="true">
            .pdf
          </span>
        </div>
        {nameError && (
          <p id="fp-name-error" className="error">
            <ErrorIcon />
            <span>Add a file name to download your CV.</span>
          </p>
        )}
      </div>

      <ul className="fp-checks" aria-label="Checked before download">
        {checks.map((check) => (
          <li key={check} className="fp-check">
            <CheckCircleIcon />
            <span>{check}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        id="fp-download"
        className="btn btn-primary fp-dl"
        aria-busy={preparing}
        onClick={onDownload}
      >
        {preparing ? (
          <>
            <span className="spinner" aria-hidden="true" />
            <span>Preparing PDF…</span>
          </>
        ) : (
          <>
            <DownloadIcon />
            <span>{failed ? 'Try again' : 'Download PDF'}</span>
          </>
        )}
      </button>
      {preparing ? (
        <div className="fp-progress">
          <span className="gbar" aria-hidden="true">
            <span className="gbar-fill" style={{ width: STEP_PROGRESS[step] }} />
          </span>
          <span className="fp-step">{EXPORT_STEPS[step]}…</span>
        </div>
      ) : (
        <p className="fp-note">{fileName.trim() || 'CV'}.pdf</p>
      )}
    </div>
  );
}

/**
 * "Your PDF is ready": the file that was saved, and where to go next. On a phone it is a bottom
 * sheet over the page, so it behaves as a modal dialog: Tab stays inside, Escape closes it.
 */
function ReadyCard({
  pdf,
  narrow,
  again,
  editorPath,
  onAgain,
  onClose,
}: {
  pdf: MadePdf;
  narrow: boolean;
  again: boolean;
  editorPath: string;
  onAgain: (pdf: MadePdf) => void;
  onClose: () => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !narrow) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button, a[href]')].filter(
      (item) => item.getClientRects().length > 0,
    );
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return;
    const active = document.activeElement;
    const inside = items.some((item) => item === active);
    if (event.shiftKey && (active === first || !inside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !inside)) {
      event.preventDefault();
      first.focus();
    }
  };

  const meta = [
    pdf.pageCount && `${pdf.pageCount} ${pdf.pageCount === 1 ? 'page' : 'pages'}`,
    'A4',
    formatFileSize(pdf.blob.size),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      className="fp-card fp-ready"
      role={narrow ? 'dialog' : 'region'}
      aria-modal={narrow || undefined}
      aria-labelledby="fp-ready-title"
      onKeyDown={onKeyDown}
    >
      <span className="fp-grip" aria-hidden="true" />
      <button
        type="button"
        className="icon-btn fp-ready-close"
        aria-label="Close and change download settings"
        onClick={onClose}
      >
        <CloseIcon />
      </button>
      <span className="fp-ready-ico" aria-hidden="true">
        <CheckLargeIcon />
      </span>
      <div className="fp-card-head">
        <h2 id="fp-ready-title" ref={titleRef} className="fp-card-title" tabIndex={-1}>
          Your PDF is ready
        </h2>
        <p className="fp-card-sub">
          The download has started. You’ll find it in your Downloads folder.
        </p>
      </div>
      <div className="fp-file">
        <PdfFileIcon className="fp-file-ico" />
        <span className="fp-file-main">
          <span className="fp-file-name">{pdf.fileName}</span>
          <span className="fp-file-meta">{meta}</span>
        </span>
      </div>
      <ul className="fp-checks">
        <li className="fp-check">
          <CheckCircleIcon />
          <span>Text-based, so applicant tracking systems can read it</span>
        </li>
        <li className="fp-check">
          <CheckCircleIcon />
          <span>Links open in one click</span>
        </li>
      </ul>
      <div className="fp-ready-actions">
        <button type="button" className="btn btn-primary btn-lg" onClick={() => onAgain(pdf)}>
          {again ? (
            <>
              <CheckIcon size={14} />
              <span>Downloaded again</span>
            </>
          ) : (
            <>
              <DownloadIcon />
              <span>Download again</span>
            </>
          )}
        </button>
        <Link to={editorPath} className="btn btn-secondary btn-lg">
          Back to editor
        </Link>
      </div>
      <div className="fp-ready-links">
        <Link to="/" className="fp-link-btn">
          Go to My CVs
        </Link>
        <span className="fp-link-dot" aria-hidden="true" />
        <button type="button" className="fp-link-btn" onClick={onClose}>
          Change settings
        </button>
      </div>
    </div>
  );
}

/** Below 1024px: the file and the button stay in reach at the bottom of the screen. */
function MobileBar({
  fileName,
  meta,
  phase,
  onDownload,
}: {
  fileName: string;
  meta: string;
  phase: ExportPhase;
  onDownload: () => void;
}) {
  const preparing = phase === 'preparing';
  const failed = phase === 'failed';
  return (
    <div className="fp-mbar">
      {/* The full alert is in the card above; this repeats it next to the button. */}
      {failed && (
        <p className="fp-mbar-err" aria-hidden="true">
          <ErrorIcon width={16} height={16} />
          <span>
            <strong>We couldn’t create your PDF.</strong> Your CV is safe — try again.
          </span>
        </p>
      )}
      <div className="fp-mbar-in">
        <span className="fp-mbar-meta">
          <span className="fp-mbar-name">{fileName}</span>
          <span className="fp-mbar-sub">{meta}</span>
        </span>
        <button
          type="button"
          id="fp-download-m"
          className="btn btn-primary"
          aria-busy={preparing}
          onClick={onDownload}
        >
          {preparing ? (
            <>
              <span className="spinner" aria-hidden="true" />
              <span>Preparing…</span>
            </>
          ) : (
            <>
              <DownloadIcon />
              <span>{failed ? 'Try again' : 'Download PDF'}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
