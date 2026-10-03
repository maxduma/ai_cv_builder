import type { CvContent } from '@cv-builder/shared';
import { Link } from 'react-router';
import { CvPage } from '../../ui/CvPage';
import { CheckCircleIcon, ExternalArrowIcon } from '../../ui/icons';
import { estimatePages, pageLabel } from './estimate-pages';
import './cv-preview.css';

/** A triangle with an exclamation mark: the CV runs past one page. */
function WarningIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 2.5L14 13H2L8 2.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M8 6.5V9.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="8" cy="11.2" r="0.85" fill="currentColor" />
    </svg>
  );
}

/**
 * The editor's live preview: the CV page beside the form, scaled to the column, redrawn from
 * `content` on every edit (unsaved ones included). Empty sections show a hint so the page mirrors
 * the form. Under it, a note says whether the CV still fits on one page, from the same estimate
 * as the page count in the header. The fit note isn't a live region: it would speak on every
 * keystroke. Hidden below 1024px, where there is no room beside the form.
 */
export function CvPreview({ cvId, content }: { cvId: string; content: CvContent }) {
  const { pages, fill } = estimatePages(content);
  const fits = pages === 1;

  return (
    <aside className="ed-preview" aria-label="Live preview">
      <div className="pv-head">
        <h2 className="pv-title">Live preview</h2>
        <span className="pv-meta">{pageLabel(pages)}</span>
        <Link to={`/cvs/${cvId}/preview`} className="pv-full">
          <span>Full preview</span>
          <ExternalArrowIcon />
        </Link>
      </div>
      <div className="pv-stage">
        <div className="pv-frame">
          <div className="pv-zoom">
            <CvPage content={content} placeholders />
          </div>
        </div>
      </div>
      <p className={fits ? 'pv-fit is-ok' : 'pv-fit is-warn'}>
        {fits ? <CheckCircleIcon /> : <WarningIcon />}
        <span>
          {fits
            ? `Fits on one page · ${Math.round(fill * 100)}% full`
            : 'Runs onto a second page — trim a few lines to keep it to one'}
        </span>
      </p>
    </aside>
  );
}
