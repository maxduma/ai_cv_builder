import type { CvSummary } from '@cv-builder/shared';
import { type CSSProperties, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { classes } from '../../../lib/classes';
import { formatRelativeTime } from '../../../lib/format';
import { CvMiniPage } from '../../../ui/CvMiniPage';
import { ArrowRightIcon } from '../../../ui/icons';
import { StatusChip } from '../../../ui/StatusChip';
import { CvCardMenu, moreButtonId } from './CvCardMenu';
import { RenameField } from './RenameField';

/** How long a renamed title stays lit. */
const FLASH_MS = 1_300;

interface Props {
  cv: CvSummary;
  index: number;
  now: number;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  /** The card is on its way out after a delete (its animation). */
  leaving: boolean;
  onAskDelete: () => void;
  /** The CV was renamed; for a screen reader's announcement. */
  onRenamed: (title: string) => void;
}

/**
 * One saved CV: a thumbnail of the page, its status, a ⋯ menu (rename, delete) and an "Open"
 * link that covers the card. Renaming happens in place; the page owns the rest of the state.
 */
export function CvCard({
  cv,
  index,
  now,
  menuOpen,
  onMenuOpenChange,
  leaving,
  onAskDelete,
  onRenamed,
}: Props) {
  const [renaming, setRenaming] = useState(false);
  const [flashing, setFlashing] = useState(false);

  useEffect(() => {
    if (!flashing) return;
    const handle = setTimeout(() => setFlashing(false), FLASH_MS);
    return () => clearTimeout(handle);
  }, [flashing]);

  function startRename() {
    onMenuOpenChange(false);
    setRenaming(true);
  }

  return (
    <li
      className={classes('cv-item cv-enter', menuOpen && 'is-open', leaving && 'cv-leave')}
      style={{ '--i': index } as CSSProperties}
    >
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

        <CvCardMenu
          cvId={cv.id}
          title={cv.title}
          open={menuOpen}
          onOpenChange={onMenuOpenChange}
          onRename={startRename}
          onDelete={onAskDelete}
        />

        <div className="cv-foot">
          <div className="cv-foot-text">
            {renaming ? (
              <RenameField
                cv={cv}
                onDone={({ renamedTo, focusBack }) => {
                  setRenaming(false);
                  if (renamedTo) {
                    setFlashing(true);
                    onRenamed(renamedTo);
                  }
                  if (focusBack) document.getElementById(moreButtonId(cv.id))?.focus();
                }}
              />
            ) : (
              <>
                <h2 className={classes('cv-title', flashing && 'cv-flash')}>{cv.title}</h2>
                <p className="cv-meta">
                  <time dateTime={cv.updatedAt}>
                    Updated {formatRelativeTime(cv.updatedAt, now)}
                  </time>
                </p>
              </>
            )}
          </div>
          <Link
            // A finished CV opens in the editor; the others on their status page or form.
            to={cv.status === 'ready' ? `/cvs/${cv.id}/editor` : `/cvs/${cv.id}`}
            className="cv-open"
            aria-label={`Open ${cv.title}`}
          >
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
