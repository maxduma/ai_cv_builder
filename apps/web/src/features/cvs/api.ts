import {
  type CreateCvRequest,
  type CvDetail,
  type CvListResponse,
  type GenerationJobDto,
  isTerminalJobStatus,
  type SourceDocumentDto,
  type UpdateCvRequest,
} from '@cv-builder/shared';
import { type QueryClient, useQuery } from '@tanstack/react-query';
import { api, type UploadOptions } from '../../lib/api-client';

export const cvKeys = {
  all: ['cvs'] as const,
  list: () => [...cvKeys.all, 'list'] as const,
  detail: (cvId: string) => [...cvKeys.all, 'detail', cvId] as const,
};

export const generationKeys = {
  job: (jobId: string) => ['generation-jobs', jobId] as const,
};

/** Generation runs on the server; while any CV is generating, the list refreshes itself. */
const LIST_POLL_MS = 3_000;
/** The status screen follows a running job more closely. */
const JOB_POLL_MS = 1_500;

export function useCvs() {
  return useQuery({
    queryKey: cvKeys.list(),
    queryFn: () => api.get<CvListResponse>('/cvs'),
    refetchInterval: (query) =>
      query.state.data?.items.some((cv) => cv.status === 'generating') ? LIST_POLL_MS : false,
  });
}

export function useCv(cvId: string) {
  return useQuery({
    queryKey: cvKeys.detail(cvId),
    queryFn: () => api.get<CvDetail>(`/cvs/${cvId}`),
  });
}

/** A generation job, polled until it has finished. */
export function useGenerationJob(job: GenerationJobDto | null) {
  return useQuery({
    queryKey: generationKeys.job(job?.id ?? 'none'),
    queryFn: () => api.get<GenerationJobDto>(`/generation-jobs/${job?.id}`),
    enabled: !!job,
    initialData: job ?? undefined,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && !isTerminalJobStatus(status) ? JOB_POLL_MS : false;
    },
  });
}

export const cvsApi = {
  create: (input: CreateCvRequest) => api.post<CvDetail>('/cvs', input),
  update: (cvId: string, input: UpdateCvRequest) => api.patch<CvDetail>(`/cvs/${cvId}`, input),
  uploadSourceDocument: (cvId: string, file: File, options: UploadOptions) =>
    api.upload<SourceDocumentDto>(`/cvs/${cvId}/source-document`, file, options),
  removeSourceDocument: (cvId: string) => api.delete(`/cvs/${cvId}/source-document`),
  startGeneration: (cvId: string) => api.post<GenerationJobDto>(`/cvs/${cvId}/generations`),
};

/**
 * Records a just-started job in the cache, so the status screen shows it immediately instead of
 * the stale "no generation yet" detail (which would send it back to the form).
 */
export function cacheStartedJob(queryClient: QueryClient, cv: CvDetail, job: GenerationJobDto) {
  queryClient.setQueryData<CvDetail>(cvKeys.detail(cv.id), {
    ...cv,
    status: 'generating',
    latestGeneration: job,
  });
  queryClient.setQueryData(generationKeys.job(job.id), job);
  void queryClient.invalidateQueries({ queryKey: cvKeys.list() });
}
