import { createBrowserRouter } from 'react-router';
import { CvListPage } from '../features/cvs/CvListPage';
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
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
