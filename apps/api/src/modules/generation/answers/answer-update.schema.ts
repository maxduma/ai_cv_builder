import { CV_LIMITS, type GenerationIssue } from '@cv-builder/shared';
import { z } from 'zod';
import type { JsonOutputFormat } from '../../../integrations/ai/claude-client';
import { toJsonOutputFormat } from '../../../integrations/ai/output-schema';

/**
 * What an answer may change, one schema per section of the CV: an answer to a question about the
 * summary can only produce a new summary, one about a role only changes to roles, and so on. Other
 * sections are not in the schema, so they can't change.
 *
 * Built for structured outputs: strict objects, every key required, no transforms, no nullable.
 * An empty string means "leave this as it is", so nothing an answer produces can empty a field,
 * and there is no way to delete anything.
 */

const text = (maxLength: number, description: string) =>
  z.string().max(maxLength).describe(description);

const list = <T extends z.ZodType>(item: T, maxItems: number, description: string) =>
  z.array(item).max(maxItems).describe(description);

const keep = (maxLength: number, what: string) =>
  text(maxLength, `${what}, from the answer. Empty to keep it as it is.`);

const followUp = text(
  300,
  'Empty when the answer is clear enough to use. Otherwise one short question, in English, asking for exactly what is missing; then change nothing else.',
);

const contactChanges = z
  .strictObject({
    firstName: keep(CV_LIMITS.name, 'First name'),
    lastName: keep(CV_LIMITS.name, 'Last name'),
    headline: keep(
      CV_LIMITS.headline,
      'The person’s own current or most recent job title (never the target role)',
    ),
    email: keep(CV_LIMITS.email, 'Email address, exactly as written in the answer'),
    phone: keep(CV_LIMITS.phone, 'Phone number, exactly as written in the answer'),
    location: keep(CV_LIMITS.location, 'Where the person is based'),
    workSetup: keep(
      CV_LIMITS.workSetup,
      'Ways of working the person is open to, e.g. "Open to remote and hybrid roles"',
    ),
    addLinks: list(
      z.strictObject({
        label: text(
          CV_LIMITS.linkLabel,
          'What the link is, e.g. "LinkedIn", "GitHub", "Portfolio".',
        ),
        url: text(CV_LIMITS.linkUrl, 'The address exactly as written in the answer.'),
      }),
      CV_LIMITS.links,
      'Links the answer gives that the CV doesn’t have yet.',
    ),
  })
  .describe('Changes to the contact details.');

const roleChanges = z.strictObject({
  id: text(64, 'The id of the role in <cv> to change; empty for a role the CV doesn’t list yet.'),
  title: keep(CV_LIMITS.title, 'Job title'),
  company: keep(CV_LIMITS.company, 'Employer'),
  location: keep(CV_LIMITS.location, 'Where the role was based'),
  start: keep(CV_LIMITS.date, 'Start date, with the answer’s precision, e.g. "Mar 2021"'),
  end: keep(CV_LIMITS.date, 'End date, with the answer’s precision'),
  current: z
    .enum(['keep', 'yes', 'no'])
    .describe(
      '"yes" if the answer says the role is ongoing, "no" if it says it ended, else "keep".',
    ),
  editBullets: list(
    z.strictObject({
      id: text(64, 'The id of the bullet in <cv> to rewrite.'),
      text: text(CV_LIMITS.bullet, 'The bullet rewritten to include what the answer adds.'),
    }),
    CV_LIMITS.bullets,
    'Existing bullets to rewrite. Prefer folding a detail into the most related bullet.',
  ),
  addBullets: list(
    text(CV_LIMITS.bullet, 'One achievement or responsibility, starting with a verb.'),
    CV_LIMITS.bullets,
    'New bullets, only when no existing bullet fits the detail.',
  ),
});

const educationChanges = z.strictObject({
  id: text(
    64,
    'The id of the entry in <cv> to change; empty for an entry the CV doesn’t list yet.',
  ),
  degree: keep(CV_LIMITS.degree, 'Degree or qualification'),
  school: keep(CV_LIMITS.school, 'School or university'),
  location: keep(CV_LIMITS.location, 'Where it was'),
  start: keep(CV_LIMITS.date, 'Start date'),
  end: keep(CV_LIMITS.date, 'End date'),
  details: keep(CV_LIMITS.details, 'Honours, a thesis or relevant courses'),
});

const summary = keep(CV_LIMITS.summary, 'The summary rewritten to include what the answer adds');

const addSkills = list(
  text(CV_LIMITS.skill, 'One skill, tool, technology or language, as the answer names it.'),
  CV_LIMITS.skills,
  'Skills the answer names that the CV doesn’t list yet.',
);

export const ANSWER_UPDATE_SCHEMAS = {
  contact: z.strictObject({ followUp, contact: contactChanges }),
  summary: z.strictObject({ followUp, summary }),
  experience: z.strictObject({
    followUp,
    experience: list(roleChanges, CV_LIMITS.experience, 'Roles to change or add.'),
  }),
  education: z.strictObject({
    followUp,
    education: list(educationChanges, CV_LIMITS.education, 'Entries to change or add.'),
  }),
  skills: z.strictObject({ followUp, addSkills }),
  general: z.strictObject({ followUp, summary, addSkills }),
} satisfies Record<GenerationIssue['section'], z.ZodType>;

export type AnswerSection = keyof typeof ANSWER_UPDATE_SCHEMAS;
export type AnswerUpdate = z.infer<(typeof ANSWER_UPDATE_SCHEMAS)[AnswerSection]>;
export type ContactChanges = z.infer<typeof contactChanges>;
export type RoleChanges = z.infer<typeof roleChanges>;
export type EducationChanges = z.infer<typeof educationChanges>;

/** Each schema as structured outputs take it, built once so every one stays byte-stable. */
export const ANSWER_UPDATE_FORMATS = Object.fromEntries(
  Object.entries(ANSWER_UPDATE_SCHEMAS).map(([section, schema]) => [
    section,
    toJsonOutputFormat(schema),
  ]),
) as Record<AnswerSection, JsonOutputFormat>;
