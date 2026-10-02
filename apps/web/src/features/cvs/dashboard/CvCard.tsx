import type { CvSummary } from '@cv-builder/shared';
import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { formatRelativeTime } from '../../../lib/format';
import { CvMiniPage } from '../../../ui/CvMiniPage';
import { ArrowRightIcon } from '../../../ui/icons';
import { StatusChip } from '../../../ui/StatusChip';

/** One saved CV: a thumbnail of the page, its status, and an "Open" link that covers the card. */
export function CvCard({ cv, index, now }: { cv: CvSummary; index: number; now: number }) {
  return (
    <li className="cv-item cv-enter" style={{ '--i': index } as CSSProperties}>
      <article className="cv-card">
        <div className="cv-preview">
          <StatusChip status={cv.status} className="cv-chip" />
          <div className="cv-page" aria-hidden="true">
            <CvMiniPage
              variant={cv.status === 'ready' ? 'classic' : 'draft'}
              role={cv.targetRole}
            />
          </div>
        </div>

        <div className="cv-foot">
          <div className="cv-foot-text">
            <h2 className="cv-title">{cv.title}</h2>
            <p className="cv-meta">
              <time dateTime={cv.updatedAt}>Updated {formatRelativeTime(cv.updatedAt, now)}</time>
            </p>
          </div>
          <Link to={`/cvs/${cv.id}`} className="cv-open" aria-label={`Open ${cv.title}`}>
            <span>Open</span>
            <ArrowRightIcon className="cv-arrow" />
          </Link>
        </div>
      </article>
    </li>
  );
}

/** Placeholder card shown in the real grid while the list loads. */
export function CvCardSkeleton({ delayMs }: { delayMs: number }) {
  const delay = { animationDelay: `${delayMs}ms` };

  return (
    <li className="cv-item">
      <div className="sk-card" aria-hidden="true">
        <div className="sk-preview">
          <span className="sk sk-chip" style={delay} />
          <span className="sk sk-page" style={delay} />
        </div>
        <div className="cv-foot">
          <div className="cv-foot-text" style={{ gap: 9 }}>
            <span className="sk sk-line" style={{ ...delay, width: '56%', height: 12 }} />
            <span
              className="sk sk-line"
              style={{ ...delay, width: '34%', height: 10, borderRadius: 5 }}
            />
          </div>
          <span
            className="sk sk-line"
            style={{ ...delay, width: 76, height: 32, flexShrink: 0, borderRadius: 9 }}
          />
        </div>
      </div>
    </li>
  );
}
