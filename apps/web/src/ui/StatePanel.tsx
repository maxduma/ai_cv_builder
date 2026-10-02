import { type ReactNode, useId } from 'react';
import './state-panel.css';

interface StatePanelProps {
  /** `error` tints the panel red, as in the design's "couldn't load" state. */
  tone?: 'default' | 'error';
  /** An illustration or a `StateIcon`. */
  visual: ReactNode;
  title: string;
  /** Pages whose only content is this panel use `h1`; panels inside a page use `h2`. */
  headingLevel?: 'h1' | 'h2';
  description: ReactNode;
  /** The single next step: one primary button or link. */
  action?: ReactNode;
  note?: ReactNode;
}

/** The design's empty / error panel: it takes the place of the content it stands in for. */
export function StatePanel({
  tone = 'default',
  visual,
  title,
  headingLevel: Heading = 'h2',
  description,
  action,
  note,
}: StatePanelProps) {
  const titleId = useId();
  const descriptionId = useId();

  return (
    <section
      className={`empty-panel cvb-rise${tone === 'error' ? ' is-error' : ''}`}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      {visual}
      <Heading id={titleId} className="em-title">
        {title}
      </Heading>
      <p id={descriptionId} className="em-text">
        {description}
      </p>
      {action}
      {note && <p className="state-ref">{note}</p>}
    </section>
  );
}

/** The rounded icon tile used instead of an illustration for errors and missing pages. */
export function StateIcon({ tone, children }: { tone: 'error' | 'neutral'; children: ReactNode }) {
  return (
    <span className={`state-ico is-${tone}`} aria-hidden="true">
      {children}
    </span>
  );
}
