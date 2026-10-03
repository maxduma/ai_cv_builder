import type { CvContent } from '@cv-builder/shared';
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  MoreIcon,
  PlusIcon,
  TrashIcon,
} from '../../../ui/icons';
import type { EditorSession, Undo } from '../editor-session';
import { SectionCard, classes, focusField, insertAt, startsNarrow } from './SectionCard';

/** What Experience and Education tell the shared list about their entries. */
export interface EntryKind<T extends { id: string }> {
  section: 'experience' | 'education';
  heading: string;
  /** "3 roles". */
  count: (total: number) => string;
  limit: number;
  /** Id of the add button: focus lands on it when the last entry is deleted. */
  addId: string;
  addLabel: string;
  /** Announced when an entry is added, e.g. "Added a new role." */
  added: string;
  /** Shown in the header of an entry with nothing in it yet, e.g. "New role". */
  untitled: string;
  list: (cv: CvContent) => T[];
  withList: (cv: CvContent, list: T[]) => CvContent;
  /** A blank entry. Called from an event handler: it makes new ids. */
  create: () => T;
  /** The entry header's two lines; empty strings fall back to `untitled` and a prompt. */
  head: (entry: T) => { title: string; meta: string };
  /** What the "Deleted “…”" toast calls the entry. */
  undoLabel: (entry: T) => string;
  /** Nothing typed in yet: deleting it needs no Undo. */
  isBlank: (entry: T) => boolean;
}

/** Changes one entry of a list, leaving the CV as it was if the entry is gone. */
export function editEntry<T extends { id: string }>(
  session: EditorSession,
  kind: EntryKind<T>,
  id: string,
  recipe: (entry: T) => T,
  undo?: Omit<Undo, 'id'>,
) {
  session.edit((cv) => {
    const list = kind.list(cv);
    if (!list.some((entry) => entry.id === id)) return cv;
    return kind.withList(
      cv,
      list.map((entry) => (entry.id === id ? recipe(entry) : entry)),
    );
  }, undo);
}

/** Joins the parts that aren’t blank: "Mar 2021 – Present · Lisbon". */
export function joinParts(parts: string[], separator: string): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(separator);
}

const toggleId = (id: string) => `it-${id}-toggle`;
const moreId = (id: string) => `it-${id}-more`;

/**
 * A section made of entries, Experience or Education: each entry folds into a header that sums it
 * up ("Backend Engineer · Northpay", "Mar 2021 – Present · Lisbon"), and its ⋯ menu moves it up or
 * down or deletes it. Deleting an entry with something in it offers Undo; a blank one just goes.
 *
 * The section starts open with only its first entry open; on phones only Experience does
 * (`opensOnPhones`), the way the design starts. Which entries are open is kept here, outside the
 * folded body, so folding the section and opening it again finds them as they were.
 */
