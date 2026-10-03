import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from 'react';
import { CheckIcon } from './icons';

/** How long the design keeps a confirmation up, and how long its exit takes. */
const SHOWN_MS = 6_000;
const LEAVE_MS = 180;

/**
 * A confirmation at the bottom of the page, like "Deleted “Software Engineer”". It stays six
 * seconds, longer while the pointer or focus is on it, then leaves and calls `onDone`. Give it a
 * new `key` for a new message, which starts the six seconds again.
 */
export function Toast({ children, onDone }: { children: ReactNode; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The parent's callback may be a new function every render; that mustn't restart the exit.
  const done = useEffectEvent(onDone);

  const hold = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const restart = () => {
    hold();
    timer.current = setTimeout(() => setLeaving(true), SHOWN_MS);
  };

  useEffect(() => {
    const handle = setTimeout(() => setLeaving(true), SHOWN_MS);
    timer.current = handle;
    return () => {
      clearTimeout(handle);
      // A timer restarted by the pointer leaving belongs to this toast too.
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const handle = setTimeout(() => done(), LEAVE_MS);
    return () => clearTimeout(handle);
  }, [leaving]);

  return (
    <div
      className={leaving ? 'toast is-note is-leaving' : 'toast is-note'}
      onMouseEnter={hold}
      onMouseLeave={restart}
      onFocus={hold}
      onBlur={restart}
    >
      <span className="toast-ico is-success" aria-hidden="true">
        <CheckIcon />
      </span>
      <p className="toast-text">{children}</p>
    </div>
  );
}
