import { SOURCE_TEXT_MAX_LENGTH, TARGET_ROLE_MAX_LENGTH } from '@cv-builder/shared';
import { type CSSProperties, type KeyboardEvent, type RefObject, useRef } from 'react';
import { formatFileSize } from '../../../lib/format';
import {
  BriefcaseIcon,
  CheckIcon,
  CloseIcon,
  ErrorIcon,
  PdfFileIcon,
  SmallPlusIcon,
  UploadIcon,
} from '../../../ui/icons';
import type { CvDraft, PdfState, StarterLine } from './useCvDraft';

/** The counter turns to a warning once the text is within a tenth of the limit. */
const TEXT_WARN_AT = Math.floor(SOURCE_TEXT_MAX_LENGTH * 0.9);

function classes(...names: (string | false | null | undefined)[]) {
  return names.filter(Boolean).join(' ');
}

function StepNumber({ number, done }: { number: number; done: boolean }) {
  return (
    <span className={classes('step-num', done && 'is-done')} aria-hidden="true">
      {done ? <CheckIcon size={14} /> : number}
    </span>
  );
}

function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} className="error">
      <ErrorIcon />
      <span>{message}</span>
    </p>
  );
}

const rise = (delayMs: number): CSSProperties => ({ animationDelay: `${delayMs}ms` });

