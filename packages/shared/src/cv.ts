import { z } from 'zod';

/** Optional free text: trimmed, and an empty string counts as "not provided". */
const optionalText = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .optional()
    .transform((value) => value || undefined);

export const CreateCvRequestSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(120),
  targetRole: optionalText(120),
  jobDescription: optionalText(20_000),
});

export type CreateCvRequest = z.infer<typeof CreateCvRequestSchema>;

export const CvIdParamsSchema = z.object({
  cvId: z.uuid(),
});

export interface CvSummary {
  id: string;
  title: string;
  targetRole: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CvDetail extends CvSummary {
  jobDescription: string | null;
}

export interface CvListResponse {
  items: CvSummary[];
}
