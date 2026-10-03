import { CV_LIMITS, type CvBullet, type CvContent, type CvExperience } from '@cv-builder/shared';
import type { KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { CheckIcon, CloseIcon, SmallPlusIcon } from '../../../ui/icons';
import type { EditorSession, Undo } from '../editor-session';
import { type EntryKind, EntrySection, editEntry, joinParts } from './EntrySection';
import type { SectionProps } from './section-props';
import { TextField, clip, focusField, insertAt, plural } from './SectionCard';

const EXPERIENCE: EntryKind<CvExperience> = {
  section: 'experience',
  heading: 'Experience',
  count: (total) => plural(total, 'role', 'roles'),
  limit: CV_LIMITS.experience,
  addId: 'add-exp',
  addLabel: 'Add experience',
  added: 'Added a new role.',
  untitled: 'New role',
  list: (cv) => cv.experience,
  withList: (cv, experience) => ({ ...cv, experience }),
  create: () => ({
    id: crypto.randomUUID(),
    title: '',
    company: '',
    location: '',
    start: '',
    end: '',
    current: false,
    bullets: [{ id: crypto.randomUUID(), text: '' }],
  }),
  head: (role) => {
    const dates = joinParts([role.start, role.current ? 'Present' : role.end], ' – ');
    return {
      title: joinParts([role.title, role.company], ' · '),
      meta: joinParts([dates, role.location], ' · '),
    };
  },
  undoLabel: (role) => joinParts([role.title, role.company], ' · ') || 'New role',
  isBlank: (role) =>
    !role.current &&
    [role.title, role.company, role.location, role.start, role.end]
      .concat(role.bullets.map((bullet) => bullet.text))
      .every((value) => value.trim() === ''),
};

/** Roles and their achievements. Open on phones too: it is what people come to edit. */
export function ExperienceSection({ draft, session }: SectionProps) {
  return (
    <EntrySection
      kind={EXPERIENCE}
      draft={draft}
      session={session}
      opensOnPhones
      renderFields={(role, name) => <RoleFields role={role} name={name} session={session} />}
    />
  );
}

/** One role's fields: title, company, where and when, and the list of achievements. */
function RoleFields({
  role,
  name,
  session,
}: {
  role: CvExperience;
  name: string;
  session: EditorSession;
}) {
  const id = role.id;
  const change = (changes: Partial<CvExperience>) =>
    editEntry(session, EXPERIENCE, id, (current) => ({ ...current, ...changes }));

  return (
    <>
      <div className="f-grid">
        <TextField
          id={`f-${id}-title`}
          label="Job title"
          placeholder="e.g. Backend Engineer"
          maxLength={CV_LIMITS.title}
          value={role.title}
          onChange={(event) => change({ title: event.target.value })}
        />
        <TextField
          id={`f-${id}-org`}
          label="Company"
          placeholder="e.g. Northpay"
          maxLength={CV_LIMITS.company}
          value={role.company}
          onChange={(event) => change({ company: event.target.value })}
        />
      </div>
      <div className="f-grid3">
        <TextField
          id={`f-${id}-loc`}
          label="Location"
          placeholder="City or Remote"
          maxLength={CV_LIMITS.location}
          value={role.location}
          onChange={(event) => change({ location: event.target.value })}
        />
        <TextField
          id={`f-${id}-start`}
          label="Start"
          placeholder="Mar 2021"
          maxLength={CV_LIMITS.date}
          value={role.start}
          onChange={(event) => change({ start: event.target.value })}
        />
        <TextField
          id={`f-${id}-end`}
          label="End"
          placeholder={role.current ? 'Present' : 'Feb 2021'}
          maxLength={CV_LIMITS.date}
          disabled={role.current}
          value={role.end}
          onChange={(event) => change({ end: event.target.value })}
        />
      </div>
      <label className="check">
        <input
          type="checkbox"
          id={`f-${id}-current`}
          checked={role.current}
          // A current role has no end date: the CV says "Present".
          onChange={(event) =>
            change(event.target.checked ? { current: true, end: '' } : { current: false })
          }
        />
        <span className="check-box" aria-hidden="true">
          <CheckIcon />
        </span>
        <span>I currently work here</span>
      </label>
      <Achievements role={role} name={name} session={session} />
    </>
  );
}

const bulletId = (roleId: string, bullet: CvBullet) => `bl-${roleId}-${bullet.id}`;

function withBullets(role: CvExperience, bullets: CvBullet[]): CvExperience {
  return { ...role, bullets };
}

/**
 * A role's achievements, one textarea each, edited like lines of text: Enter starts a new one
 * after the current one, Backspace in an empty one removes it and goes back to the one above.
 * Removing an achievement with text in it offers Undo; an empty one just goes.
 */
function Achievements({
  role,
  name,
  session,
}: {
  role: CvExperience;
  name: string;
  session: EditorSession;
}) {
  const roleId = role.id;
  const bullets = role.bullets;
  const full = bullets.length >= CV_LIMITS.bullets;
  const labelId = `f-${roleId}-bl`;
  const hintId = `f-${roleId}-bl-hint`;
  const addId = `f-${roleId}-bl-add`;

  /** Adds an empty achievement after `afterId` (or at the end) and puts the caret in it. */
  function add(afterId?: string) {
    if (full) return;
    const bullet: CvBullet = { id: crypto.randomUUID(), text: '' };
    flushSync(() =>
      editEntry(session, EXPERIENCE, roleId, (current) => {
        const after = current.bullets.findIndex((other) => other.id === afterId);
        const at = after === -1 ? current.bullets.length : after + 1;
        return withBullets(current, insertAt(current.bullets, at, bullet));
      }),
    );
    focusField(bulletId(roleId, bullet));
  }

  function remove(bullet: CvBullet, index: number, focusTarget: string) {
    const text = bullet.text.trim();
    const undo: Omit<Undo, 'id'> | undefined = text
      ? {
          label: clip(text, 40),
          restore: (cv: CvContent) =>
            EXPERIENCE.withList(
              cv,
              cv.experience.map((current) =>
                current.id !== roleId || current.bullets.some((other) => other.id === bullet.id)
                  ? current
                  : withBullets(current, insertAt(current.bullets, index, bullet)),
              ),
            ),
        }
      : undefined;
    flushSync(() =>
      editEntry(
        session,
        EXPERIENCE,
        roleId,
        (current) =>
          withBullets(
            current,
            current.bullets.filter((other) => other.id !== bullet.id),
          ),
        undo,
      ),
    );
    if (!undo) session.announce('Removed.');
    focusField(focusTarget);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>, bullet: CvBullet, index: number) {
    const modified = event.shiftKey || event.altKey || event.ctrlKey || event.metaKey;
    // Not while an input method is composing a character: its Enter confirms the character.
    if (event.key === 'Enter' && !modified && !event.nativeEvent.isComposing) {
      // At the limit Enter does nothing; the hint above the list says why.
      event.preventDefault();
      add(bullet.id);
      return;
    }
    if (event.key === 'Backspace' && !modified && event.currentTarget.value === '') {
      event.preventDefault();
      const neighbour = bullets[index - 1] ?? bullets[index + 1];
      remove(bullet, index, neighbour ? bulletId(roleId, neighbour) : `f-${roleId}-title`);
    }
  }

  return (
    <div className="field">
      <div className="bl-head">
        <span className="label" id={labelId}>
          Achievements
        </span>
        <span className="f-hint" id={hintId}>
          {full
            ? `You can add up to ${CV_LIMITS.bullets} achievements per role.`
            : 'Enter adds a new line'}
        </span>
      </div>
      {bullets.length > 0 && (
        <ul className="bl-list" aria-labelledby={labelId}>
          {bullets.map((bullet, index) => (
            <li key={bullet.id} className="bl">
              <textarea
                className="bl-input"
                id={bulletId(roleId, bullet)}
                rows={2}
                aria-label={`Achievement ${index + 1} of ${bullets.length} for ${name}`}
                aria-describedby={hintId}
                placeholder="What you did and the result"
                maxLength={CV_LIMITS.bullet}
                value={bullet.text}
                onChange={(event) => {
                  const text = event.target.value;
                  editEntry(session, EXPERIENCE, roleId, (current) =>
                    withBullets(
                      current,
                      current.bullets.map((other) =>
                        other.id === bullet.id ? { ...other, text } : other,
                      ),
                    ),
                  );
                }}
                onKeyDown={(event) => onKeyDown(event, bullet, index)}
              />
              <button
                type="button"
                className="icon-btn is-del"
                aria-label={`Remove achievement ${index + 1}`}
                onClick={() => {
                  const neighbour = bullets[index - 1] ?? bullets[index + 1];
                  remove(bullet, index, neighbour ? bulletId(roleId, neighbour) : addId);
                }}
              >
                <CloseIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" id={addId} className="add-row" disabled={full} onClick={() => add()}>
        <SmallPlusIcon />
        <span>Add achievement</span>
      </button>
    </div>
  );
}
