import { CV_LIMITS, type CvEducation } from '@cv-builder/shared';
import type { EditorSession } from '../editor-session';
import { type EntryKind, EntrySection, editEntry, joinParts } from './EntrySection';
import type { SectionProps } from './section-props';
import { TextField, plural } from './SectionCard';

const EDUCATION: EntryKind<CvEducation> = {
  section: 'education',
  heading: 'Education',
  count: (total) => plural(total, 'entry', 'entries'),
  limit: CV_LIMITS.education,
  addId: 'add-edu',
  addLabel: 'Add education',
  added: 'Added a new education entry.',
  untitled: 'New education entry',
  list: (cv) => cv.education,
  withList: (cv, education) => ({ ...cv, education }),
  create: () => ({
    id: crypto.randomUUID(),
    degree: '',
    school: '',
    location: '',
    start: '',
    end: '',
    details: '',
  }),
  // The design's header: the degree, then "School · 2012 – 2016".
  head: (entry) => ({
    title: entry.degree.trim(),
    meta: joinParts([entry.school, joinParts([entry.start, entry.end], ' – ')], ' · '),
  }),
  undoLabel: (entry) => joinParts([entry.degree, entry.school], ' · ') || 'New education entry',
  isBlank: (entry) =>
    [entry.degree, entry.school, entry.location, entry.start, entry.end, entry.details].every(
      (value) => value.trim() === '',
    ),
};

/** Degrees and certificates. Folded on phones, like everything but Experience. */
export function EducationSection({ draft, session }: SectionProps) {
  return (
    <EntrySection
      kind={EDUCATION}
      draft={draft}
      session={session}
      opensOnPhones={false}
      renderFields={(entry) => <EducationFields entry={entry} session={session} />}
    />
  );
}

/** One education entry's fields, laid out as in the design: degree and details take a full row. */
function EducationFields({ entry, session }: { entry: CvEducation; session: EditorSession }) {
  const id = entry.id;
  const change = (changes: Partial<CvEducation>) =>
    editEntry(session, EDUCATION, id, (current) => ({ ...current, ...changes }));

  return (
    <div className="f-grid">
      <TextField
        id={`f-${id}-title`}
        label="Degree or certificate"
        className="span2"
        placeholder="e.g. BSc in Computer Science"
        maxLength={CV_LIMITS.degree}
        value={entry.degree}
        onChange={(event) => change({ degree: event.target.value })}
      />
      <TextField
        id={`f-${id}-org`}
        label="School"
        placeholder="e.g. University of Lisbon"
        maxLength={CV_LIMITS.school}
        value={entry.school}
        onChange={(event) => change({ school: event.target.value })}
      />
      <TextField
        id={`f-${id}-loc`}
        label="Location"
        placeholder="City"
        maxLength={CV_LIMITS.location}
        value={entry.location}
        onChange={(event) => change({ location: event.target.value })}
      />
      <TextField
        id={`f-${id}-start`}
        label="Start"
        placeholder="2012"
        maxLength={CV_LIMITS.date}
        value={entry.start}
        onChange={(event) => change({ start: event.target.value })}
      />
      <TextField
        id={`f-${id}-end`}
        label="End"
        placeholder="2016"
        maxLength={CV_LIMITS.date}
        value={entry.end}
        onChange={(event) => change({ end: event.target.value })}
      />
      <TextField
        id={`f-${id}-details`}
        label="Details"
        optional
        className="span2"
        placeholder="e.g. Graduated with honours · Thesis on distributed systems"
        maxLength={CV_LIMITS.details}
        value={entry.details}
        onChange={(event) => change({ details: event.target.value })}
      />
    </div>
  );
}
