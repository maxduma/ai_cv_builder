import { type CvContent, GENERATION_ISSUES_MAX, type GenerationIssue } from '@cv-builder/shared';
import {
  type ClaudeClient,
  ClaudeError,
  type ClaudeErrorKind,
  type ClaudeResponse,
} from '../../../integrations/ai/claude-client';
import type { Logger } from '../../../lib/logger';
import { type CvGenerator, type GeneratedCv, GenerationError } from '../cv-generator';
import { JOB_FAILURES } from '../generation.failures';
import type { GenerationInput } from '../generation.input';
import type { JobFailure } from '../generation.repository';
import { type GuardedContactField, guardContactDetails } from './contact-guard';
import {
  AI_CV_DRAFT_FORMAT,
  AI_CV_DRAFT_LIMITS,
  type AiCvDraft,
  AiCvDraftSchema,
} from './cv-draft.schema';
import { buildUserContent, SYSTEM_PROMPT } from './prompt';

/** The first request, plus one more if its answer was unusable or broke off midway. */
const MAX_REQUESTS = 2;

/** The steps the CV's page shows while it is written (see `GENERATION_STEP_COUNT`). */
const STEPS = { reading: 0, matching: 1, writing: 2, checking: 3 } as const;

const FAILURE_BY_KIND: Record<ClaudeErrorKind, JobFailure> = {
  timeout: JOB_FAILURES.aiTimeout,
  rate_limited: JOB_FAILURES.aiRateLimited,
  unavailable: JOB_FAILURES.aiUnavailable,
  not_configured: JOB_FAILURES.aiNotConfigured,
  rejected: JOB_FAILURES.aiRequestRejected,
};

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

/** A request that didn't produce a usable CV, and whether asking once more may help. */
interface Unusable {
  ok: false;
  failure: JobFailure;
  retry: boolean;
  cause?: ClaudeError;
}

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

      const requestCv = async (
        attemptLog: Logger,
      ): Promise<{ ok: true; cv: GeneratedCv } | Unusable> => {
        await reach(STEPS.matching);
        let answer: ClaudeResponse;
        try {
          answer = await client.complete({
            system: SYSTEM_PROMPT,
            content,
            outputFormat: AI_CV_DRAFT_FORMAT,
            signal,
            onTextStart: () => reach(STEPS.writing),
            log: attemptLog,
          });
        } catch (error) {
          if (signal.aborted || !(error instanceof ClaudeError)) throw error;
          const retry = error.midStream && error.kind === 'unavailable';
          return { ok: false, failure: FAILURE_BY_KIND[error.kind], retry, cause: error };
        }

        await reach(STEPS.checking);
        const draft = readDraft(answer, attemptLog);
        return draft.ok ? { ok: true, cv: toGeneratedCv(draft.value, input, attemptLog) } : draft;
      };

      for (let attempt = 1; ; attempt += 1) {
        const attemptLog = log.child({ aiAttempt: attempt });
        const result = await requestCv(attemptLog);
        if (result.ok) return result.cv;
        if (!result.retry || attempt === MAX_REQUESTS) {
          throw new GenerationError(result.failure, { cause: result.cause });
        }
        attemptLog.warn({ code: result.failure.code }, 'Asking Claude again');
      }
    },
  };
}

/** The draft in a finished answer, or why the answer can't be used. */
function readDraft(answer: ClaudeResponse, log: Logger): { ok: true; value: AiCvDraft } | Unusable {
  switch (answer.stopReason) {
    case 'end_turn':
      break;
    case 'refusal':
      return { ok: false, failure: JOB_FAILURES.aiRefused, retry: false };
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return { ok: false, failure: JOB_FAILURES.aiOutputTruncated, retry: false };
    default:
      // Not expected from this request (no tools, stop sequences or pauses), and not a finished
      // answer; asking again would most likely end the same way.
      log.warn({ stopReason: answer.stopReason }, 'Claude stopped for an unexpected reason');
      return { ok: false, failure: JOB_FAILURES.aiInvalidJson, retry: false };
  }

  let json: unknown;
  try {
    json = JSON.parse(answer.text);
  } catch (error) {
    // V8's message quotes the text around the error, i.e. the CV: only the name is logged.
    const name = error instanceof Error ? error.name : typeof error;
    log.warn({ error: name, length: answer.text.length }, 'Claude answer is not valid JSON');
    return { ok: false, failure: JOB_FAILURES.aiInvalidJson, retry: true };
  }

  const draft = AiCvDraftSchema.safeParse(cutLists(json));
  if (!draft.success) {
    // Where and what kind of mismatch, never the values: they are the CV.
    const mismatches = draft.error.issues.map(
      (issue) => `${issue.path.map(String).join('.')}: ${issue.code}`,
    );
    log.warn(
      { mismatches: mismatches.slice(0, 10), count: mismatches.length },
      'Claude answer does not match the CV schema',
    );
    return { ok: false, failure: JOB_FAILURES.aiSchemaMismatch, retry: true };
  }
  return { ok: true, value: draft.data };
}

/**
 * The API doesn't enforce how many entries a list may have. Lists come most relevant first, so
 * one that runs over its limit is cut instead of failing the whole answer.
 */
function cutLists(json: unknown): unknown {
  if (!isRecord(json)) return json;
  const { contact, experience } = json;
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
    skills: cut(json.skills, AI_CV_DRAFT_LIMITS.skills),
    issues: cut(json.issues, AI_CV_DRAFT_LIMITS.issues),
  };
}

const cut = (value: unknown, maxItems: number) =>
  Array.isArray(value) ? value.slice(0, maxItems) : value;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The checked draft as the generator's result, with the contact guard applied. */
function toGeneratedCv(draft: AiCvDraft, input: GenerationInput, log: Logger): GeneratedCv {
  const sources = `${input.sourceDocument?.text ?? ''}\n${input.sourceText ?? ''}`;
  const { contact, cleared } = guardContactDetails(draft.contact, sources);
  if (cleared.length > 0) {
    log.warn({ fields: cleared }, 'Removed contact details that are not in the sources');
  }

  const issues: GenerationIssue[] = [...draft.issues];
  for (const field of cleared) {
    if (issues.length >= GENERATION_ISSUES_MAX) break;
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
        bullets: bullets.map((text, bullet) => ({ id: `${id}-bullet-${bullet + 1}`, text })),
      };
    }),
    education: draft.education.map((entry, index) => ({ id: `education-${index + 1}`, ...entry })),
    skills: draft.skills.map((name, index) => ({ id: `skill-${index + 1}`, name })),
  };
}
