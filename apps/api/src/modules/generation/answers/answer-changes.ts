import { randomUUID } from 'node:crypto';
import {
  changedPaths,
  contentEditIssues,
  type CvContent,
  CvContentSchema,
  CV_LIMITS,
  type CvEducation,
  type CvExperience,
  isValidEmail,
  mergeCvContent,
} from '@cv-builder/shared';
import { digitsOf, guardContactDetails, normaliseUrl } from '../claude/contact-guard';
import type { AnswerRequest } from './answer-input';
import type {
  AnswerUpdate,
  ContactChanges,
  EducationChanges,
  RoleChanges,
} from './answer-update.schema';

/** What an answer amounts to before it meets the CV as it is now. */
export type AnswerChanges =
  | { kind: 'follow_up'; followUp: string }
  /** The CV the job started from, with the answer's changes. */
  | { kind: 'changes'; theirs: CvContent };

/** What applying an answer to the CV as it is now gives. */
export type AnswerResolution =
  | { kind: 'follow_up'; followUp: string }
  /** `applied` lists what changed (see `changedPaths`); empty when nothing did. */
  | { kind: 'content'; content: CvContent; applied: string[] }
  /** The result breaks the CV's rules; nothing is written. */
  | { kind: 'invalid' };

/**
 * Asked instead of the AI's own follow-up when it put a contact detail in the CV that the answer
 * doesn't spell out (or that isn't a usable address): the person types it, the AI never guesses it.
 */
export const CONTACT_FOLLOW_UPS = {
  email: 'Type the full email address, like name@example.com.',
  phone: 'Type the full phone number, including the country code.',
  links: 'Paste the full address, like linkedin.com/in/yourname.',
} as const;

const clean = (value: string) => value.trim();
const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Applies the changes Claude made for an answer to the CV the job started from (`request.cv`).
 *
 * The section was fixed by the answer's schema; this enforces the rest of the scope: a question
 * about one role or school changes only that entry and adds none, an empty value keeps a field as
 * it is, nothing is ever deleted, and contact details must appear in the answer itself. A request
 * for more detail wins over any change, unless the AI already asked once.
 */
export function applyAnswerChanges(
  request: AnswerRequest,
  update: AnswerUpdate,
  newId: () => string = randomUUID,
): AnswerChanges {
  const followUp = update.followUp.trim();
  // One follow-up per question at most: after that, whatever is clear gets applied.
  if (followUp !== '' && request.followUp === null) return { kind: 'follow_up', followUp };

  const cv: CvContent = structuredClone(request.cv);
  const itemId = request.question.itemId;

  if ('contact' in update) {
    const changes = withoutEchoes(update.contact, request.cv.contact);
    const problem = contactProblem(request, changes);
    if (problem) return { kind: 'follow_up', followUp: CONTACT_FOLLOW_UPS[problem] };
    applyContact(cv, changes, newId);
  }
  if ('summary' in update && clean(update.summary) !== '') {
    cv.summary = clean(update.summary);
  }
  if ('experience' in update) {
    for (const changes of scoped(update.experience, itemId)) applyRole(cv, changes, itemId, newId);
  }
  if ('education' in update) {
    for (const changes of scoped(update.education, itemId)) {
      applyEducation(cv, changes, itemId, newId);
    }
  }
  if ('addSkills' in update) {
    for (const name of update.addSkills.map(clean)) {
      if (name !== '' && !cv.skills.some((skill) => sameText(skill.name, name))) {
        cv.skills.push({ id: newId(), name });
      }
    }
  }
  return { kind: 'changes', theirs: cv };
}

/**
 * Meets the answer's changes with the CV as it is now: a three-way merge from the CV the job
 * started from, where edits made meanwhile win (see `mergeCvContent`). What the answer adds that
 * the person has added meanwhile, or that no longer fits a list, is left out.
 */
