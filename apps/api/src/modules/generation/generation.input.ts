import { SOURCE_TEXT_MAX_LENGTH, TARGET_ROLE_MAX_LENGTH } from '@cv-builder/shared';
import { z } from 'zod';

/**
 * The snapshot a generation job works from, stored in `generation_jobs.input`. It is taken when
 * the job starts, so later edits to the CV's sources never change a running or finished job.
 */
export const GenerationInputSchema = z
  .object({
    targetRole: z.string().min(1).max(TARGET_ROLE_MAX_LENGTH),
    sourceText: z.string().min(1).max(SOURCE_TEXT_MAX_LENGTH).nullable(),
    sourceDocument: z
      .object({
        id: z.uuid(),
        originalName: z.string(),
        pageCount: z.number().int().nullable(),
        text: z.string().min(1),
      })
      .nullable(),
  })
  .refine((input) => input.sourceText !== null || input.sourceDocument !== null, {
    message: 'A generation needs a PDF or a description of the experience',
  });

export type GenerationInput = z.infer<typeof GenerationInputSchema>;
