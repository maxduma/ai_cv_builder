import {
  type CvContent,
  GENERATION_ISSUES_MAX,
  type GenerationIssue,
  isValidEmail,
} from '@cv-builder/shared';
import type { ClaudeClient } from '../../../integrations/ai/claude-client';
import type { Logger } from '../../../lib/logger';
import type { CvGenerator, GeneratedCv } from '../cv-generator';
import type { GenerationInput } from '../generation.input';
import { type GuardedContactField, guardContactDetails } from './contact-guard';
import {
  AI_CV_DRAFT_FORMAT,
  AI_CV_DRAFT_LIMITS,
  type AiCvDraft,
  AiCvDraftSchema,
} from './cv-draft.schema';
import { buildUserContent, SYSTEM_PROMPT } from './prompt';
import { requestStructured, withOneRetry } from './structured-answer';

/** The steps the CV's page shows while it is written (see `GENERATION_STEP_COUNT`). */
const STEPS = { reading: 0, matching: 1, writing: 2, checking: 3 } as const;

/** A contact detail the guard cleared becomes a question for the person. */
const CLEARED_CONTACT_QUESTIONS: Record<
  GuardedContactField,
  Pick<GenerationIssue, 'question' | 'why'>
> = {
  email: {
    question: 'What email address should employers use to contact you?',
    why: 'Recruiters need a way to reach you, and the draft only keeps contact details found in your CV or notes.',
  },
  phone: {
    question: 'What phone number should your CV show?',
    why: 'Recruiters often call shortlisted candidates, and the draft only keeps contact details found in your CV or notes.',
  },
  links: {
    question: 'Which profile or portfolio links should your CV include? Paste the full addresses.',
    why: 'Links let recruiters see more of your work, and the draft only keeps links found in your CV or notes.',
  },
};

/**
 * Writes the CV with Claude: one request with the sources and the target role, answered in the
 * shape of `AiCvDraftSchema`, then checked and turned into CV content.
 *
 * What goes wrong on Claude's side or in its answer becomes a `GenerationError` with a message for
 * the user (`JOB_FAILURES`). An answer that is unusable or broke off midway gets one more request,
 * under the same deadline; refusals, truncated answers and the API's errors don't (the SDK has
 * already retried what is worth retrying). Other errors propagate unchanged, and so does every
 * error once `hooks.signal` is aborted: the worker knows whether that was the deadline, a shutdown
 * or a lost job.
 */
export function createClaudeCvGenerator({ client }: { client: ClaudeClient }): CvGenerator {
  return {
    async generate(input, { signal, onStep, log }) {
      // The page's progress never goes back, not even when the request is sent again.
      let reached = -1;
      const reach = async (step: number) => {
        if (step <= reached) return;
        reached = step;
        log.debug({ step }, 'Generation step');
        await onStep(step);
      };

      await reach(STEPS.reading);
      const content = buildUserContent(input);

      const draft = await withOneRetry(log, async (attemptLog) => {
        await reach(STEPS.matching);
        return requestStructured(
          client,
          {
            system: SYSTEM_PROMPT,
            content,
            outputFormat: AI_CV_DRAFT_FORMAT,
            signal,
            onTextStart: () => reach(STEPS.writing),
            log: attemptLog,
          },
          {
            schema: AiCvDraftSchema,
            prepare: (json) => cutLists(json, attemptLog),
            what: 'CV',
            onAnswer: () => reach(STEPS.checking),
          },
        );
      });
      return toGeneratedCv(draft, input, log);
    },
  };
}

const SKILL_SCHEMA = AiCvDraftSchema.shape.skills.element;
const ISSUE_SCHEMA = AiCvDraftSchema.shape.issues.element;

/**
 * The API enforces neither how many entries a list may have nor how long a string is. Roles,
 * bullets, skills and links come most relevant first (education most recent first), so one that
 * runs over its limit loses its tail instead of failing the whole answer.
 * A skill that is too long, or a question that breaks its rules, is dropped too: neither is a fact
 * the CV depends on. Everything else (titles, companies, achievements) must fit, as cutting a fact
 * short would change it.
 */
