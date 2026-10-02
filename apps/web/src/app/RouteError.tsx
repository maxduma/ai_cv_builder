import { isRouteErrorResponse, Link, Navigate, useRouteError } from 'react-router';
import { ApiError } from '../lib/api-client';
import { NotFoundPage } from '../pages/NotFoundPage';
import { AlertCircleIcon, ArrowLeftIcon } from '../ui/icons';
import { StateIcon, StatePanel } from '../ui/StatePanel';
import './layout.css';

/** Shown when a route fails to render. Says what is safe and offers one way back. */
export function RouteError() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : undefined;

  // A page rethrew a 401: the session has ended, so the way on is logging in, not "Error 401".
  if (error instanceof ApiError && error.status === 401) {
    return <Navigate to="/login" replace />;
  }
  if (status === 404) {
    return <NotFoundPage />;
  }

  return (
    <main className="page-main">
      <title>Something went wrong · CV Builder</title>
      <StatePanel
        tone="error"
        headingLevel="h1"
        visual={
          <StateIcon tone="error">
            <AlertCircleIcon />
          </StateIcon>
        }
        title="Something went wrong"
        description="This page ran into an unexpected problem. Your CVs are safe — go back and try again."
        action={
          <Link to="/" className="btn btn-primary empty-cta">
            <ArrowLeftIcon />
            <span>Back to My CVs</span>
          </Link>
        }
        note={status ? `Error ${status}` : undefined}
      />
    </main>
  );
}
