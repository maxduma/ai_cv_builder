import type { CreateCvRequest, CvDetail, CvListResponse } from '@cv-builder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api-client';

const cvKeys = {
  all: ['cvs'] as const,
};

export function useCvs() {
  return useQuery({
    queryKey: cvKeys.all,
    queryFn: () => api.get<CvListResponse>('/cvs'),
  });
}

export function useCreateCv() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCvRequest) => api.post<CvDetail>('/cvs', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: cvKeys.all }),
  });
}
