import { CV_LIMITS } from '@cv-builder/shared';
import type { z } from 'zod';
import type { ClaudeClient } from '../../../integrations/ai/claude-client';
import type { AnswerUpdater } from '../answers/answer-input';
import {
  ANSWER_UPDATE_FORMATS,
  ANSWER_UPDATE_SCHEMAS,
  type AnswerUpdate,
} from '../answers/answer-update.schema';
import { ANSWER_SYSTEM_PROMPT, buildAnswerContent } from './answer-prompt';
import { requestStructured, withOneRetry } from './structured-answer';

const cut = (value: unknown, maxItems: number) =>
  Array.isArray(value) ? value.slice(0, maxItems) : value;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The API doesn't enforce how many entries a list may have; like a generated CV, an answer's
 * lists keep their best entries first, so one that runs over loses its tail instead of failing
 * the answer.
 * (What is added is fitted to the CV's room later anyway.)
 */
function cutLists(json: unknown): unknown {
  if (!isRecord(json)) return json;
  const { contact, experience } = json;
  return {
    ...json,
    ...(isRecord(contact) && {
      contact: { ...contact, addLinks: cut(contact.addLinks, CV_LIMITS.links) },
    }),
    ...(Array.isArray(experience) && {
      experience: experience.slice(0, CV_LIMITS.experience).map((role: unknown) =>
        isRecord(role)
          ? {
              ...role,
              editBullets: cut(role.editBullets, CV_LIMITS.bullets),
              addBullets: cut(role.addBullets, CV_LIMITS.bullets),
            }
          : role,
      ),
    }),
    ...('education' in json && { education: cut(json.education, CV_LIMITS.education) }),
    ...('addSkills' in json && { addSkills: cut(json.addSkills, CV_LIMITS.skills) }),
  };
}

/**
 * Turns an answer into changes to its question's section with Claude: one request, answered in
 * the shape of that section's schema (so other sections can't change). Failures and retries work
 * as for generation (see `createClaudeCvGenerator`).
 */
export function createClaudeAnswerUpdater({ client }: { client: ClaudeClient }): AnswerUpdater {
  return {
    async apply(request, { signal, log }) {
      const { section } = request.question;
      const content = buildAnswerContent(request);
      // One of the section schemas; their union is what the caller validates against.
      const schema = ANSWER_UPDATE_SCHEMAS[section] as z.ZodType<AnswerUpdate>;

      const update = await withOneRetry(log, (attemptLog) =>
        requestStructured(
          client,
          {
            system: ANSWER_SYSTEM_PROMPT,
            content,
            outputFormat: ANSWER_UPDATE_FORMATS[section],
            signal,
            log: attemptLog,
          },
          { schema, prepare: cutLists, what: 'answer update' },
        ),
      );
      log.info({ section, followUp: update.followUp !== '' }, 'Claude read the answer');
      return update;
    },
  };
}
