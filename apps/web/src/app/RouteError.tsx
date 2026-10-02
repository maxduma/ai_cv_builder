import { isRouteErrorResponse, Link, useRouteError } from 'react-router';

export function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'An unexpected error occurred.';

  return (
    <div role="alert" className="mx-auto max-w-3xl p-4">
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-900">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-1 text-sm break-words">{message}</p>
        <Link
          to="/"
          className="mt-3 inline-flex min-h-11 items-center text-sm font-medium underline"
        >
          Back to my CVs
        </Link>
      </div>
    </div>
  );
}
