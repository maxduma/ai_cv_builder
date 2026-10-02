import { z } from 'zod';

/**
 * How long each field and list of a CV may be. The AI's answer schemas and the editor's inputs use
 * the same numbers, so neither can produce content the API would refuse.
 */
export const CV_LIMITS = {
  name: 80,
  headline: 160,
  email: 254,
  phone: 40,
  location: 120,
  workSetup: 160,
  linkLabel: 40,
  linkUrl: 300,
  links: 10,
  summary: 2_000,
  title: 160,
  company: 160,
  date: 40,
  bullet: 500,
  bullets: 15,
  experience: 30,
  degree: 160,
  school: 160,
  details: 500,
  education: 15,
  skill: 60,
  skills: 80,
} as const;

/**
 * A UTF-16 surrogate without its pair, which a browser can send (e.g. half an emoji cut off by a
 * length limit). PostgreSQL's JSONB can't store it, nor U+0000.
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export const UNSTORABLE_TEXT_MESSAGE = 'Remove the invisible character from this text.';

/** True if PostgreSQL's JSONB can store the text. */
export function isStorableText(value: string): boolean {
  return !value.includes('\u0000') && !LONE_SURROGATE.test(value);
}

const storable = (schema: z.ZodString) => schema.refine(isStorableText, UNSTORABLE_TEXT_MESSAGE);

const id = storable(z.string().min(1).max(64));

const text = (maxLength: number) =>
  storable(z.string().max(maxLength, `Use at most ${maxLength} characters.`));

const list = <T extends z.ZodType>(item: T, maxItems: number, what: string) =>
  z.array(item).max(maxItems, `You can add up to ${maxItems} ${what}.`);

const LinkSchema = z.object({ id, label: text(CV_LIMITS.linkLabel), url: text(CV_LIMITS.linkUrl) });
const BulletSchema = z.object({ id, text: text(CV_LIMITS.bullet) });

const ExperienceSchema = z.object({
  id,
  title: text(CV_LIMITS.title),
  company: text(CV_LIMITS.company),
  location: text(CV_LIMITS.location),
  start: text(CV_LIMITS.date),
  end: text(CV_LIMITS.date),
  current: z.boolean(),
  bullets: list(BulletSchema, CV_LIMITS.bullets, 'achievements per role'),
});

const EducationSchema = z.object({
  id,
  degree: text(CV_LIMITS.degree),
  school: text(CV_LIMITS.school),
  location: text(CV_LIMITS.location),
  start: text(CV_LIMITS.date),
  end: text(CV_LIMITS.date),
  details: text(CV_LIMITS.details),
});

const SkillSchema = z.object({ id, name: text(CV_LIMITS.skill) });

/** Reports the second and later uses of an id within one list; ids are how lists merge. */
function checkUniqueIds(
  items: readonly { id: string }[],
  path: (string | number)[],
  ctx: z.RefinementCtx,
) {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.id)) {
      ctx.addIssue({ code: 'custom', path: [...path, index, 'id'], message: 'Duplicate id.' });
    }
    seen.add(item.id);
  });
}

/**
 * The structured CV document stored in `cvs.content` (version 1). It follows the CV template in
 * the design; every write is validated against it, whether the content comes from the AI or the
 * editor. Unknown keys are stripped. Every list item has an id that stays the same while the item
 * exists: edits from different places (the editor, another tab, an AI update) merge by it.
 */
export const CvContentSchema = z
  .object({
    version: z.literal(1),
    contact: z.object({
      firstName: text(CV_LIMITS.name),
      lastName: text(CV_LIMITS.name),
      headline: text(CV_LIMITS.headline),
      email: text(CV_LIMITS.email),
      phone: text(CV_LIMITS.phone),
      location: text(CV_LIMITS.location),
      /** E.g. "Open to remote roles". Added after the first CVs were stored, hence the default. */
      workSetup: text(CV_LIMITS.workSetup).default(''),
      links: list(LinkSchema, CV_LIMITS.links, 'links'),
    }),
    summary: text(CV_LIMITS.summary),
    experience: list(ExperienceSchema, CV_LIMITS.experience, 'roles'),
    education: list(EducationSchema, CV_LIMITS.education, 'education entries'),
    skills: list(SkillSchema, CV_LIMITS.skills, 'skills'),
  })
  .superRefine((cv, ctx) => {
    checkUniqueIds(cv.contact.links, ['contact', 'links'], ctx);
    checkUniqueIds(cv.experience, ['experience'], ctx);
    cv.experience.forEach((role, index) =>
      checkUniqueIds(role.bullets, ['experience', index, 'bullets'], ctx),
    );
    checkUniqueIds(cv.education, ['education'], ctx);
    checkUniqueIds(cv.skills, ['skills'], ctx);
  });

