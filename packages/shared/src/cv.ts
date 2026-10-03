import { z } from 'zod';
import type { CvContent } from './cv-content';
import type { CvQuestionDto } from './cv-question';
import type { GenerationJobDto } from './generation-job';
import type { SourceDocumentDto } from './source-document';

export const TARGET_ROLE_MIN_LENGTH = 2;
export const TARGET_ROLE_MAX_LENGTH = 120;
/**
 * Experience in the user's own words: enough to describe a role, and room for a whole CV pasted in
 * as text (about 3,000 words). A longer CV goes in as a PDF, which may carry more.
 */
export const SOURCE_TEXT_MIN_LENGTH = 30;
export const SOURCE_TEXT_MAX_LENGTH = 20_000;

/**
 * Trimmed text that can be cleared: `''` and `null` both mean "no value". Wrapped in `.optional()`
 * below, a missing key means "leave unchanged", which PATCH relies on. U+0000 (which text pasted
 * from a PDF viewer can contain) is removed: PostgreSQL text can't store it.
 */
const clearableText = (schema: z.ZodString) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const text = value.replaceAll('\u0000', '');
    return text.trim() === '' ? null : text;
  }, schema.nullable());

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
 * no job yet → `draft`, PENDING/PROCESSING → `generating`, FAILED → `failed`, COMPLETED → `ready`.
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
  /** The structured CV, once a generation has completed; validated before it was stored. */
  content: CvContent | null;
  /** Incremented by every write of `content`; 0 until the first generation. Saves send it back. */
  contentVersion: number;
  /** What the AI asked about the CV, in the order it asked. */
  questions: CvQuestionDto[];
}

export interface CvListResponse {
  items: CvSummary[];
}
