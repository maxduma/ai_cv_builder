import { z } from 'zod';
import type { GenerationJobDto } from './generation-job';
import type { SourceDocumentDto } from './source-document';

export const TARGET_ROLE_MIN_LENGTH = 2;
export const TARGET_ROLE_MAX_LENGTH = 120;
/** Experience in the user's own words: enough to describe a role, and no more than the UI takes. */
export const SOURCE_TEXT_MIN_LENGTH = 30;
export const SOURCE_TEXT_MAX_LENGTH = 5_000;

/**
 * Trimmed text that can be cleared: `''` and `null` both mean "no value". Wrapped in `.optional()`
 * below, a missing key means "leave unchanged", which PATCH relies on.
 */
const clearableText = (schema: z.ZodString) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    schema.nullable(),
  );

const targetRole = clearableText(
  z
    .string()
    .trim()
    .min(TARGET_ROLE_MIN_LENGTH, `Use at least ${TARGET_ROLE_MIN_LENGTH} characters`)
    .max(TARGET_ROLE_MAX_LENGTH),
);

const sourceText = clearableText(z.string().trim().max(SOURCE_TEXT_MAX_LENGTH));

// Strict objects: unknown keys such as `userId` are rejected. Ownership always comes from the
// authenticated user, never from the request body.
export const CreateCvRequestSchema = z.strictObject({
  targetRole: targetRole.optional(),
  sourceText: sourceText.optional(),
});

export type CreateCvRequest = z.infer<typeof CreateCvRequestSchema>;

/** Saves the target role and/or the free-text source of a CV. */
export const UpdateCvRequestSchema = z.strictObject({
  targetRole: targetRole.optional(),
  sourceText: sourceText.optional(),
});

export type UpdateCvRequest = z.infer<typeof UpdateCvRequestSchema>;

export const CvIdParamsSchema = z.object({
  cvId: z.uuid(),
});

/**
 * Where a CV is in its life cycle, derived from its latest generation job:
 * no job yet → `draft`, QUEUED/RUNNING → `generating`, FAILED → `failed`, SUCCEEDED → `ready`.
 */
export type CvStatus = 'draft' | 'generating' | 'failed' | 'ready';

export interface CvSummary {
  id: string;
  title: string;
  targetRole: string | null;
  status: CvStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CvDetail extends CvSummary {
  sourceText: string | null;
  sourceDocument: SourceDocumentDto | null;
  latestGeneration: GenerationJobDto | null;
}

export interface CvListResponse {
  items: CvSummary[];
}
