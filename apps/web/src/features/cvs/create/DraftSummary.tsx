import { CheckIcon, ClockIcon, ErrorIcon, SparkleIcon } from '../../../ui/icons';
import '../../../ui/cv-mini-page.css';
import type { CvDraft } from './useCvDraft';

function classes(...names: (string | false | null | undefined)[]) {
  return names.filter(Boolean).join(' ');
}

function GenerateButton({
  draft,
  id,
  className,
}: {
  draft: CvDraft;
  id: string;
  className: string;
}) {
  const busy = draft.submitState !== 'idle';
  return (
    <button
      type="button"
      id={id}
      className={classes('btn btn-primary', className, busy && 'is-loading')}
      aria-busy={busy}
      onClick={() => void draft.generate()}
    >
      {busy ? (
        <>
          <span className="spinner" aria-hidden="true" />
          <span>{draft.submitState === 'queued' ? 'Starting after upload…' : 'Starting…'}</span>
        </>
      ) : (
        <>
          <SparkleIcon />
          <span>Generate CV</span>
        </>
      )}
    </button>
  );
}

function SubmitError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="error submit-error" role="alert">
      <ErrorIcon />
      <span>{message}</span>
    </p>
  );
}

/** The thumbnail fills in as the role and the sources are added. */
function DraftPreview({ draft }: { draft: CvDraft }) {
  const both = draft.pdfOk && draft.textOk;
  return (
    <div className="pv">
      <span className="pv-name" style={{ width: '48%' }} />
      {draft.roleOk ? (
        <p className="pv-role pv-new">{draft.roleValue}</p>
      ) : (
        <span className="b b-ghost pv-role-ghost" style={{ width: '52%' }} />
      )}
      <div className="pv-contact">
        <span className="b b-ct" style={{ width: '26%' }} />
        <span className="b b-ct" style={{ width: '20%' }} />
        <span className="b b-ct" style={{ width: '24%' }} />
      </div>
      <span className="pv-rule" />
      <p className="pv-h">Experience</p>
      {draft.sourceOk ? (
        <div className="pv-new">
          <div className="pv-row">
            <span className="b b-dk" style={{ width: '46%' }} />
            <span className="b b-dt" style={{ width: '15%' }} />
          </div>
          <div className="pv-lines">
            <span className="b" style={{ width: '96%' }} />
            <span className="b" style={{ width: '88%' }} />
            <span className="b" style={{ width: '92%' }} />
          </div>
          <div className="pv-row" style={{ marginTop: 9 }}>
            <span className="b b-dk" style={{ width: '40%' }} />
            <span className="b b-dt" style={{ width: '15%' }} />
          </div>
          <div className="pv-lines">
            <span className="b" style={{ width: '94%' }} />
            <span className="b" style={{ width: '78%' }} />
          </div>
        </div>
      ) : (
        <div className="pv-todo">
          <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
            <path
              d="M5 1.5V8.5M1.5 5H8.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </div>
      )}
      {both && (
        <div className="pv-new" style={{ marginTop: 9 }}>
          <div className="pv-row">
            <span className="b b-dk" style={{ width: '36%' }} />
            <span className="b b-dt" style={{ width: '15%' }} />
          </div>
          <div className="pv-lines">
            <span className="b" style={{ width: '90%' }} />
          </div>
        </div>
      )}
      <p className="pv-h" style={{ marginTop: 11 }}>
        Skills
      </p>
      {draft.sourceOk ? (
        <div className="pv-chips pv-new">
          {[22, 28, 18, 30].map((width) => (
            <span key={width} className="pv-chip" style={{ width }} />
          ))}
        </div>
      ) : (
        <div className="pv-chips">
          {[22, 28, 18].map((width) => (
            <span key={width} className="pv-chip pv-chip-empty" style={{ width }} />
          ))}
        </div>
      )}
    </div>
  );
}

function sourceSummary(draft: CvDraft): string {
  if (draft.pdfBusy) return 'Uploading your CV…';
  if (draft.pdfOk && draft.textOk) return 'Your CV and your notes';
  if (draft.pdfOk) return 'From your CV';
  if (draft.textOk) return 'From your notes';
  return 'Upload a CV or write a few lines';
}

function SummaryDot({ done }: { done: boolean }) {
  return (
    <span className={classes('sum-dot', done && 'is-done')} aria-hidden="true">
      <CheckIcon />
    </span>
  );
}

/** The sticky "Your draft" panel next to the form (wide screens). */
export function DraftSummary({ draft }: { draft: CvDraft }) {
  return (
    <aside
      className="create-aside cvb-rise"
      aria-label="Your draft"
      style={{ animationDelay: '140ms' }}
    >
      <div className="sum-card">
        <div className="sum-head">
          <h2 className="sum-title">Your draft</h2>
          <span className="sum-tag">
            <span className="sum-live" aria-hidden="true" />
            Live preview
          </span>
        </div>
        <div className="sum-stage" aria-hidden="true">
          <div className="sum-page">
            <DraftPreview draft={draft} />
          </div>
        </div>
        <ul className="sum-list">
          <li className="sum-item">
            <SummaryDot done={draft.roleOk} />
            <span className="sum-text">
              <span className="sum-label">Target role</span>
              <span className="sum-detail">{draft.roleOk ? draft.roleValue : 'Not added yet'}</span>
            </span>
          </li>
          <li className="sum-item">
            <SummaryDot done={draft.sourceOk && !draft.pdfBusy} />
            <span className="sum-text">
              <span className="sum-label">Experience</span>
              <span className="sum-detail">{sourceSummary(draft)}</span>
            </span>
          </li>
        </ul>
        <GenerateButton draft={draft} id="create-generate" className="btn-lg btn-block" />
        <SubmitError message={draft.submitError} />
        <p className="sum-note">
          <ClockIcon />
          <span>
            Takes about a minute. You can leave while it works — the draft is saved to My CVs.
          </span>
        </p>
      </div>
    </aside>
  );
}

/** Below 1024px the panel gives way to a bar fixed to the bottom of the screen. */
export function MobileActionBar({ draft }: { draft: CvDraft }) {
  const sourceDone = draft.sourceOk && !draft.pdfBusy;
  let status = 'Ready · takes about a minute';
  if (!draft.roleOk) status = 'Add your target role to start';
  else if (draft.pdfBusy) status = 'Uploading your CV…';
  else if (!draft.sourceOk) status = 'Add a CV or describe your experience';

  return (
    <div className="m-bar">
      <div className="m-bar-in">
        <div className="m-status">
          <span className="m-prog" aria-hidden="true">
            <span className={classes('m-seg', draft.roleOk && 'is-on')} />
            <span className={classes('m-seg', sourceDone && 'is-on')} />
          </span>
          <span className="m-status-text">{status}</span>
        </div>
        <SubmitError message={draft.submitError} />
        <GenerateButton draft={draft} id="create-generate-m" className="btn-lg m-gen" />
      </div>
    </div>
  );
}
