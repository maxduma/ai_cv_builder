import { CV_LIMITS, type CvContact, type CvContent, type CvLink } from '@cv-builder/shared';
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { CloseIcon, SmallPlusIcon } from '../../../ui/icons';
import type { EditorSession } from '../editor-session';
import type { SectionProps } from './section-props';
import { SectionCard, TextField, focusField, insertAt, startsNarrow } from './SectionCard';

/** The kinds of link the design offers; a link the AI labelled otherwise keeps its own label. */
const LINK_KINDS = ['LinkedIn', 'GitHub', 'Portfolio', 'Website'];

/** What a link is called; one without a label counts as a website, as on the server. */
const kindOf = (link: CvLink) => link.label || 'Website';

type ContactText = Exclude<keyof CvContact, 'links'>;

function editContact(session: EditorSession, field: ContactText, value: string) {
  session.edit((cv) => ({ ...cv, contact: { ...cv.contact, [field]: value } }));
}

function withLinks(cv: CvContent, links: CvLink[]): CvContent {
  return { ...cv, contact: { ...cv.contact, links } };
}

const urlId = (link: CvLink) => `lk-${link.id}-url`;

/**
 * Contact details: name, headline, how to reach the person, and their links. Always first on the
 * CV (the padlock), and folded on phones, where Experience is what people come to edit.
 *
 * The email is checked as it changes, but its error only shows once the person has left the
 * field: never while they are still typing the address.
 */
export function ContactSection({ draft, errors, session }: SectionProps) {
  const [open, setOpen] = useState(() => !startsNarrow());
  const [typingEmail, setTypingEmail] = useState(false);
  const contact = draft.contact;
  const emailError = typingEmail ? undefined : errors['contact.email'];

  // Folded, the header still says whose details these are.
  const name = [contact.firstName.trim(), contact.lastName.trim()].filter(Boolean).join(' ');
  const count = open ? '' : [name, contact.email.trim()].filter(Boolean).join(' · ');

  const field = (key: ContactText) => ({
    value: contact[key],
    onChange: (event: { target: { value: string } }) =>
      editContact(session, key, event.target.value),
  });

  return (
    <SectionCard
      section="contact"
      title="Contact details"
      count={count}
      open={open}
      onToggle={() => setOpen((current) => !current)}
      locked
    >
      <div className="f-grid">
        <TextField
          id="ct-first"
          label="First name"
          autoComplete="given-name"
          maxLength={CV_LIMITS.name}
          {...field('firstName')}
        />
        <TextField
          id="ct-last"
          label="Last name"
          autoComplete="family-name"
          maxLength={CV_LIMITS.name}
          {...field('lastName')}
        />
        <TextField
          id="ct-headline"
          label="Headline"
          className="span2"
          placeholder="e.g. Senior Backend Engineer"
          maxLength={CV_LIMITS.headline}
          {...field('headline')}
        />
        <TextField
          id="ct-email"
          label="Email"
          type="email"
          autoComplete="email"
          maxLength={CV_LIMITS.email}
          error={emailError}
          value={contact.email}
          onChange={(event) => {
            setTypingEmail(true);
            editContact(session, 'email', event.target.value);
          }}
          onBlur={() => {
            setTypingEmail(false);
            // Focus has moved on, so the error under the field would go unnoticed by a screen reader.
            const error = errors['contact.email'];
            if (typingEmail && error) session.announce(error);
          }}
        />
        <TextField
          id="ct-phone"
          label="Phone"
          optional
          type="tel"
          autoComplete="tel"
          maxLength={CV_LIMITS.phone}
          {...field('phone')}
        />
        <TextField
          id="ct-location"
          label="Location"
          placeholder="City, Country"
          maxLength={CV_LIMITS.location}
          {...field('location')}
        />
        <TextField
          id="ct-setup"
          label="Work setup"
          optional
          placeholder="e.g. Open to remote roles"
          maxLength={CV_LIMITS.workSetup}
          {...field('workSetup')}
        />
      </div>
      <Links links={contact.links} session={session} />
    </SectionCard>
  );
}

/**
 * The person's links, one row each: what kind of link it is, the address, and a button to remove
 * it. A link with an address comes back with Undo; an empty row just goes.
 */
function Links({ links, session }: { links: CvLink[]; session: EditorSession }) {
  const full = links.length >= CV_LIMITS.links;

  function editLink(id: string, changes: Partial<CvLink>) {
    session.edit((cv) =>
      withLinks(
        cv,
        cv.contact.links.map((link) => (link.id === id ? { ...link, ...changes } : link)),
      ),
    );
  }

  function add() {
    const link: CvLink = { id: crypto.randomUUID(), label: 'Portfolio', url: '' };
    flushSync(() => session.edit((cv) => withLinks(cv, [...cv.contact.links, link])));
    session.announce('Added a link.');
    focusField(urlId(link));
  }

  function remove(link: CvLink, index: number) {
    const neighbour = links[index - 1] ?? links[index + 1];
    const blank = link.url.trim() === '';
    flushSync(() =>
      session.edit(
        (cv) =>
          withLinks(
            cv,
            cv.contact.links.filter((item) => item.id !== link.id),
          ),
        blank
          ? undefined
          : {
              label: `${kindOf(link)} link`,
              restore: (cv) =>
                cv.contact.links.some((item) => item.id === link.id)
                  ? cv
                  : withLinks(cv, insertAt(cv.contact.links, index, link)),
            },
      ),
    );
    if (blank) session.announce('Removed.');
    // The button that was pressed is gone: the nearest link's address, or the way to add one.
    focusField(neighbour ? urlId(neighbour) : 'ct-add-link');
  }

  return (
    <div className="links" role="group" aria-labelledby="ct-links-label">
      <span className="label" id="ct-links-label">
        Links
      </span>
      {links.map((link, index) => {
        const kind = kindOf(link);
        return (
          <div key={link.id} className="link-row">
            <select
              className="select"
              id={`lk-${link.id}-kind`}
              aria-label="Link type"
              value={kind}
              onChange={(event) => editLink(link.id, { label: event.target.value })}
            >
              {!LINK_KINDS.includes(kind) && <option value={kind}>{kind}</option>}
              {LINK_KINDS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <input
              className="input"
              id={urlId(link)}
              type="url"
              aria-label={`${kind} address`}
              placeholder="linkedin.com/in/yourname"
              maxLength={CV_LIMITS.linkUrl}
              value={link.url}
              onChange={(event) => editLink(link.id, { url: event.target.value })}
            />
            <button
              type="button"
              className="icon-btn is-del"
              aria-label={`Remove ${kind} link`}
              onClick={() => remove(link, index)}
            >
              <CloseIcon />
            </button>
          </div>
        );
      })}
      <button type="button" id="ct-add-link" className="add-row" disabled={full} onClick={add}>
        <SmallPlusIcon />
        <span>Add link</span>
      </button>
    </div>
  );
}
