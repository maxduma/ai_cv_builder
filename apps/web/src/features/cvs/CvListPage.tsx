import type { CvSummary } from '@cv-builder/shared';
import { useCvs } from './api';
import { CreateCvForm } from './CreateCvForm';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function CvListPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My CVs</h1>
        <p className="mt-1 text-sm text-slate-600">
          Create a CV for the role you are targeting. AI-powered generation is coming soon.
        </p>
      </div>

      <CreateCvForm />

      <section aria-labelledby="cv-list-heading">
        <h2 id="cv-list-heading" className="sr-only">
          Your CVs
        </h2>
        <CvList />
      </section>
    </div>
  );
}

function CvList() {
  const { data, error, isPending, refetch } = useCvs();

  if (isPending) {
    return <p className="text-sm text-slate-500">Loading your CVs…</p>;
  }

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
      >
        <p>Could not load your CVs: {error.message}</p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-2 min-h-11 font-medium underline"
        >
          Try again
        </button>
      </div>
    );
  }

  if (data.items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        No CVs yet. Create your first one above.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
      {data.items.map((cv) => (
        <CvListItem key={cv.id} cv={cv} />
      ))}
    </ul>
  );
}

function CvListItem({ cv }: { cv: CvSummary }) {
  return (
    <li className="p-4">
      <p className="font-medium break-words">{cv.title}</p>
      {cv.targetRole && (
        <p className="mt-0.5 text-sm break-words text-slate-600">{cv.targetRole}</p>
      )}
      <p className="mt-1 text-xs text-slate-500">
        Updated <time dateTime={cv.updatedAt}>{dateFormat.format(new Date(cv.updatedAt))}</time>
      </p>
    </li>
  );
}
