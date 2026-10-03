import { CV_LIMITS } from '@cv-builder/shared';
import { useState } from 'react';
import { classes } from '../../../lib/classes';
import type { SectionProps } from './section-props';
import { SectionCard, startsNarrow } from './SectionCard';

/** The design's advice: a summary reads best at 40–70 words. */
const WORDS_MIN = 40;
const WORDS_MAX = 70;

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * The professional summary, with a word count that turns green inside the advised 40–70 words
 * and amber above it. Folded on phones; the header says "Empty" until there is some text.
 */
export function SummarySection({ draft, session }: SectionProps) {
  const [open, setOpen] = useState(() => !startsNarrow());
  const words = countWords(draft.summary);

  return (
    <SectionCard
      section="summary"
      title="Summary"
      count={draft.summary.trim() ? '' : 'Empty'}
      open={open}
      onToggle={() => setOpen((current) => !current)}
    >
      <div className="field">
        <label className="sr-only" htmlFor="sum-text">
          Professional summary
        </label>
        <textarea
          id="sum-text"
          className="textarea"
          rows={5}
          placeholder="Two or three sentences: who you are, your strongest result, what you’re looking for."
          maxLength={CV_LIMITS.summary}
          value={draft.summary}
          // The count is read out with the field, so the advice isn't only visual.
          aria-describedby="sum-words"
          onChange={(event) => {
            const summary = event.target.value;
            session.edit((cv) => ({ ...cv, summary }));
          }}
        />
      </div>
      <div className="sum-foot">
        <span
          id="sum-words"
          className={classes(
            'words',
            words >= WORDS_MIN && words <= WORDS_MAX && 'is-ok',
            words > WORDS_MAX && 'is-warn',
          )}
        >
          {words} {words === 1 ? 'word' : 'words'} · aim for {WORDS_MIN}–{WORDS_MAX}
        </span>
      </div>
    </SectionCard>
  );
}
