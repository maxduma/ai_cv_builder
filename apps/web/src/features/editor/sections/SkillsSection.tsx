import { CV_LIMITS, type CvContent, type CvSkill } from '@cv-builder/shared';
import { type KeyboardEvent, type SVGProps, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { SectionProps } from './section-props';
import { SectionCard, focusField, insertAt, plural, startsNarrow } from './SectionCard';

const INPUT_ID = 'skill-input';

const removeId = (skill: CvSkill) => `skill-${skill.id}-x`;

function withSkills(cv: CvContent, skills: CvSkill[]): CvContent {
  return { ...cv, skills };
}

/** The design's small × on a skill chip (lighter than the 14px close icon). */
function SkillRemoveIcon(props: Omit<SVGProps<SVGSVGElement>, 'children'>) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" {...props}>
      <path
        d="M3.5 3.5L8.5 8.5M8.5 3.5L3.5 8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Skills as chips, in the order they appear on the CV. Typing a skill and pressing Enter, a
 * comma or Add puts it at the end; a skill already on the CV (in any letter case) isn't added
 * twice. Backspace in the empty field removes the last chip. Removed skills come back with Undo.
 */
export function SkillsSection({ draft, session }: SectionProps) {
  const [open, setOpen] = useState(() => !startsNarrow());
  // Kept out of the folded body, so folding the section doesn't lose a half-typed skill.
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const skills = draft.skills;
  const full = skills.length >= CV_LIMITS.skills;

  function add(raw: string) {
    const name = raw.trim().replace(/,+$/, '').trim();
    if (!name || full) {
      setValue('');
      return;
    }
    const existing = skills.find((skill) => skill.name.trim().toLowerCase() === name.toLowerCase());
    setValue('');
    if (existing) {
      session.announce(`${existing.name.trim()} is already on your CV.`);
      return;
    }
    const skill: CvSkill = { id: crypto.randomUUID(), name };
    session.edit((cv) => withSkills(cv, [...cv.skills, skill]));
    session.announce(`Added ${name}.`);
  }

  function remove(skill: CvSkill, index: number, focusTarget: string) {
    const label = skill.name.trim();
    flushSync(() =>
      session.edit(
        (cv) =>
          withSkills(
            cv,
            cv.skills.filter((other) => other.id !== skill.id),
          ),
        label
          ? {
              label,
              restore: (cv) =>
                cv.skills.some((other) => other.id === skill.id)
                  ? cv
                  : withSkills(cv, insertAt(cv.skills, index, skill)),
            }
          : undefined,
      ),
    );
    if (!label) session.announce('Removed.');
    focusField(focusTarget);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Not while an input method is composing a character: its Enter confirms the character.
    if ((event.key === 'Enter' || event.key === ',') && !event.nativeEvent.isComposing) {
      event.preventDefault();
      add(value);
      return;
    }
    const modified = event.shiftKey || event.altKey || event.ctrlKey || event.metaKey;
    const last = skills[skills.length - 1];
    if (event.key === 'Backspace' && !modified && value === '' && last) {
      event.preventDefault();
      remove(last, skills.length - 1, INPUT_ID);
    }
  }

  return (
    <SectionCard
      section="skills"
      title="Skills"
      count={plural(skills.length, 'skill', 'skills')}
      open={open}
      onToggle={() => setOpen((current) => !current)}
    >
      {skills.length > 0 && (
        <ul className="skill-list" aria-label="Skills, in the order they appear on your CV">
          {skills.map((skill, index) => {
            // The button that was pressed goes away: the next chip's ×, the one before, or the field.
            const neighbour = skills[index + 1] ?? skills[index - 1];
            return (
              <li key={skill.id} className="skill-chip">
                <span className="skill-label">{skill.name}</span>
                <button
                  type="button"
                  id={removeId(skill)}
                  className="skill-x"
                  aria-label={`Remove ${skill.name}`}
                  onClick={() => remove(skill, index, neighbour ? removeId(neighbour) : INPUT_ID)}
                >
                  <SkillRemoveIcon />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="skill-add">
        <label className="sr-only" htmlFor={INPUT_ID}>
          Add a skill
        </label>
        <input
          ref={inputRef}
          id={INPUT_ID}
          className="input"
          type="text"
          autoComplete="off"
          placeholder={
            full ? `You can add up to ${CV_LIMITS.skills} skills.` : 'Add a skill and press Enter'
          }
          maxLength={CV_LIMITS.skill}
          // Read-only rather than disabled at the limit: it keeps focus after the last skill that
          // fits is added, and Backspace still removes the last chip.
          readOnly={full}
          value={value}
          onChange={(event) => {
            const next = event.target.value;
            // Phone keyboards don't report the comma key: a typed comma arrives here instead.
            if (next.endsWith(',')) add(next);
            else setValue(next);
          }}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="btn btn-secondary"
          disabled={full}
          onClick={() => {
            add(value);
            // Ready for the next skill.
            inputRef.current?.focus();
          }}
        >
          Add
        </button>
      </div>
    </SectionCard>
  );
}
