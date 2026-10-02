import { Link, Outlet } from 'react-router';
import { AiNotice, ApiStatus } from '../features/health/ApiStatus';

/** Page chrome: sticky header plus a single centred, mobile-first content column. */
export function AppLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-3 px-4">
          <Link
            to="/"
            className="flex min-h-11 items-center gap-2 rounded-md font-semibold tracking-tight"
          >
            <img src="/favicon.svg" alt="" className="size-6" />
            <span className="truncate">AI CV Builder</span>
          </Link>
          <ApiStatus />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <AiNotice />
        <Outlet />
      </main>
    </div>
  );
}
