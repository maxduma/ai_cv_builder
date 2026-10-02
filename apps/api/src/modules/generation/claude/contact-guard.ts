import type { AiCvDraft } from './cv-draft.schema';

/** The contact details the guard checks, as named in the CV. */
export type GuardedContactField = 'email' | 'phone' | 'links';

type Contact = AiCvDraft['contact'];

/** Whitespace, line breaks included, plus the invisible characters PDF text carries inside words. */
const INVISIBLE = /[\s\u00AD\u200B-\u200D\u2060]/g;
/** A hyphen at the end of a line, where PDF layout may have split a word in two. */
const LINE_END_HYPHEN = /-[^\S\n]*\n/g;
/** `https://`, `ftp://`, `mailto:` ... */
const URL_SCHEME = /^(?:[a-z][a-z\d+.-]*:\/\/|mailto:)/;

const squeeze = (text: string) => text.replace(INVISIBLE, '');
const digitsOf = (text: string) => text.replace(/\D/g, '');

/**
 * Never let the model invent a way to reach someone: the email, the phone and each link's URL stay
 * in the CV only if they appear in the sources. A detail that doesn't is cleared (a link is
 * dropped), and its field is reported by name; the value itself is never logged.
 *
 * "Appear" allows for how text comes out of PDFs and how the model may tidy it up: whitespace and
 * line breaks are ignored, and so is case for emails and URLs; a URL may gain or lose its scheme,
 * `www.` and a trailing slash, an email a `mailto:`; phones compare by their digits.
 */
export function guardContactDetails(
  contact: Contact,
  sources: string,
): { contact: Contact; cleared: GuardedContactField[] } {
  const lower = sources.toLowerCase();
  // A hyphen at a line end may be the layout's ("north-\npay.com") or the address's own
  // ("jean-\nluc@…"), so the sources are searched both with and without it.
  const forms = [squeeze(lower), squeeze(lower.replace(LINE_END_HYPHEN, ''))];
  const appears = (value: string) => value === '' || forms.some((form) => form.includes(value));

  const emailFound = appears(squeeze(contact.email.toLowerCase()).replace(/^mailto:/, ''));
  const phoneDigits = digitsOf(contact.phone);
  const phoneFound =
    phoneDigits === ''
      ? appears(squeeze(contact.phone.toLowerCase()))
      : digitsOf(sources).includes(phoneDigits);
  const links = contact.links.filter((link) => appears(normaliseUrl(link.url)));

  const cleared: GuardedContactField[] = [];
  if (!emailFound) cleared.push('email');
  if (!phoneFound) cleared.push('phone');
  if (links.length < contact.links.length) cleared.push('links');

  return {
    contact: {
      ...contact,
      email: emailFound ? contact.email : '',
      phone: phoneFound ? contact.phone : '',
      links,
    },
    cleared,
  };
}

function normaliseUrl(url: string): string {
  return squeeze(url.toLowerCase())
    .replace(URL_SCHEME, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
}
