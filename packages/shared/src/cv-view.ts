import { type CvContent, isValidEmail } from './cv-content';

/**
 * The CV as its page shows it: the on-screen preview (`CvPage` in the web app) and the PDF render
 * this same view, so both always agree on what is printed and how it reads.
 */
export interface CvView {
  /** First and last name, or "Your name". */
  name: string;
  headline: string;
  /** The line under the name: email, phone, location, link URLs, then the work setup. */
  contact: CvViewContact[];
  /** May hold line breaks (the page keeps them). */
  summary: string;
  experience: CvViewRole[];
  education: CvViewEducation[];
  skills: { id: string; name: string }[];
}

export interface CvViewContact {
  key: string;
  text: string;
  /** Where the PDF links it to: `mailto:` for a valid email, `https://` for a web address. */
  href: string | null;
}

export interface CvViewRole {
  id: string;
  /** The job title, or "Job title". */
  title: string;
  /** "Mar 2021 – Present", "2016 – 2018", or whichever end is filled in. */
  dates: string;
  company: string;
  location: string;
  bullets: { id: string; text: string }[];
}

export interface CvViewEducation {
  id: string;
  /** The degree, or "Degree". */
  title: string;
  dates: string;
  school: string;
  location: string;
  /** May hold line breaks (the page keeps them). */
  details: string;
}

/** Control characters print as nothing useful; line breaks are handled separately. */
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g;

/** Spaces of other widths (en, thin, narrow no-break, ideographic...): one ordinary space. */
const WIDE_SPACES = /[\u2000-\u200a\u202f\u205f\u3000]/g;
/** Zero-width space and the marks that set text direction or join words invisibly. */
const INVISIBLE = /[\u200b\u200e\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

/**
 * Text as the font can print it, whatever the source: letters with their accents composed (a PDF
 * may give "e" and a combining accent, which would be drawn apart), spaces of other widths as an
 * ordinary space, invisible direction marks removed, and the hyphens the font lacks (U+2010,
 * U+2011) as a plain one.
 */
function printable(text: string): string {
  return text
    .normalize('NFC')
    .replace(WIDE_SPACES, ' ')
    .replace(INVISIBLE, '')
    .replace(/[\u2010\u2011]/g, '-');
}

/**
 * Text as the page shows a one-line value: runs of white space, line breaks included, read as
 * one space (as HTML does), with control characters removed.
 */
function line(text: string): string {
  return printable(text)
    .replace(/[\t\n\f\r ]+/g, ' ')
    .replace(CONTROL, '')
    .trim();
}

/**
 * Text as the page shows a paragraph (CSS `white-space: pre-line`): line breaks stay, other white
 * space collapses to one space, and spaces around a line break are dropped.
 */
function paragraph(text: string): string {
  return printable(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f ]+/g, ' ')
    .replace(CONTROL, '')
    .replace(/ ?\n ?/g, '\n')
    .trim();
}

/** "Mar 2021 – Present", "2012 – 2016", or whichever end is filled in. */
export function cvDates(start: string, end: string, current: boolean): string {
  const from = line(start);
  const to = current ? 'Present' : line(end);
  if (from && to) return `${from} – ${to}`;
  return from || to;
}

/** `https://…` as typed, or a bare domain (`linkedin.com/in/alex`) with `https://` added. */
const WEB_ADDRESS = /^https?:\/\/[^\s/?#]+[^\s]*$/i;
const BARE_DOMAIN =
  /^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:[/?#][^\s]*)?$/i;

/**
 * Where a link from the contact line goes in the PDF: a web address, with `https://` added to a
 * bare domain. Anything else (another scheme, a word like "Portfolio") is printed as plain text.
 */
export function linkHref(url: string): string | null {
  const text = line(url);
  if (WEB_ADDRESS.test(text)) return text;
  if (BARE_DOMAIN.test(text)) return `https://${text}`;
  return null;
}

/** The CV as its page shows it; see `CvView`. */
export function toCvView(content: CvContent): CvView {
  const { contact } = content;
  const email = line(contact.email);
  const contactItems: CvViewContact[] = [
    { key: 'email', text: email, href: isValidEmail(email) ? `mailto:${email}` : null },
    { key: 'phone', text: line(contact.phone), href: null },
    { key: 'location', text: line(contact.location), href: null },
    ...contact.links.map((link) => ({
      key: `link-${link.id}`,
      text: line(link.url),
      href: linkHref(link.url),
    })),
    { key: 'work-setup', text: line(contact.workSetup), href: null },
  ];

  return {
    name: [contact.firstName, contact.lastName].map(line).filter(Boolean).join(' ') || 'Your name',
    headline: line(contact.headline),
    contact: contactItems.filter((item) => item.text),
    summary: paragraph(content.summary),
    experience: content.experience.map((role) => ({
      id: role.id,
      title: line(role.title) || 'Job title',
      dates: cvDates(role.start, role.end, role.current),
      company: line(role.company),
      location: line(role.location),
      bullets: role.bullets
        .map((bullet) => ({ id: bullet.id, text: line(bullet.text) }))
        .filter((bullet) => bullet.text),
    })),
    education: content.education.map((entry) => ({
      id: entry.id,
      title: line(entry.degree) || 'Degree',
      dates: cvDates(entry.start, entry.end, false),
      school: line(entry.school),
      location: line(entry.location),
      details: paragraph(entry.details),
    })),
    skills: content.skills
      .map((skill) => ({ id: skill.id, name: line(skill.name) }))
      .filter((skill) => skill.name),
  };
}

export const PDF_FILE_NAME_MAX_LENGTH = 80;

/** What a file name can't hold on Windows or macOS, and control characters. */
// eslint-disable-next-line no-control-regex -- control characters can't be in a file name
const UNSAFE_IN_FILE_NAME = /[\\/:*?"<>|\u0000-\u001f\u007f]+/g;

/** The first `max` UTF-16 units of `text`, without splitting a surrogate pair. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const end = /[\uD800-\uDBFF]/.test(text.charAt(max - 1)) ? max - 1 : max;
  return text.slice(0, end);
}

/**
 * A file name as typed for the PDF, without what the design's rule leaves out: a typed `.pdf`
 * (the suffix is added on download) and characters file systems refuse. Not trimmed, so a space
 * can still be typed between two words.
 */
export function cleanPdfFileName(value: string): string {
  return cut(
    value.replace(/\.pdf$/i, '').replace(UNSAFE_IN_FILE_NAME, ''),
    PDF_FILE_NAME_MAX_LENGTH,
  );
}

/** The suggested PDF name: "Alex_Morgan_CV", or "CV" without a name. */
export function defaultPdfFileName(content: CvContent): string {
  const name = [content.contact.firstName, content.contact.lastName]
    .map((part) => line(part.replace(UNSAFE_IN_FILE_NAME, '')).replace(/ /g, '_'))
    .filter(Boolean);
  return cut([...name, 'CV'].join('_'), PDF_FILE_NAME_MAX_LENGTH);
}
