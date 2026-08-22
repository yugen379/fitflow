/**
 * Determinate loading bar, matching the boot splash.
 *
 * Replaces the spinning rings the app used for every "wait here" state. A
 * spinner says only "something is happening"; a bar with a number says how far
 * along it is, which is the difference between waiting and wondering whether it
 * has hung.
 *
 * ## Honesty about the number
 *
 * Some waits have real progress — the boot preloader knows how many chunks have
 * landed — and those pass `progress` directly.
 *
 * Most do not. Waiting on Firestore is one round trip with no byte-level
 * feedback, so there is nothing truthful to count. Rather than fake precision,
 * the estimated mode advances on an ASYMPTOTIC curve: fast at first, slowing as
 * it goes, approaching but never reaching CEILING until the work actually
 * finishes. It cannot claim 100% before something is done, and it cannot stall
 * at a number that looks frozen.
 *
 * This is the same approach browsers use for their own page-load bars, and for
 * the same reason: the alternative is either a lie or a spinner.
 */

import React, { useEffect, useRef, useState } from 'react';

import { cn } from '../lib/utils';
import { prefersReducedMotion } from '../lib/motion';

export interface LoadingBarProps {
  /** Real progress 0..100. Omit for a time-estimated bar. */
  progress?: number;
  /** Text above the bar. */
  label?: string;
  /** Show the numeric percentage. */
  showPercent?: boolean;
  /** Fill the viewport (auth/boot) rather than sitting in a block. */
  fullScreen?: boolean;
  className?: string;
}

/**
 * How far an estimated bar may climb on its own. It must never reach 100 while
 * work is outstanding, or the bar completes and the screen still does not.
 */
const CEILING = 92;

/** Seconds for the estimate to cover most of its range. */
const TIME_CONSTANT_MS = 2200;

export const LoadingBar: React.FC<LoadingBarProps> = ({
  progress,
  label = 'Loading',
  showPercent = true,
  fullScreen = false,
  className,
}) => {
  const isControlled = typeof progress === 'number' && Number.isFinite(progress);
  const [estimated, setEstimated] = useState(0);
  const startedAt = useRef(Date.now());
  const reduced = prefersReducedMotion();

  useEffect(() => {
    if (isControlled) return;
    startedAt.current = Date.now();

    // Exponential approach: p = CEILING * (1 - e^(-t/T)). Frequent enough to
    // look alive, slow enough (100ms) that it costs nothing on a phone.
    const tick = () => {
      const elapsed = Date.now() - startedAt.current;
      setEstimated(CEILING * (1 - Math.exp(-elapsed / TIME_CONSTANT_MS)));
    };
    tick();
    const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [isControlled]);

  const value = Math.max(0, Math.min(100, isControlled ? (progress as number) : estimated));
  const rounded = Math.round(value);

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3',
        fullScreen && 'h-screen w-screen bg-bg',
        className,
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
      // The bar is decorative to a screen reader; the label carries the meaning.
      aria-label={`${label}, ${rounded} percent`}
    >
      <span className="w-32 h-[3px] rounded-full bg-white/[0.08] overflow-hidden" aria-hidden="true">
        <span
          className="block h-full rounded-full"
          style={{
            width: `${rounded}%`,
            background: 'linear-gradient(90deg, #CCFF00 0%, #D4FF00 60%, #00F5FF 100%)',
            transition: reduced ? 'none' : 'width 220ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
      </span>

      {showPercent ? (
        <p className="num text-[11px] font-bold text-accent tabular-nums tracking-[0.04em]">
          {rounded >= 100 ? 'Ready' : `${label} ${rounded}%`}
        </p>
      ) : (
        <p className="text-[11px] text-text-dim font-medium">{label}</p>
      )}
    </div>
  );
};

export default LoadingBar;
