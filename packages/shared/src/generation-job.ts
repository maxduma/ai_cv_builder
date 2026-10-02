import { z } from 'zod';

/**
 * Lifecycle of a persisted CV generation job (mirrors the `generation_job_status` database enum):
 * QUEUED → RUNNING → SUCCEEDED | FAILED. A RUNNING job whose heartbeat goes stale is re-queued.
 */
export const GENERATION_JOB_STATUSES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'] as const;

export type GenerationJobStatus = (typeof GENERATION_JOB_STATUSES)[number];

/** Terminal jobs never change again, so clients can stop polling them. */
export function isTerminalJobStatus(status: GenerationJobStatus): boolean {
  return status === 'SUCCEEDED' || status === 'FAILED';
}

/**
 * A generation runs in four named steps (read the sources, match them to the role, write the
 * experience, format and check). `step` is the current one, 0–3, and 4 once the job succeeded.
 */
export const GENERATION_STEP_COUNT = 4;

export const GenerationJobIdParamsSchema = z.object({
  jobId: z.uuid(),
});

export interface GenerationJobDto {
  id: string;
  cvId: string;
  status: GenerationJobStatus;
  step: number;
  /** Set when the job failed; the message is safe to show to the user. */
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
