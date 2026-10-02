import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api-client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Client errors (4xx) won't succeed on retry; network and server errors might.
      retry: (failureCount, error) => {
        const isClientError =
          error instanceof ApiError && error.status >= 400 && error.status < 500;
        return !isClientError && failureCount < 2;
      },
    },
  },
});
