import { createBrowserRouter } from 'react-router';
import { LoginPage } from '../features/auth/LoginPage';
import { SignUpPage } from '../features/auth/SignUpPage';
import { ClarifyPage } from '../features/clarify/ClarifyPage';
import { CreateCvPage, EditCvPage } from '../features/cvs/create/CreateCvPage';
import { CvListPage } from '../features/cvs/dashboard/CvListPage';
import { CvStatusPage } from '../features/cvs/status/CvStatusPage';
import { CvEditorPage } from '../features/editor/CvEditorPage';
import { CvPreviewPage } from '../features/preview/CvPreviewPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { AppLayout } from './AppLayout';
import { GuestOnly } from './GuestOnly';
import { RequireAuth } from './RequireAuth';
import { RouteError } from './RouteError';

export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      {
        // Log in and Sign up share one frame: switching between them keeps the aside in place.
        element: <GuestOnly />,
        children: [
          { path: '/login', element: <LoginPage /> },
          { path: '/signup', element: <SignUpPage /> },
        ],
      },
      {
        // Everything else needs a session, "page not found" included.
        element: <RequireAuth />,
        children: [
          {
            path: '/',
            element: <AppLayout />,
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
                  // After generation: the AI's questions, then the editor.
                  { path: 'cvs/:cvId/questions', element: <ClarifyPage /> },
                  { path: 'cvs/:cvId/editor', element: <CvEditorPage /> },
                  // The CV at full size, and its PDF.
                  { path: 'cvs/:cvId/preview', element: <CvPreviewPage /> },
                  { path: '*', element: <NotFoundPage /> },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
]);
