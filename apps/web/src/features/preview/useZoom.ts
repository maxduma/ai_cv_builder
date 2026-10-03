import { type RefObject, useLayoutEffect, useState } from 'react';

/** The design's zoom steps, and the page's width at 100% (A4 at 96 dpi). */
const LEVELS = [0.5, 0.75, 1, 1.25, 1.5];
const PAGE_WIDTH = 794;
/** Steps compare with a little slack: a fitted zoom is rounded to three decimals. */
const SLACK = 0.001;

/** The zoom that fits the page inside the desk, never above 100%. */
function fitOf(desk: HTMLElement): number {
  const style = getComputedStyle(desk);
  const width = desk.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  if (width <= 0) return 1;
  return Math.max(0.3, Math.min(1, Math.floor((width / PAGE_WIDTH) * 1000) / 1000));
}

/**
 * The preview's zoom: "Fit" (the default) follows the desk's width as the window changes; the
 * buttons step through 50–150%.
 */
export function useZoom(desk: RefObject<HTMLElement | null>) {
  const [fitted, setFitted] = useState(true);
  const [level, setLevel] = useState(1);
  const [fit, setFit] = useState(1);

  // Measured before paint, so the page doesn't show at 100% first.
  useLayoutEffect(() => {
    const element = desk.current;
    if (!element) return;
    const measure = () => setFit(fitOf(element));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [desk]);

  const zoom = fitted ? fit : level;

  /** The next step in `direction`, or `null` past the last one. */
  const stepTo = (direction: 1 | -1): number | null => {
    const next =
      direction > 0
        ? LEVELS.find((value) => value > zoom + SLACK)
        : LEVELS.findLast((value) => value < zoom - SLACK);
    if (next === undefined) return null;
    setFitted(false);
    setLevel(next);
    return next;
  };

  return {
    zoom,
    fitted,
    canZoomIn: zoom < LEVELS[LEVELS.length - 1]! - SLACK,
    canZoomOut: zoom > LEVELS[0]! + SLACK,
    zoomIn: () => stepTo(1),
    zoomOut: () => stepTo(-1),
    reset: () => {
      setFitted(false);
      setLevel(1);
    },
    fitToWindow: () => setFitted(true),
  };
}
