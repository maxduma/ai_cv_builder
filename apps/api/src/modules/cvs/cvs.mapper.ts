import type { CvDetail, CvStatus, CvSummary, GenerationJobStatus } from '@cv-builder/shared';
import { toGenerationJobDto } from '../generation/generation.mapper';
import { toSourceDocumentDto } from '../source-documents/source-documents.mapper';
import type { CvDetailRecord, CvSummaryRecord } from './cvs.repository';

const STATUS_BY_JOB: Record<GenerationJobStatus, CvStatus> = {
  QUEUED: 'generating',
  RUNNING: 'generating',
  FAILED: 'failed',
  SUCCEEDED: 'ready',
};

/** A CV without any generation job is still a draft; otherwise its latest job decides. */
export function toCvStatus(latestJobStatus: GenerationJobStatus | undefined): CvStatus {
  return latestJobStatus ? STATUS_BY_JOB[latestJobStatus] : 'draft';
}

export function toCvSummary(cv: CvSummaryRecord): CvSummary {
  return {
    id: cv.id,
    title: cv.title,
    targetRole: cv.targetRole,
    status: toCvStatus(cv.generationJobs[0]?.status),
    createdAt: cv.createdAt.toISOString(),
    updatedAt: cv.updatedAt.toISOString(),
  };
}

export function toCvDetail(cv: CvDetailRecord): CvDetail {
  const sourceDocument = cv.sourceDocuments[0];
  const latestGeneration = cv.generationJobs[0];
  return {
    ...toCvSummary(cv),
    sourceText: cv.sourceText,
    sourceDocument: sourceDocument ? toSourceDocumentDto(sourceDocument) : null,
    latestGeneration: latestGeneration ? toGenerationJobDto(latestGeneration) : null,
  };
}