export type CvContent = z.infer<typeof CvContentSchema>;
export type CvContact = CvContent['contact'];
export type CvLink = CvContact['links'][number];
export type CvExperience = CvContent['experience'][number];
export type CvBullet = CvExperience['bullets'][number];
export type CvEducation = CvContent['education'][number];
export type CvSkill = CvContent['skills'][number];

/** The design's check for an email address: something, an @, a domain with a dot. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const INVALID_EMAIL_MESSAGE = 'Enter a full email address, like name@example.com.';

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}

export interface ContentIssue {
  path: (string | number)[];
  message: string;
}

/**
 * Checks for values a person can mistype, applied only to what changed between `before` and
 * `after`. Hand edits and AI updates go through the same rules, and a value that was already
 * stored (say, an email the sources gave in an odd form) never blocks saving anything else.
 */
export function contentEditIssues(before: CvContent | null, after: CvContent): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const email = after.contact.email.trim();
  if (email !== '' && after.contact.email !== before?.contact.email && !isValidEmail(email)) {
    issues.push({ path: ['contact', 'email'], message: INVALID_EMAIL_MESSAGE });
  }
  return issues;
}

/**
 * Keeps a list within `limit` by leaving out entries `before` doesn't have, last first. Two
 * copies merged together (the editor's draft and an applied answer) can each be within a limit
 * and run over it together; what was already stored always stays.
 */
function withinLimit<T extends { id: string }>(items: T[], before: readonly T[], limit: number) {
  if (items.length <= limit) return items;
  const stored = new Set(before.map((item) => item.id));
  const result = [...items];
  for (let index = result.length - 1; result.length > limit && index >= 0; index -= 1) {
    if (!stored.has(result[index]!.id)) result.splice(index, 1);
  }
  return result;
}

/**
 * `after` as an autosave can store it: every edit that breaks a rule of `contentEditIssues` is
 * put back to its `before` value (the field shows its error meanwhile), and lists that merged
 * edits pushed over their limits are fitted.
 */
export function savableContent(before: CvContent, after: CvContent): CvContent {
  const invalid = new Set(contentEditIssues(before, after).map((issue) => issue.path.join('.')));
  const contact = invalid.has('contact.email')
    ? { ...after.contact, email: before.contact.email }
    : after.contact;
  const bulletsBefore = (id: string) =>
    before.experience.find((role) => role.id === id)?.bullets ?? [];

  const fitted: CvContent = {
    ...after,
    contact: {
      ...contact,
      links: withinLimit(contact.links, before.contact.links, CV_LIMITS.links),
    },
    experience: withinLimit(
      after.experience.map((role) => ({
        ...role,
        bullets: withinLimit(role.bullets, bulletsBefore(role.id), CV_LIMITS.bullets),
      })),
      before.experience,
      CV_LIMITS.experience,
    ),
    education: withinLimit(after.education, before.education, CV_LIMITS.education),
    skills: withinLimit(after.skills, before.skills, CV_LIMITS.skills),
  };
  // The same object when nothing had to change, so callers can tell.
  return invalid.size === 0 && deepEqualLists(fitted, after) ? after : fitted;
}

/** Whether fitting left every list as it was (the lists are the only thing it can shorten). */
function deepEqualLists(a: CvContent, b: CvContent): boolean {
  return (
    a.contact.links.length === b.contact.links.length &&
    a.experience.length === b.experience.length &&
    a.experience.every(
      (role, index) => role.bullets.length === b.experience[index]!.bullets.length,
    ) &&
    a.education.length === b.education.length &&
    a.skills.length === b.skills.length
  );
}

/** Body of `PUT /api/cvs/:cvId/content`: the whole document, and the version it was edited from. */
export const SaveCvContentRequestSchema = z.strictObject({
  /** Content exists from version 1 on (the first generation writes it). */
  baseVersion: z.number().int().min(1),
  content: CvContentSchema,
});

export type SaveCvContentRequest = z.input<typeof SaveCvContentRequestSchema>;

export interface SaveCvContentResponse {
  contentVersion: number;
}

/** `details` of a `409 CONTENT_CONFLICT`: what the CV holds now, to merge the edits into. */
export interface ContentConflictDetails {
  content: CvContent;
  contentVersion: number;
}