export function EntrySection<T extends { id: string }>({
  kind,
  draft,
  session,
  opensOnPhones,
  renderFields,
}: {
  kind: EntryKind<T>;
  draft: CvContent;
  session: EditorSession;
  opensOnPhones: boolean;
  /** The fields of an open entry; `name` is its header title, for labels. */
  renderFields: (entry: T, name: string) => ReactNode;
}) {
  const entries = kind.list(draft);
  const [open, setOpen] = useState(() => opensOnPhones || !startsNarrow());
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => {
    const first = entries[0];
    return new Set(open && first ? [first.id] : []);
  });
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const full = entries.length >= kind.limit;

  function toggleEntry(id: string) {
    setOpenIds((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function add() {
    const entry = kind.create();
    flushSync(() => {
      setOpenIds((current) => new Set(current).add(entry.id));
      session.edit((cv) => kind.withList(cv, [...kind.list(cv), entry]));
    });
    session.announce(kind.added);
    focusField(`f-${entry.id}-title`);
  }

  function move(id: string, step: -1 | 1) {
    flushSync(() => {
      setMenuFor(null);
      session.edit((cv) => {
        const list = kind.list(cv);
        const from = list.findIndex((entry) => entry.id === id);
        const entry = list[from];
        const to = from + step;
        if (!entry || to < 0 || to >= list.length) return cv;
        return kind.withList(
          cv,
          insertAt(
            list.filter((other) => other.id !== id),
            to,
            entry,
          ),
        );
      });
    });
    session.announce(step < 0 ? 'Moved up.' : 'Moved down.');
    // Moving the entry re-inserts its nodes, which drops focus: back to its ⋯ button.
    focusField(moreId(id));
  }

  function remove(entry: T, index: number) {
    const neighbour = entries[index + 1] ?? entries[index - 1];
    const blank = kind.isBlank(entry);
    flushSync(() => {
      setMenuFor(null);
      session.edit(
        (cv) =>
          kind.withList(
            cv,
            kind.list(cv).filter((other) => other.id !== entry.id),
          ),
        blank
          ? undefined
          : {
              label: kind.undoLabel(entry),
              restore: (cv) => {
                const list = kind.list(cv);
                if (list.some((other) => other.id === entry.id)) return cv;
                return kind.withList(cv, insertAt(list, index, entry));
              },
            },
      );
    });
    // With Undo, the page's toast says what happened.
    if (blank) session.announce('Removed.');
    focusField(neighbour ? toggleId(neighbour.id) : kind.addId);
  }

  return (
    <SectionCard
      section={kind.section}
      title={kind.heading}
      count={kind.count(entries.length)}
      open={open}
      onToggle={() => setOpen((current) => !current)}
    >
      {entries.length > 0 && (
        <div className="items">
          {entries.map((entry, index) => {
            const head = kind.head(entry);
            const name = head.title || kind.untitled;
            const expanded = openIds.has(entry.id);
            const bodyId = `it-${entry.id}-body`;
            return (
              <div key={entry.id} className={classes('it', expanded && 'is-open')}>
                <div className="it-head">
                  {/* The design's reorder handle; reordering is in the ⋯ menu instead. */}
                  <span className="grip" aria-hidden="true" />
                  <button
                    type="button"
                    id={toggleId(entry.id)}
                    className="it-toggle"
                    aria-expanded={expanded}
                    aria-controls={expanded ? bodyId : undefined}
                    onClick={() => toggleEntry(entry.id)}
                  >
                    <span className="it-titles">
                      <span className={classes('it-title', !head.title && 'is-empty')}>{name}</span>
                      <span className="it-meta">{head.meta || 'Add the details below'}</span>
                    </span>
                    <ChevronDownIcon className="ed-chev" />
                  </button>
                  <MoreMenu
                    id={entry.id}
                    name={name}
                    open={menuFor === entry.id}
                    onOpenChange={(next) => setMenuFor(next ? entry.id : null)}
                    first={index === 0}
                    last={index === entries.length - 1}
                    onMove={(step) => move(entry.id, step)}
                    onDelete={() => remove(entry, index)}
                  />
                </div>
                {expanded && (
                  <div className="it-body" id={bodyId}>
                    {renderFields(entry, name)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <button type="button" id={kind.addId} className="add-entry" disabled={full} onClick={add}>
        <PlusIcon size={14} />
        <span>{kind.addLabel}</span>
      </button>
    </SectionCard>
  );
}

/**
 * An entry's ⋯ menu: Move up, Move down, Delete. Like the account menu it is a disclosure (plain
 * buttons that follow the ⋯ button), not an ARIA menu. Escape closes it and returns focus to ⋯;
 * a transparent backdrop closes it on a click anywhere else.
 */
function MoreMenu({
  id,
  name,
  open,
  onOpenChange,
  first,
  last,
  onMove,
  onDelete,
}: {
  id: string;
  /** The entry's header title, e.g. "Backend Engineer · Northpay". */
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  first: boolean;
  last: boolean;
  onMove: (step: -1 | 1) => void;
  onDelete: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = `it-${id}-menu`;
  const close = useEffectEvent(() => onOpenChange(false));

  // On the document, not the menu: a click on the menu's edge leaves focus on the page body
  // (Safari and Firefox on macOS don't focus clicked buttons), and Escape should still work.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
      // Back to ⋯, unless the person has already put focus somewhere else on the page.
      const active = document.activeElement;
      if (!active || active === document.body || wrapRef.current?.contains(active)) {
        buttonRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <>
      <div ref={wrapRef} className={classes('more-wrap', open && 'is-open')}>
        <button
          ref={buttonRef}
          type="button"
          id={moreId(id)}
          className="more-btn"
          aria-label={`More actions for ${name}`}
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => onOpenChange(!open)}
        >
          <MoreIcon />
        </button>
        {open && (
          <div id={menuId} className="menu menu-card">
            <button type="button" className="menu-item" disabled={first} onClick={() => onMove(-1)}>
              <ArrowUpIcon className="mi-icon" />
              <span>Move up</span>
            </button>
            <button type="button" className="menu-item" disabled={last} onClick={() => onMove(1)}>
              <ArrowDownIcon className="mi-icon" />
              <span>Move down</span>
            </button>
            <span className="menu-sep" aria-hidden="true" />
            <button type="button" className="menu-item is-danger" onClick={onDelete}>
              <TrashIcon className="mi-icon" />
              <span>Delete</span>
            </button>
          </div>
        )}
      </div>
      {open && (
        // Outside the menu's wrapper, whose z-index would otherwise lift it over the menu.
        <button
          type="button"
          className="menu-backdrop for-menu"
          tabIndex={-1}
          aria-label="Close menu"
          onClick={() => onOpenChange(false)}
        />
      )}
    </>
  );
}
