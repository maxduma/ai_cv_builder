import {
  type AnswerQuestionRequest,
  type CreateCvRequest,
  type CvDetail,
  type CvListResponse,
  type CvQuestionDto,
  type GenerationJobDto,
  isTerminalJobStatus,
  isUpdating,
  type SaveCvContentRequest,
  type SaveCvContentResponse,
  type SourceDocumentDto,
  type UpdateCvRequest,
  type UpdateQuestionRequest,
} from '@cv-builder/shared';
import { type QueryClient, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ApiError, api, type UploadOptions } from '../../lib/api-client';

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
  saveContent: (cvId: string, input: SaveCvContentRequest) =>
    api.put<SaveCvContentResponse>(`/cvs/${cvId}/content`, input),
  answerQuestion: (cvId: string, questionId: string, input: AnswerQuestionRequest) =>
    api.post<CvQuestionDto>(`/cvs/${cvId}/questions/${questionId}/answers`, input),
  updateQuestion: (cvId: string, questionId: string, input: UpdateQuestionRequest) =>
    api.patch<CvQuestionDto>(`/cvs/${cvId}/questions/${questionId}`, input),
  /** The CV's saved content as a PDF, and how many pages it has (`null` if the API didn't say). */
  downloadPdf: async (cvId: string, signal?: AbortSignal) => {
    const { blob, headers } = await api.download(`/cvs/${cvId}/pdf`, signal);
    return { blob, pageCount: Number(headers.get('X-Page-Count')) || null };
  },
};

/**
 * Records a question the API just changed (answered, skipped, dismissed) in the CV's cached
 * detail, then fetches the detail again. A fetch already in flight is cancelled first: started
 * before the change, it would put the old question back (and an answered one would never be
 * followed). Only the question changes in the cache: the rest may be newer than this caller saw.
 */
export async function cacheQuestion(
  queryClient: QueryClient,
  cvId: string,
  question: CvQuestionDto,
) {
  const key = cvKeys.detail(cvId);
  await queryClient.cancelQueries({ queryKey: key });
  queryClient.setQueryData<CvDetail>(key, (cv) =>
    cv ? { ...cv, questions: cv.questions.map((q) => (q.id === question.id ? question : q)) } : cv,
  );
  void queryClient.invalidateQueries({ queryKey: key });
}

function isFieldDetail(value: unknown): value is { message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof value.message === 'string'
  );
}

/**
 * Why answering, skipping or dismissing a question failed, in the API's words: a rejected answer
 * names its problem in `details`.
 */
export function questionErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Try again in a moment.';
  if (error.code === 'VALIDATION_ERROR' && Array.isArray(error.details)) {
    const detail: unknown = error.details[0];
    if (isFieldDetail(detail)) return detail.message;
  }
  return error.message;
}

/**
 * The question changed elsewhere (answered, skipped or dismissed in another tab, or its last
 * answer is still being applied): fetch the CV again, so the card shows where it stands now.
 */
export function refetchIfQuestionChanged(queryClient: QueryClient, cvId: string, error: unknown) {
  if (
    error instanceof ApiError &&
    (error.code === 'QUESTION_CLOSED' || error.code === 'QUESTION_BUSY')
  ) {
    void queryClient.invalidateQueries({ queryKey: cvKeys.detail(cvId) });
  }
}

/**
 * Follows the CV's answer updates while any is pending or running, through their jobs (a cheap
 * request), and fetches the CV again whenever one finishes, with the changes it made.
 */
export function useQuestionUpdates(cv: CvDetail | undefined) {
  const queryClient = useQueryClient();
  const jobIds = (cv?.questions ?? [])
    .filter(isUpdating)
    .flatMap((question) => (question.update ? [question.update.jobId] : []));
  const finished = useQueries({
    queries: jobIds.map((jobId) => ({
      queryKey: generationKeys.job(jobId),
      queryFn: () => api.get<GenerationJobDto>(`/generation-jobs/${jobId}`),
      refetchInterval: (query: { state: { data?: GenerationJobDto } }) => {
        const status = query.state.data?.status;
        return status && isTerminalJobStatus(status) ? false : JOB_POLL_MS;
      },
    })),
    combine: (results) =>
      results
        .flatMap((result) =>
          result.data && isTerminalJobStatus(result.data.status) ? [result.data.id] : [],
        )
        .join(','),
  });

  const cvId = cv?.id;
  useEffect(() => {
    if (finished && cvId) void queryClient.invalidateQueries({ queryKey: cvKeys.detail(cvId) });
  }, [finished, cvId, queryClient]);
}

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