export function TargetRoleStep({
  draft,
  suggestions,
  inputRef,
  onEnter,
}: {
  draft: CvDraft;
  suggestions: string[];
  inputRef: RefObject<HTMLInputElement | null>;
  /** Enter moves on to the sources instead of submitting the form. */
  onEnter: () => void;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    onEnter();
  }

  return (
    <section className="step-card cvb-rise" aria-labelledby="step1-title" style={rise(60)}>
      <div className="step-head">
        <StepNumber number={1} done={draft.roleOk} />
        <div className="step-titles">
          <h2 id="step1-title" className="step-title">
            Target role
          </h2>
          <p className="step-desc">
            The job you’re applying for. We tailor the wording, skills and the order of your
            experience to it.
          </p>
        </div>
        <span className="step-tag">Required</span>
      </div>
      <div className="step-body">
        <div className="field">
          <label htmlFor="create-role" className="sr-only">
            Target role
          </label>
          <div className="control">
            <BriefcaseIcon className="input-ico" />
            <input
              ref={inputRef}
              id="create-role"
              className="input has-ico has-clear"
              type="text"
              autoComplete="off"
              enterKeyHint="next"
              maxLength={TARGET_ROLE_MAX_LENGTH}
              placeholder="e.g. Senior Backend Engineer"
              value={draft.role}
              aria-invalid={!!draft.roleError}
              aria-describedby={draft.roleError ? 'create-role-error' : undefined}
              onChange={(event) => draft.setRole(event.target.value)}
              onKeyDown={onKeyDown}
            />
            {draft.role.length > 0 && (
              <button
                type="button"
                className="icon-btn"
                aria-label="Clear target role"
                onClick={() => {
                  draft.setRole('');
                  inputRef.current?.focus();
                }}
              >
                <CloseIcon />
              </button>
            )}
          </div>
          {draft.roleError && <FieldError id="create-role-error" message={draft.roleError} />}
        </div>

        {suggestions.length > 0 && (
          <div className="suggest" role="group" aria-label="Suggested roles">
            <span className="suggest-label">From your CVs</span>
            {suggestions.map((suggestion) => {
              const selected = draft.roleValue.toLowerCase() === suggestion.toLowerCase();
              return (
                <button
                  key={suggestion}
                  type="button"
                  className="s-chip"
                  title={suggestion}
                  aria-pressed={selected}
                  onClick={() => draft.setRole(suggestion)}
                >
                  {selected && <CheckIcon />}
                  <span>{suggestion}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

export function SourcePdfStep({
  draft,
  dragging,
  dropRef,
}: {
  draft: CvDraft;
  dragging: boolean;
  dropRef: RefObject<HTMLButtonElement | null>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chooseFile = () => fileInputRef.current?.click();
  const { pdf, pdfError, sourceError } = draft;

  return (
    <section className="step-card cvb-rise" aria-labelledby="step2-title" style={rise(120)}>
      <div className="step-head">
        <StepNumber number={2} done={draft.pdfOk} />
        <div className="step-titles">
          <h2 id="step2-title" className="step-title">
            Upload your current CV
          </h2>
          <p className="step-desc">
            Have a CV already? We’ll pull your roles, dates and skills from it.
          </p>
        </div>
      </div>
      <div className="step-body">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Reset, so choosing the same file again still triggers a change.
            event.target.value = '';
            if (file) void draft.choosePdf(file);
          }}
        />

        {!pdf && (
          <button
            ref={dropRef}
            type="button"
            id="create-pdf"
            className={classes(
              'drop',
              // While a file is dragged over the page, the drop zone shows only that.
              dragging && 'is-drag',
              !dragging && pdfError && 'is-error',
              !dragging && !pdfError && sourceError && 'is-warn',
            )}
            aria-describedby={pdfError ? 'create-pdf-error create-pdf-meta' : 'create-pdf-meta'}
            onClick={chooseFile}
          >
            <span className="drop-ico" aria-hidden="true">
              <UploadIcon />
            </span>
            {dragging ? (
              <span className="drop-title">Drop your PDF to upload</span>
            ) : (
              <span className="drop-title">
                <span className="for-pointer">
                  Drag your CV here or <span className="drop-u">choose a file</span>
                </span>
                <span className="for-touch">Tap to choose your CV</span>
              </span>
            )}
            <span id="create-pdf-meta" className="drop-meta">
              PDF only · up to 10 MB
            </span>
          </button>
        )}

        {pdf && (
          <FileCard
            pdf={pdf}
            removing={draft.removing}
            onReplace={chooseFile}
            onRemove={() => void draft.removePdf()}
          />
        )}

        {pdfError && <FieldError id="create-pdf-error" message={pdfError} />}
      </div>
    </section>
  );
}

function FileCard({
  pdf,
  removing,
  onReplace,
  onRemove,
}: {
  pdf: PdfState;
  removing: boolean;
  onReplace: () => void;
  onRemove: () => void;
}) {
  const name = pdf.phase === 'ready' ? pdf.document.originalName : pdf.name;
  const busy = pdf.phase !== 'ready';
  const progress = pdf.phase === 'uploading' ? pdf.progress : 100;

  let meta = '';
  if (pdf.phase === 'ready') {
    const { pageCount, sizeBytes } = pdf.document;
    const pages = pageCount ? `${pageCount} ${pageCount === 1 ? 'page' : 'pages'} · ` : '';
    meta = `${pages}${formatFileSize(sizeBytes)}`;
  }

  return (
    <div className="file" role="group" aria-label={`Uploaded file ${name}`}>
      <PdfFileIcon className="file-ico" />
      <div className="file-main">
        <span className="file-name">{name}</span>
        {busy ? (
          <>
            <span
              className="file-bar"
              role="progressbar"
              aria-label="Upload progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
            >
              <span className="file-fill" style={{ width: `${progress}%` }} />
            </span>
            <span className="file-meta">
              {pdf.phase === 'uploading' ? `Uploading… ${progress}%` : 'Reading your CV…'}
            </span>
          </>
        ) : (
          <span className="file-meta">
            <span className="file-ok">
              <CheckIcon />
              <span className="file-ok-label">Uploaded</span>
            </span>
            <span className="file-sep" aria-hidden="true">
              ·
            </span>
            <span>{meta}</span>
          </span>
        )}
      </div>
      <div className="file-actions">
        {!busy && (
          <button type="button" className="ghost-btn" onClick={onReplace} disabled={removing}>
            Replace
          </button>
        )}
        <button
          type="button"
          className="ghost-btn is-icon"
          aria-label={busy ? 'Cancel upload' : `Remove ${name}`}
          aria-busy={removing}
          disabled={removing}
          onClick={onRemove}
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}

const STARTERS: { kind: StarterLine; label: string }[] = [
  { kind: 'role', label: 'Role' },
  { kind: 'win', label: 'Achievement' },
  { kind: 'skills', label: 'Skills' },
];

export function SourceTextStep({
  draft,
  textRef,
}: {
  draft: CvDraft;
  textRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const { text, sourceError } = draft;

  return (
    <section className="step-card cvb-rise" aria-labelledby="step3-title" style={rise(180)}>
      <div className="step-head">
        <StepNumber number={3} done={draft.textOk} />
        <div className="step-titles">
          <h2 id="step3-title" className="step-title">
            Describe your experience
          </h2>
          <p className="step-desc">
            {draft.pdfOk
              ? 'Anything your CV is missing? Add recent projects, results or tools.'
              : 'No CV yet, or something to add? Write it in your own words — bullet points are fine.'}
          </p>
        </div>
      </div>
      <div className="step-body">
        <div className="field">
          <label htmlFor="create-exp" className="sr-only">
            Your experience
          </label>
          <textarea
            ref={textRef}
            id="create-exp"
            className="textarea"
            maxLength={SOURCE_TEXT_MAX_LENGTH}
            placeholder="e.g. 6 years building payment APIs in Go. Led a team of 4, moved billing to microservices and cut latency by 40%. Skills: Go, PostgreSQL, Kafka, AWS."
            value={text}
            aria-invalid={!!sourceError}
            aria-describedby={
              sourceError ? 'create-exp-error create-exp-count' : 'create-exp-count'
            }
            onChange={(event) => draft.setText(event.target.value.slice(0, SOURCE_TEXT_MAX_LENGTH))}
          />
          {sourceError && <FieldError id="create-exp-error" message={sourceError} />}
        </div>
        <div className="ta-foot">
          <div className="ta-prompts" role="group" aria-label="Add a starter line">
            {STARTERS.map(({ kind, label }) => (
              <button
                key={kind}
                type="button"
                className="ta-chip"
                onClick={() => draft.addStarterLine(kind)}
              >
                <SmallPlusIcon />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <span
            id="create-exp-count"
            className={classes('ta-count', text.length > TEXT_WARN_AT && 'is-warn')}
          >
            {text.length.toLocaleString('en-US')} / {SOURCE_TEXT_MAX_LENGTH.toLocaleString('en-US')}
          </span>
        </div>
      </div>
    </section>
  );
}
