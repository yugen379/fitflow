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
 * Spring-eased counter. Tweens any time `value` changes, never showing the
 * stale value mid-animation. Cheap — a single requestAnimationFrame loop.
 */
export const AnimatedNumber: React.FC<Props> = ({
  value,
  duration = 900,
  format,
  className,
  decimals = 0,
  fromZero = true,
}) => {
  const prevRef = useRef<number>(fromZero ? 0 : value);
  const [display, setDisplay] = useState<number>(fromZero ? 0 : value);

  useEffect(() => {
    const from = prevRef.current;
    const to = value;
    if (from === to) { setDisplay(to); return; }

    let raf: number;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = easeOutCubic(p);
      setDisplay(from + (to - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else prevRef.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  const rounded = decimals > 0
    ? display.toFixed(decimals)
    : Math.round(display).toString();

  return <span className={className}>{format ? format(parseFloat(rounded)) : rounded}</span>;
};
