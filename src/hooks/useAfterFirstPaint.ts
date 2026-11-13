import { startTransition, useEffect, useState } from 'react';

/**
 * False for the first render, true just after that frame has been painted.
 *
 * For content below the fold that is expensive to build: the screen appears
 * first, then the rest fills in at low priority, so it can't hold up the tap
 * that opened the page. Stays true once set, including across a hidden tab.
 */
export const useAfterFirstPaint = (): boolean => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (ready) return;
    let timer = 0;
    // rAF runs before the paint; the timeout lands after it.
    const frame = requestAnimationFrame(() => {
      timer = window.setTimeout(() => startTransition(() => setReady(true)), 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [ready]);
  return ready;
};
