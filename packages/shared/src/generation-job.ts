import { z } from 'zod';

/**
 * Lifecycle of a persisted CV generation job (mirrors the `generation_job_status` database enum):
 * PENDING → PROCESSING → COMPLETED | FAILED. A PROCESSING job whose heartbeat goes stale goes back
 * to PENDING.
 */
export const GENERATION_JOB_STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'] as const;

export type GenerationJobStatus = (typeof GENERATION_JOB_STATUSES)[number];

/** Terminal jobs never change again, so clients can stop polling them. */
export function isTerminalJobStatus(status: GenerationJobStatus): boolean {
  return status === 'COMPLETED' || status === 'FAILED';
}

/**
 * A generation runs in four named steps (read the sources, match them to the role, write the
 * experience, format and check). `step` is the current one, 0–3, and 4 once the job completed.
 */
export const GENERATION_STEP_COUNT = 4;

export const GenerationJobIdParamsSchema = z.object({
  jobId: z.uuid(),
});

export const GENERATION_ISSUE_SECTIONS = [
  'contact',
  'summary',
  'experience',
  'education',
  'skills',
  'general',
] as const;

export const GENERATION_ISSUE_KINDS = ['missing', 'ambiguous', 'incomplete'] as const;

export const GENERATION_ISSUES_MAX = 10;

/**
 * Something the AI found missing, unclear or incomplete in the user's material, phrased as a
 * question for them. Shaped for the "a few quick questions" step that follows a draft.
 */
export const GenerationIssueSchema = z.strictObject({
  section: z.enum(GENERATION_ISSUE_SECTIONS),
  kind: z.enum(GENERATION_ISSUE_KINDS),
  /** The exact place, e.g. "Experience · Northpay" or "Contact details". */
  target: z.string().max(120),
  question: z.string().min(1).max(300),
  /** Why answering helps for the target role, in one sentence. */
  why: z.string().max(400),
});

export type GenerationIssue = z.infer<typeof GenerationIssueSchema>;

export const GenerationIssuesSchema = z.array(GenerationIssueSchema).max(GENERATION_ISSUES_MAX);

export interface GenerationJobDto {
  id: string;
  cvId: string;
  status: GenerationJobStatus;
  step: number;
  /** Set when the job failed; the message is safe to show to the user. */
  errorCode: string | null;
  errorMessage: string | null;
  /** What the AI found missing or unclear in the sources; empty until the job has completed. */
  issues: GenerationIssue[];
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
