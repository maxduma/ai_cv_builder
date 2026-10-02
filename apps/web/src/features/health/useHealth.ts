import type { HealthResponse } from '@cv-builder/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api-client';

/** Polls the API health endpoint. A 503 (database down) surfaces as an `ApiError` with status 503. */
export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<HealthResponse>('/health'),
    refetchInterval: 15_000,
    retry: false,
  });
}