export function resolveAnswer(
  base: CvContent,
  changes: AnswerChanges,
  current: CvContent,
): AnswerResolution {
  if (changes.kind === 'follow_up') return changes;

  const merged = fitAdditions(mergeCvContent(base, current, changes.theirs), current);
  const parsed = CvContentSchema.safeParse(merged);
  if (!parsed.success || contentEditIssues(current, parsed.data).length > 0) {
    return { kind: 'invalid' };
  }
  return { kind: 'content', content: parsed.data, applied: changedPaths(current, parsed.data) };
}

/**
 * The email and phone the CV already has, as Claude may repeat them in another form (case,
 * spacing), count as unchanged: they are neither checked against the answer nor rewritten.
 */
function withoutEchoes(changes: ContactChanges, contact: CvContent['contact']): ContactChanges {
  const phoneDigits = digitsOf(changes.phone);
  return {
    ...changes,
    email: sameText(changes.email, contact.email) ? '' : changes.email,
    phone: phoneDigits !== '' && phoneDigits === digitsOf(contact.phone) ? '' : changes.phone,
  };
}

/** The contact detail of `changes` that the person's answers don't back up, if any. */
function contactProblem(request: AnswerRequest, changes: ContactChanges) {
  const contact = request.cv.contact;
  const email = clean(changes.email);
  const phone = clean(changes.phone);
  const proposed = {
    email: email !== contact.email ? email : '',
    phone: phone !== contact.phone ? phone : '',
    links: newLinks(contact.links, changes.addLinks),
  };
  // The details may come from either answer of a follow-up exchange: Claude saw both.
  const answers = [request.previousAnswer, request.answer].filter(Boolean).join('\n');
  const { cleared } = guardContactDetails(proposed, answers);
  if (cleared.includes('email') || (proposed.email !== '' && !isValidEmail(proposed.email))) {
    return 'email';
  }
  if (cleared.includes('phone')) return 'phone';
  if (cleared.includes('links')) return 'links';
  return null;
}

/** Links from the answer that the CV doesn't have yet, by their normalised address. */
function newLinks(existing: { url: string }[], added: ContactChanges['addLinks']) {
  const known = new Set(existing.map((link) => normaliseUrl(link.url)));
  return added
    .map((link) => ({ label: clean(link.label), url: clean(link.url) }))
    .filter((link) => {
      const key = normaliseUrl(link.url);
      if (key === '' || known.has(key)) return false;
      known.add(key);
      return true;
    });
}

function applyContact(cv: CvContent, changes: ContactChanges, newId: () => string) {
  const fields = [
    'firstName',
    'lastName',
    'headline',
    'email',
    'phone',
    'location',
    'workSetup',
  ] as const;
  for (const field of fields) {
    const value = clean(changes[field]);
    if (value !== '') cv.contact[field] = value;
  }
  for (const link of newLinks(cv.contact.links, changes.addLinks)) {
    cv.contact.links.push({ id: newId(), label: link.label || 'Website', url: link.url });
  }
}

/**
 * The role or school changes that may apply. For a question about one entry: those that name it,
 * or else a single change without an id (taken to mean that entry); several changes without an id
 * describe other entries the answer mentioned, which such a question can't add, so none applies.
 */
function scoped<T extends { id: string }>(changes: T[], itemId: string | null): T[] {
  if (itemId === null) return changes;
  const named = changes.filter((entry) => clean(entry.id) === itemId);
  if (named.length > 0) return named;
  const unnamed = changes.filter((entry) => clean(entry.id) === '');
  return unnamed.length === 1 ? unnamed : [];
}

/**
 * The entry `changes` is for, or `'new'`. For a question about one entry, changes to any other
 * entry, and new entries, are dropped (`null`).
 */
function targetOf(changesId: string, itemId: string | null): string | 'new' | null {
  if (itemId !== null) return changesId === '' || changesId === itemId ? itemId : null;
  return changesId === '' ? 'new' : changesId;
}

