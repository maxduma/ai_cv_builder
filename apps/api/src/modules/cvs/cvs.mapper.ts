import type { CvDetail, CvSummary } from '@cv-builder/shared';
import type { CvDetailRecord, CvSummaryRecord } from './cvs.repository';

export function toCvSummary(cv: CvSummaryRecord): CvSummary {
  return {
    id: cv.id,
    title: cv.title,
    targetRole: cv.targetRole,
    createdAt: cv.createdAt.toISOString(),
    updatedAt: cv.updatedAt.toISOString(),
  };
}

export function toCvDetail(cv: CvDetailRecord): CvDetail {
  return { ...toCvSummary(cv), jobDescription: cv.jobDescription };
}
