import type { CvContent, CvEducation, CvExperience } from '@cv-builder/shared';
import type { CSSProperties, ReactNode } from 'react';
import './cv-page.css';

/** The design's default CV accent: the headline and the bullet dots. */
const DEFAULT_ACCENT = '#4655EB';

/** "Mar 2021 – Present", "2012 – 2016", or whichever end is filled in. */
function cvDates(start: string, end: string, current: boolean): string {
  const from = start.trim();
  const to = current ? 'Present' : end.trim();
  if (from && to) return `${from} – ${to}`;
  return from || to;
}

/** The line under a role or degree: "<strong>Northpay</strong> · Lisbon", either part optional. */
function OrgLine({ org, location }: { org: string; location: string }) {
  const name = org.trim();
  const place = location.trim();
  if (!name && !place) return null;
  return (
    <p className="cvp-org">
      {name && <strong>{name}</strong>}
      {name && place ? ` · ${place}` : place}
    </p>
  );
}

/** A role or degree heading, with its dates set flush right on the same baseline. */
function ItemRow({ title, dates }: { title: string; dates: string }) {
  return (
    <div className="cvp-row">
      <h3 className="cvp-role">{title}</h3>
      {dates && <span className="cvp-dates">{dates}</span>}
    </div>
  );
}

function Role({ role }: { role: CvExperience }) {
  const bullets = role.bullets
    .map((bullet) => ({ id: bullet.id, text: bullet.text.trim() }))
    .filter((bullet) => bullet.text);
  return (
    <div className="cvp-item">
      <ItemRow
        title={role.title.trim() || 'Job title'}
        dates={cvDates(role.start, role.end, role.current)}
      />
      <OrgLine org={role.company} location={role.location} />
      {bullets.length > 0 && (
        <ul className="cvp-bullets">
          {bullets.map((bullet) => (
            <li key={bullet.id} className="cvp-bullet">
              {bullet.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Degree({ entry }: { entry: CvEducation }) {
  const details = entry.details.trim();
  return (
    <div className="cvp-item">
      <ItemRow
        title={entry.degree.trim() || 'Degree'}
        dates={cvDates(entry.start, entry.end, false)}
      />
      <OrgLine org={entry.school} location={entry.location} />
      {details && <p className="cvp-text">{details}</p>}
    </div>
  );
}

/**
 * One section of the page. An empty one is left out, unless the page is an editor preview
 * (`placeholders`): then it keeps its place with a hint, so the preview mirrors the form.
 */
function Section({
  title,
  empty,
  emptyText,
  placeholders,
  children,
}: {
  title: string;
  empty: boolean;
  emptyText: string;
  placeholders: boolean;
  children: ReactNode;
}) {
  if (empty && !placeholders) return null;
  return (
    <section className="cvp-sec">
      <h2 className="cvp-h">{title}</h2>
      {empty ? <p className="cvp-empty">{emptyText}</p> : children}
    </section>
  );
}

/**
 * The CV as one A4 page, ported from the design's CvPage template: the name, headline and
 * contact line, then Summary, Experience, Education and Skills in that fixed order. It renders
 * `content` and nothing else (no editor state), so the live preview, a full-page preview and the
 * PDF can all share it. Values are trimmed, blank ones are skipped, and an untitled role or degree
 * reads "Job title" / "Degree". The page is drawn at print size (794px wide); scale it with CSS
 * `zoom`. A dashed rule marks where page one ends once the content runs past it.
 */
export function CvPage({
  content,
  placeholders = false,
  accent = DEFAULT_ACCENT,
}: {
  content: CvContent;
  /** Show empty sections with a hint ("Add a short summary"); for the editor, never the PDF. */
  placeholders?: boolean;
  /** Colour of the headline and the bullet dots. */
  accent?: string;
}) {
  const { contact } = content;
  const name =
    [contact.firstName, contact.lastName]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' ') || 'Your name';
  const headline = contact.headline.trim();
  const contactItems = [
    { key: 'email', text: contact.email },
    { key: 'phone', text: contact.phone },
    { key: 'location', text: contact.location },
    ...contact.links.map((link) => ({ key: `link-${link.id}`, text: link.url })),
    { key: 'work-setup', text: contact.workSetup },
  ]
    .map((item) => ({ key: item.key, text: item.text.trim() }))
    .filter((item) => item.text);
  const summary = content.summary.trim();
  const skills = content.skills
    .map((skill) => ({ id: skill.id, name: skill.name.trim() }))
    .filter((skill) => skill.name);

  return (
    <article
      className="cvp-page"
      style={{ '--cvp-accent': accent } as CSSProperties}
      aria-label={`CV of ${name}`}
    >
      <header className="cvp-head">
        <h1 className="cvp-name">{name}</h1>
        {headline && <p className="cvp-headline">{headline}</p>}
        {contactItems.length > 0 && (
          <ul className="cvp-contact">
            {contactItems.map((item) => (
              <li key={item.key} className="cvp-ci">
                {item.text}
              </li>
            ))}
          </ul>
        )}
      </header>
      <span className="cvp-rule" aria-hidden="true" />

      <Section
        title="Summary"
        empty={!summary}
        emptyText="Add a short summary"
        placeholders={placeholders}
      >
        <p className="cvp-text">{summary}</p>
      </Section>

      <Section
        title="Experience"
        empty={content.experience.length === 0}
        emptyText="Add your experience"
        placeholders={placeholders}
      >
        <div className="cvp-items">
          {content.experience.map((role) => (
            <Role key={role.id} role={role} />
          ))}
        </div>
      </Section>

      <Section
        title="Education"
        empty={content.education.length === 0}
        emptyText="Add your education"
        placeholders={placeholders}
      >
        <div className="cvp-items">
          {content.education.map((entry) => (
            <Degree key={entry.id} entry={entry} />
          ))}
        </div>
      </Section>

      <Section
        title="Skills"
        empty={skills.length === 0}
        emptyText="Add a few skills"
        placeholders={placeholders}
      >
        <div className="cvp-chips">
          {skills.map((skill) => (
            <span key={skill.id} className="cvp-chip">
              {skill.name}
            </span>
          ))}
        </div>
      </Section>
    </article>
  );
}
