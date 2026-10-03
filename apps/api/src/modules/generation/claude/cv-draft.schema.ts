import { CV_LIMITS, GENERATION_ISSUES_MAX, GenerationIssueSchema } from '@cv-builder/shared';
import { z } from 'zod';
import { toJsonOutputFormat } from '../../../integrations/ai/output-schema';

/**
 * How many entries each list in Claude's answer may have: the limits of a stored CV
 * (`CvContentSchema` in packages/shared/src/cv-content.ts) and of its issues. Experience, bullets,
 * skills and links come most relevant first, and education most recent first, so the generator
 * cuts the tail of a list that runs over instead of rejecting the answer.
 */
export const AI_CV_DRAFT_LIMITS = {
  links: CV_LIMITS.links,
  experience: CV_LIMITS.experience,
  bullets: CV_LIMITS.bullets,
  education: CV_LIMITS.education,
  skills: CV_LIMITS.skills,
  issues: GENERATION_ISSUES_MAX,
} as const;

const text = (maxLength: number, description: string) =>
  z.string().max(maxLength).describe(description);

const list = <T extends z.ZodType>(item: T, maxItems: number, description: string) =>
  z.array(item).max(maxItems).describe(description);

const issue = GenerationIssueSchema.shape;

/**
 * The answer Claude must give: the CV without ids (the server assigns them), plus what it found
 * missing or unclear. Structured outputs turn this schema into a grammar the answer follows.
 *
 * - Strict objects, every key required, no transforms. Anything the sources don't say is an empty
 *   string or an empty list, never a guess.
 * - Contact details are plain strings on purpose: a grammar-enforced `email` or `uri` format can't
 *   be empty, so it would force the model to invent one when the sources have none.
 * - Lengths and counts are those of `CvContentSchema`; the issues use the shared
 *   `GenerationIssueSchema` fields, plus `item`, which the generator turns into the entry's id.
 *   The descriptions are per-field guidance for the model.
 */
export const AiCvDraftSchema = z.strictObject({
  contact: z
    .strictObject({
      firstName: text(80, 'First name as written in the sources; empty if not given.'),
      lastName: text(80, 'Last name as written in the sources; empty if not given.'),
      headline: text(
        160,
        'The person’s own current or most recent job title as the sources state it; empty if they don’t. Never the target role.',
      ),
      email: text(254, 'Exactly as in the sources; empty if they have none.'),
      phone: text(40, 'Exactly as in the sources, with its formatting; empty if they have none.'),
      location: text(
        120,
        'Where the person is based, as the sources state it; empty if not given.',
      ),
      workSetup: text(
        160,
        'The ways of working the person says they are open to, e.g. "Open to remote roles"; empty if the sources don’t say.',
      ),
      links: list(
        z.strictObject({
          label: text(40, 'What the link is, e.g. "LinkedIn", "GitHub" or "Portfolio".'),
          url: text(300, 'Exactly as in the sources. Never build one from a name or a username.'),
        }),
        AI_CV_DRAFT_LIMITS.links,
        'Links that appear in the sources (profiles, portfolio, website), most relevant first.',
      ),
    })
    .describe('How to reach the person, copied from the sources.'),
  summary: text(
    2_000,
    '2–4 sentences presenting the person for the target role, using only facts from the sources. No total years of experience and no adjectives the sources don’t use.',
  ),
  experience: list(
    z.strictObject({
      title: text(160, 'Job title as stated in the sources; empty if not given.'),
      company: text(160, 'Employer as stated in the sources; empty if not given.'),
      location: text(120, 'Where the role was based, as stated; empty if not given.'),
      start: text(
        40,
        'Start date with the sources’ precision, e.g. "2019" or "Mar 2021"; empty if not given.',
      ),
      end: text(
        40,
        'End date with the sources’ precision; empty if the role is current or no end date is given.',
      ),
      current: z
        .boolean()
        .describe(
          'True only if the sources say the role is ongoing ("present", "current", "now").',
        ),
      bullets: list(
        text(500, 'One achievement or responsibility, starting with a verb.'),
        AI_CV_DRAFT_LIMITS.bullets,
        'Most relevant to the target role first; about 25 words at most each, numbers exactly as in the sources. Up to 6 for relevant roles, 1–2 for unrelated ones.',
      ),
    }),
    AI_CV_DRAFT_LIMITS.experience,
    'Every role in the sources, ordered by relevance to the target role (most relevant first, most recent first among equally relevant ones). Unrelated roles are condensed, not dropped.',
  ),
  education: list(
    z.strictObject({
      degree: text(160, 'Degree or qualification as stated; empty if not given.'),
      school: text(160, 'School or university as stated; empty if not given.'),
      location: text(120, 'Where it was, as stated; empty if not given.'),
      start: text(40, 'Start date with the sources’ precision; empty if not given.'),
      end: text(40, 'End date with the sources’ precision; empty if not given.'),
      details: text(
        500,
        'Only facts the sources give, such as honours, a thesis or relevant courses; empty otherwise.',
      ),
    }),
    AI_CV_DRAFT_LIMITS.education,
    'Education from the sources, most recent first.',
  ),
  skills: list(
    text(60, 'One skill, as the sources name it.'),
    AI_CV_DRAFT_LIMITS.skills,
    'Skills, tools, technologies and languages the sources name, most relevant to the target role first, without duplicates.',
  ),
  issues: list(
    z.strictObject({
      section: issue.section.describe('The part of the CV the issue is about.'),
      kind: issue.kind.describe(
        '"missing": not in the sources; "ambiguous": unclear or conflicting; "incomplete": there, but without a detail such as a date or a result.',
      ),
      target: issue.target.describe(
        'The exact place, e.g. "Experience · Northpay" or "Contact details". In English.',
      ),
      question: issue.question.describe(
        'A short, neutral question the person can answer to fill the gap: it never presupposes a fact the sources do not state. In English.',
      ),
      why: issue.why.describe(
        'One sentence on why answering helps for the target role. In English.',
      ),
      item: z
        .number()
        .describe(
          'For an experience or education issue about one entry: its position in that list of this answer, counting from 1. Otherwise 0.',
        ),
    }),
    AI_CV_DRAFT_LIMITS.issues,
    'The gaps that matter most for the target role, most important first; empty if nothing important is missing.',
  ),
});

export type AiCvDraft = z.infer<typeof AiCvDraftSchema>;

/** The schema as structured outputs take it; see `toJsonOutputFormat`. */
export const AI_CV_DRAFT_FORMAT = toJsonOutputFormat(AiCvDraftSchema);
