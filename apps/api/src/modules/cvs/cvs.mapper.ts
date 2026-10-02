import {
  type CvContent,
  CvContentSchema,
  type CvDetail,
  type CvStatus,
  type CvSummary,
  type GenerationJobStatus,
} from '@cv-builder/shared';
import { toGenerationJobDto } from '../generation/generation.mapper';
import { toSourceDocumentDto } from '../source-documents/source-documents.mapper';
import type { CvDetailRecord, CvSummaryRecord } from './cvs.repository';

const STATUS_BY_JOB: Record<GenerationJobStatus, CvStatus> = {
  PENDING: 'generating',
  PROCESSING: 'generating',
  FAILED: 'failed',
  COMPLETED: 'ready',
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
    content: toContent(cv.content),
  };
}

/** Content is validated before every write; a CV that was never generated has none (`null`). */
function toContent(content: CvDetailRecord['content']): CvContent | null {
  const parsed = CvContentSchema.safeParse(content);
  return parsed.success ? parsed.data : null;
}
