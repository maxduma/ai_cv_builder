// Global styles first, so the feature styles that components import come later in the cascade.
import './index.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { router } from './app/router';
import { sessionKey } from './features/auth/api';
import { setUnauthorizedHandler } from './lib/api-client';
import { queryClient } from './lib/query-client';

// A request refused for want of a session signs the user out here; `RequireAuth` then opens the
// login page. Nothing is refetched or navigated from this handler, so a 401 can't start a loop.
setUnauthorizedHandler(() => queryClient.setQueryData(sessionKey, null));

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