function applyRole(
  cv: CvContent,
  changes: RoleChanges,
  itemId: string | null,
  newId: () => string,
) {
  const target = targetOf(clean(changes.id), itemId);
  if (target === null) return;

  const fields = ['title', 'company', 'location', 'start', 'end'] as const;
  if (target === 'new') {
    const role: CvExperience = {
      id: newId(),
      title: clean(changes.title),
      company: clean(changes.company),
      location: clean(changes.location),
      start: clean(changes.start),
      end: changes.current === 'yes' ? '' : clean(changes.end),
      current: changes.current === 'yes',
      bullets: [],
    };
    addBullets(role, changes.addBullets, newId);
    if (role.title !== '' || role.company !== '') cv.experience.push(role);
    return;
  }

  const role = cv.experience.find((entry) => entry.id === target);
  if (!role) return;
  for (const field of fields) {
    const value = clean(changes[field]);
    if (value !== '') role[field] = value;
  }
  if (changes.current === 'yes') Object.assign(role, { current: true, end: '' });
  if (changes.current === 'no') role.current = false;
  for (const edit of changes.editBullets) {
    const bullet = role.bullets.find((entry) => entry.id === clean(edit.id));
    if (bullet && clean(edit.text) !== '') bullet.text = clean(edit.text);
  }
  addBullets(role, changes.addBullets, newId);
}

function addBullets(role: CvExperience, texts: string[], newId: () => string) {
  for (const text of texts.map(clean)) {
    if (text !== '' && !role.bullets.some((bullet) => sameText(bullet.text, text))) {
      role.bullets.push({ id: newId(), text });
    }
  }
}

function applyEducation(
  cv: CvContent,
  changes: EducationChanges,
  itemId: string | null,
  newId: () => string,
) {
  const target = targetOf(clean(changes.id), itemId);
  if (target === null) return;

  const fields = ['degree', 'school', 'location', 'start', 'end', 'details'] as const;
  if (target === 'new') {
    const entry: CvEducation = {
      id: newId(),
      degree: clean(changes.degree),
      school: clean(changes.school),
      location: clean(changes.location),
      start: clean(changes.start),
      end: clean(changes.end),
      details: clean(changes.details),
    };
    if (entry.degree !== '' || entry.school !== '') cv.education.push(entry);
    return;
  }

  const entry = cv.education.find((school) => school.id === target);
  if (!entry) return;
  for (const field of fields) {
    const value = clean(changes[field]);
    if (value !== '') entry[field] = value;
  }
}

/**
 * Leaves out entries the merge added that duplicate one the CV already has (the person may have
 * typed the same skill meanwhile), then trims what's left over the lists' limits: entries the CV
 * already has always stay.
 */
function fitAdditions(merged: CvContent, current: CvContent): CvContent {
  const bulletsOf = (id: string) =>
    current.experience.find((role) => role.id === id)?.bullets ?? [];
  return {
    ...merged,
    contact: {
      ...merged.contact,
      links: fit(merged.contact.links, current.contact.links, CV_LIMITS.links, (link) =>
        normaliseUrl(link.url),
      ),
    },
    experience: fit(
      merged.experience.map((role) => ({
        ...role,
        bullets: fit(role.bullets, bulletsOf(role.id), CV_LIMITS.bullets, (bullet) =>
          bullet.text.trim().toLowerCase(),
        ),
      })),
      current.experience,
      CV_LIMITS.experience,
    ),
    education: fit(merged.education, current.education, CV_LIMITS.education),
    skills: fit(merged.skills, current.skills, CV_LIMITS.skills, (skill) =>
      skill.name.trim().toLowerCase(),
    ),
  };
}

function fit<T extends { id: string }>(
  items: T[],
  existing: readonly T[],
  limit: number,
  key?: (item: T) => string,
): T[] {
  const kept = new Set(existing.map((item) => item.id));
  const keys = new Set(key ? existing.map(key) : []);
  const result = items.filter((item) => {
    if (kept.has(item.id) || !key) return true;
    const itemKey = key(item);
    if (keys.has(itemKey)) return false;
    keys.add(itemKey);
    return true;
  });
  for (let index = result.length - 1; result.length > limit && index >= 0; index -= 1) {
    if (!kept.has(result[index]!.id)) result.splice(index, 1);
  }
  return result;
}
