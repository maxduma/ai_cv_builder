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