function cutLists(json: unknown, log: Logger): unknown {
  if (!isRecord(json)) return json;
  const { contact, experience } = json;
  // Non-strings are kept, so that they fail the schema as the mismatch they are.
  const skills = dropInvalid(json.skills, (skill) =>
    typeof skill !== 'string' ? true : SKILL_SCHEMA.safeParse(skill).success,
  );
  const issues = dropInvalid(json.issues, (issue) => ISSUE_SCHEMA.safeParse(issue).success);
  if (skills.dropped > 0 || issues.dropped > 0) {
    // Counts only: the values are model output.
    log.warn(
      { skills: skills.dropped, issues: issues.dropped },
      'Dropped skills or questions that broke their limits',
    );
  }
  return {
    ...json,
    contact: isRecord(contact)
      ? { ...contact, links: cut(contact.links, AI_CV_DRAFT_LIMITS.links) }
      : contact,
    experience: Array.isArray(experience)
      ? experience
          .slice(0, AI_CV_DRAFT_LIMITS.experience)
          .map((role: unknown) =>
            isRecord(role)
              ? { ...role, bullets: cut(role.bullets, AI_CV_DRAFT_LIMITS.bullets) }
              : role,
          )
      : experience,
    education: cut(json.education, AI_CV_DRAFT_LIMITS.education),
    skills: cut(skills.value, AI_CV_DRAFT_LIMITS.skills),
    issues: cut(issues.value, AI_CV_DRAFT_LIMITS.issues),
  };
}

/** `value` without the items `keep` refuses, if it is a list; how many were dropped. */
function dropInvalid(value: unknown, keep: (item: unknown) => boolean) {
  if (!Array.isArray(value)) return { value, dropped: 0 };
  const kept = value.filter(keep);
  return { value: kept, dropped: value.length - kept.length };
}

const cut = (value: unknown, maxItems: number) =>
  Array.isArray(value) ? value.slice(0, maxItems) : value;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The checked draft as the generator's result, with the contact guard applied and each issue's
 * `item` (a position in the answer) turned into the id of that entry.
 */
function toGeneratedCv(draft: AiCvDraft, input: GenerationInput, log: Logger): GeneratedCv {
  const sources = `${input.sourceDocument?.text ?? ''}\n${input.sourceText ?? ''}`;
  const guarded = guardContactDetails(draft.contact, sources);
  const contact = guarded.contact;
  const cleared = [...guarded.cleared];
  // An email the sources give in a form no one can write to ("jane at example dot com") is asked
  // for too; it would only fail the editor's check later.
  if (contact.email !== '' && !isValidEmail(contact.email.trim())) {
    contact.email = '';
    cleared.push('email');
  }
  if (cleared.length > 0) {
    log.warn({ fields: cleared }, 'Removed contact details that are not in the sources');
  }

  // The model's questions come most important first; its last ones make room for those about the
  // removed details, as only they explain why a field the draft had filled is empty.
  const issues: GenerationIssue[] = draft.issues
    .slice(0, Math.max(0, GENERATION_ISSUES_MAX - cleared.length))
    .map(({ item, ...issue }) => {
      const itemId = entryId(draft, issue.section, item);
      return itemId ? { ...issue, itemId } : issue;
    });
  for (const field of cleared) {
    issues.push({
      section: 'contact',
      kind: 'missing',
      target: 'Contact details',
      ...CLEARED_CONTACT_QUESTIONS[field],
    });
  }

  log.info(
    {
      experience: draft.experience.length,
      education: draft.education.length,
      skills: draft.skills.length,
      issues: issues.length,
    },
    'Claude wrote the CV',
  );
  return { content: toCvContent({ ...draft, contact }), issues };
}

/** The id `toCvContent` gives the entry at 1-based position `item` of the issue's section. */
function entryId(draft: AiCvDraft, section: GenerationIssue['section'], item: number) {
  if (section !== 'experience' && section !== 'education') return undefined;
  const inRange = Number.isInteger(item) && item >= 1 && item <= draft[section].length;
  return inRange ? `${section}-${item}` : undefined;
}

/** The draft as stored CV content, with ids like the mock's (`experience-1-bullet-2`, `skill-3`). */
function toCvContent(draft: AiCvDraft): CvContent {
  const { links, ...contact } = draft.contact;
  return {
    version: 1,
    contact: {
      ...contact,
      links: links.map((link, index) => ({ id: `link-${index + 1}`, ...link })),
    },
    summary: draft.summary,
    experience: draft.experience.map(({ bullets, ...role }, index) => {
      const id = `experience-${index + 1}`;
      return {
        id,
        ...role,
        // A role with an end date has ended, whatever `current` says: the date is the stated fact
        // (and a current role has no end date anywhere else in the app).
        current: role.current && role.end.trim() === '',
        bullets: bullets.map((text, bullet) => ({ id: `${id}-bullet-${bullet + 1}`, text })),
      };
    }),
    education: draft.education.map((entry, index) => ({ id: `education-${index + 1}`, ...entry })),
    skills: draft.skills.map((name, index) => ({ id: `skill-${index + 1}`, name })),
  };
}
