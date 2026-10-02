import {
  type GenerationIssue,
  GenerationIssuesSchema,
  type GenerationJobDto,
} from '@cv-builder/shared';
import type { GenerationJobRecord } from './generation.repository';

export function toGenerationJobDto(job: GenerationJobRecord): GenerationJobDto {
  return {
    id: job.id,
    cvId: job.cvId,
    status: job.status,
    step: job.progressStep,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    issues: toIssues(job.issues),
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

/** Issues are validated before they are stored; until a job completes there are none (`null`). */
function toIssues(issues: GenerationJobRecord['issues']): GenerationIssue[] {
  const parsed = GenerationIssuesSchema.safeParse(issues);
  return parsed.success ? parsed.data : [];
}
