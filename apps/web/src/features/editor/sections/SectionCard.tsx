import type { ComponentProps, ReactNode } from 'react';
import { classes } from '../../../lib/classes';
import { ChevronDownIcon, ErrorIcon, LockIcon } from '../../../ui/icons';
import './sections.css';

export type SectionKey = 'contact' | 'summary' | 'experience' | 'education' | 'skills';

/** "1 role", "3 roles", "0 roles". */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The start of a long text, for an undo label: "Cut checkout time by 40% by moving…". */
export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** `list` with `item` put in at `index`, or at the end when the list has become shorter. */
export function insertAt<T>(list: readonly T[], index: number, item: T): T[] {
  const at = Math.max(0, Math.min(index, list.length));
  return [...list.slice(0, at), item, ...list.slice(at)];
}

/**
 * Phones start with only Experience open (the design's `edNarrow`). Read once, when a section
 * mounts, so turning the phone or resizing the window never folds a section someone is using.
 */
export function startsNarrow(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 599px)').matches;
}

/**
 * Focuses an element of the editor by id and puts the caret at the end of its text, as the
 * design does: after Backspace joins a bullet into the one above, typing carries on where it ended.
 * Call it after the change that renders the element has been flushed (see `flushSync`).
 */
export function focusField(id: string) {
  const element = document.getElementById(id);
  if (!element) return;
  element.focus();
  // `selectionStart` is null where the caret can't be placed (email inputs, buttons).
  if (
    (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) &&
    element.selectionStart !== null
  ) {
    const end = element.value.length;
    element.setSelectionRange(end, end);
  }
}

/**
 * The card around each section of the editor: a header button that folds the section away (its
 * count tells what is inside while it's folded), and the section's fields under it.
 *
 * The slot before the title is the design's drag handle. Sections can't be reordered, so it
 * holds the padlock on Contact ("stays at the top") and stays blank on the others, which keeps
 * every title in line with the fields below it.
 */
export function SectionCard({
  section,
  title,
  count,
  open,
  onToggle,
  locked = false,
  children,
}: {
  section: SectionKey;
  title: string;
  /** "3 roles", "Empty"; an empty string shows nothing. */
  count: string;
  open: boolean;
  onToggle: () => void;
  /** Contact: always first on the CV. */
  locked?: boolean;
  children: ReactNode;
}) {
  const bodyId = `sec-${section}-body`;
  return (
    <section id={`sec-${section}`} className="ed-card" aria-labelledby={`sec-${section}-title`}>
      <div className="ed-head">
        {locked ? (
          <span
            className="grip is-lock"
            title="Contact details stay at the top of your CV"
            aria-hidden="true"
          >
            <LockIcon />
          </span>
        ) : (
          <span className="grip" aria-hidden="true" />
        )}
        <button
          type="button"
          id={`sec-${section}-toggle`}
          className="ed-toggle"
          aria-expanded={open}
          // Only while the body exists: a reference to a missing id is an error for screen readers.
          aria-controls={open ? bodyId : undefined}
          onClick={onToggle}
        >
          <span className="ed-title" id={`sec-${section}-title`}>
            {title}
          </span>
          <span className="ed-count">{count}</span>
          <ChevronDownIcon className="ed-chev" />
        </button>
      </div>
      {open && (
        <div className="ed-body" id={bodyId}>
          {children}
        </div>
      )}
    </section>
  );
}

type TextFieldProps = Omit<ComponentProps<'input'>, 'id' | 'className'> & {
  id: string;
  label: string;
  /** Adds the grey "optional" after the label. */
  optional?: boolean;
  /** Extra classes for the field, e.g. `span2` to take a whole row of the grid. */
  className?: string;
  error?: string;
};

/** A labelled input of the editor, with its error underneath, linked for screen readers. */
export function TextField({
  id,
  label,
  optional = false,
  className,
  error,
  ...input
}: TextFieldProps) {
  const errorId = `${id}-error`;
  return (
    <div className={classes('field', className)}>
      <label className="label" htmlFor={id}>
        {label}
        {optional && (
          <>
            {' '}
            <span className="label-opt">optional</span>
          </>
        )}
      </label>
      <input
        type="text"
        {...input}
        id={id}
        className="input"
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
      />
      {error && (
        <p id={errorId} className="error">
          <ErrorIcon />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
