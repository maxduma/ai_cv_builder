import type { GenerationJobDto } from '@cv-builder/shared';
import type { GenerationJobRecord } from './generation.repository';

export function toGenerationJobDto(job: GenerationJobRecord): GenerationJobDto {
  return {
    id: job.id,
    cvId: job.cvId,
    status: job.status,
    step: job.progressStep,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}
