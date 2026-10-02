import { useSyncExternalStore } from 'react';

interface Clock {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => number;
}

// One shared timer per interval, however many components read the clock.
const clocks = new Map<number, Clock>();

function createClock(intervalMs: number): Clock {
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let now = Date.now();

  return {
    subscribe(onChange) {
      listeners.add(onChange);
      if (!timer) {
        // The clock may have been idle for a while; React re-reads the snapshot after subscribing.
        now = Date.now();
        timer = setInterval(() => {
          now = Date.now();
          listeners.forEach((listener) => listener());
        }, intervalMs);
      }
      return () => {
        listeners.delete(onChange);
        if (listeners.size === 0) {
          clearInterval(timer);
          timer = undefined;
        }
      };
    },
    getSnapshot: () => now,
  };
}

/**
 * The current time in milliseconds, refreshed every `intervalMs`. Components must not read the
 * clock while rendering, so time-based UI ("2 hours ago", elapsed time) reads it from here.
 */
export function useNow(intervalMs: number): number {
  let clock = clocks.get(intervalMs);
  if (!clock) {
    clock = createClock(intervalMs);
    clocks.set(intervalMs, clock);
  }
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot);
}
