import { createBrowserRouter } from 'react-router';
import { CreateCvPage, EditCvPage } from '../features/cvs/create/CreateCvPage';
import { CvListPage } from '../features/cvs/dashboard/CvListPage';
import { CvStatusPage } from '../features/cvs/status/CvStatusPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { AppLayout } from './AppLayout';
import { RouteError } from './RouteError';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    errorElement: <RouteError />,
    children: [
      {
        // Page errors render inside the layout, so navigation stays available.
        errorElement: <RouteError />,
        children: [
          { index: true, element: <CvListPage /> },
          { path: 'cvs/new', element: <CreateCvPage /> },
          // A CV's own page: generation progress, failure or "ready".
          { path: 'cvs/:cvId', element: <CvStatusPage /> },
          // The form again, for a draft or after a failed generation.
          { path: 'cvs/:cvId/edit', element: <EditCvPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
