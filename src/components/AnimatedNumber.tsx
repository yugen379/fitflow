import React, { useEffect, useRef, useState } from 'react';

interface Props {
  value: number;
  /** Animation duration in ms. */
  duration?: number;
  /** Format the displayed integer (e.g. add commas). */
  format?: (n: number) => string;
  className?: string;
  /** Decimals to show — defaults to 0 (integer). */
  decimals?: number;
  /** Animate from zero on first mount (default true). */
  fromZero?: boolean;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Eased counter. Tweens whenever `value` changes.
 *
 * ## The interruption bug this exists to not have
 *
 * The origin of each tween is the value CURRENTLY ON SCREEN, tracked every
 * frame — not the last value that finished animating.
 *
 * The earlier version only committed the origin when a tween ran to completion.
 * That is fine for a number that changes once, and badly broken for one that
 * changes continuously: a live step count updates every step, which is far
 * faster than the 900 ms duration, so every tween was cancelled mid-flight and
 * the next one restarted from the same stale origin. On screen the step counter
 * crawled up from zero, got yanked back, and never reached the real number —
 * it looked like the count simply wasn't updating.
 *
 * Tracking the live displayed value means an interrupted tween just continues
 * from wherever it visually got to, which is also what looks right.
 */
export const AnimatedNumber: React.FC<Props> = ({
  value,
  duration = 900,
  format,
  className,
  decimals = 0,
  fromZero = true,
}) => {
  const [display, setDisplay] = useState<number>(fromZero ? 0 : value);
  /** What is on screen right now — the origin for the next tween. */
  const displayRef = useRef<number>(fromZero ? 0 : value);

  useEffect(() => {
    const from = displayRef.current;
    const to = Number.isFinite(value) ? value : 0;
    if (from === to) return;

    // A tiny change (one step landing) should not take the full duration, and a
    // large jump should not take forever. Scale, then clamp.
    const span = Math.abs(to - from);
    const scaled = Math.min(duration, Math.max(180, span * 12));

    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / scaled);
      const next = from + (to - from) * easeOutCubic(p);
      displayRef.current = next;
      setDisplay(next);
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        // Land exactly on the target rather than an eased approximation.
        displayRef.current = to;
        setDisplay(to);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  const rounded = decimals > 0 ? display.toFixed(decimals) : Math.round(display).toString();

  return <span className={className}>{format ? format(parseFloat(rounded)) : rounded}</span>;
};
