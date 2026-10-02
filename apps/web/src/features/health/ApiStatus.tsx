import { ApiError } from '../../lib/api-client';
import { useHealth } from './useHealth';

const STATUS_STYLES = {
  checking: { label: 'Checking…', dot: 'bg-slate-400' },
  online: { label: 'Online', dot: 'bg-emerald-500' },
  databaseDown: { label: 'Database down', dot: 'bg-amber-500' },
  offline: { label: 'API offline', dot: 'bg-red-500' },
} as const;

/** Small pill in the header showing whether the backend (and its database) is reachable. */
export function ApiStatus() {
  const { data, error, isPending } = useHealth();

  const status = isPending
    ? 'checking'
    : data
      ? 'online'
      : error instanceof ApiError && error.status === 503
        ? 'databaseDown'
        : 'offline';
  const { label, dot } = STATUS_STYLES[status];

  return (
    <span
      role="status"
      className="inline-flex shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700"
    >
      <span className={`size-2 rounded-full ${dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}

const codeClassName = 'rounded bg-amber-100 px-1 whitespace-nowrap';

/** Explains why AI features are unavailable when the API reports a missing API key. */
export function AiNotice() {
  const { data } = useHealth();
  if (data?.checks.ai.status !== 'not_configured') {
    return null;
  }

  return (
    <div
      role="note"
      className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <p className="font-medium">AI generation is not configured</p>
      <p className="mt-1">
        Set <code className={codeClassName}>ANTHROPIC_API_KEY</code> in{' '}
        <code className={codeClassName}>.env</code> and run{' '}
        <code className={codeClassName}>docker compose up -d</code>.
      </p>
    </div>
  );
}
