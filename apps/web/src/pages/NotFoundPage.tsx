import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="py-12 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-slate-600">The page you are looking for doesn't exist.</p>
      <Link
        to="/"
        className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-indigo-600 px-4 font-medium text-white hover:bg-indigo-500"
      >
        Back to my CVs
      </Link>
    </div>
  );
}
