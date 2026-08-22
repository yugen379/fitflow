/**
 * Animated water drop for the hydration sheet.
 *
 * Fills the dead space above the bottom sheet with something that actually
 * carries the number: a teardrop that holds liquid to `currentMl / goalMl`,
 * with a live surface, a splash on each add, and a celebration at goal.
 *
 * ## How the liquid is clipped
 *
 * The fill is a real `<clipPath>` of the teardrop outline, not a rectangle
 * cropped to look like one — so the liquid narrows into the point of the drop
 * as it empties and widens through the belly, which is the whole reason this
 * reads as a container rather than a progress bar.
 *
 * ## Why the waves are SVG/CSS and not JS
 *
 * The two wave layers are a single path each, translated on a CSS keyframe at
 * slightly different speeds and amplitudes. The interference between them is
 * what stops the surface looking like a metronome. Nothing redraws per frame in
 * JavaScript: the compositor owns it, which is what keeps it smooth on a phone.
 *
 * `motion` (v12, already a dependency — this adds no packages) drives only the
 * things that need physics: the fill height spring, the splash rings and the
 * goal bounce.
 *
 * ## Interruption safety
 *
 * The fill is a `motion` spring on a single target value derived from props. Tap
 * four buttons quickly and the spring simply retargets each time, animating from
 * wherever it currently is to the latest cumulative total. Nothing queues, so
 * nothing can stack or glitch.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from 'motion/react';

import { cn } from '../lib/utils';
import { haptic } from '../lib/haptics';
import { AnimatedNumber } from './AnimatedNumber';
import { prefersReducedMotion } from '../lib/motion';

export interface HydrationDropProps {
  /** Millilitres logged so far today. */
  currentMl: number;
  /** Daily target in millilitres. */
  goalMl: number;
  /** Quick-add amounts to offer. Ignored when `showPresets` is false. */
  presets?: number[];
  /**
   * Render the quick-add row inside the component.
   *
   * Off when the drop is placed away from the controls — the Home sheet keeps
   * its own buttons and floats the drop in the space above. The splash does not
   * depend on this: it fires on `currentMl` INCREASING, so it works whoever
   * owns the button.
   */
  showPresets?: boolean;
  /** Called with the amount to add. The parent owns the state. */
  onAdd?: (amount: number) => void;
  className?: string;
}

/**
 * The teardrop outline, in a 0 0 100 140 viewBox.
 *
 * A classic drop: a point at the top, shoulders that flare out, and a circular
 * belly. Drawn once and referenced by the clip path, the stroke and the glow so
 * the three can never drift apart.
 */
const DROP_PATH =
  'M50 4 C50 4 14 52 14 84 a36 36 0 0 0 72 0 C86 52 50 4 50 4 Z';

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

interface Splash {
  id: number;
  /** Surface height, in viewBox units from the top. */
  y: number;
}

export const HydrationDrop: React.FC<HydrationDropProps> = ({
  currentMl,
  goalMl,
  presets = [100, 250, 500, 750],
  showPresets = true,
  onAdd,
  className,
}) => {
  const reduced = prefersReducedMotion();
  const ratio = goalMl > 0 ? clamp01(currentMl / goalMl) : 0;
  const atGoal = ratio >= 1;

  // Unique per instance: two drops on one page must not share SVG ids, or the
  // second silently inherits the first's clip path.
  const uid = useMemo(() => `hd-${Math.random().toString(36).slice(2, 9)}`, []);

  // Single spring, retargeted on every change — this is what makes rapid taps
  // safe. `useSpring` animates from its CURRENT value, so an interrupted rise
  // continues rather than restarting.
  const level = useMotionValue(reduced ? ratio : 0);
  const smooth = useSpring(level, { stiffness: 120, damping: 20, mass: 0.9 });
  useEffect(() => {
    level.set(ratio);
  }, [ratio, level]);

  // The liquid is a rect whose TOP edge moves; the clip path does the shaping.
  // 140 = viewBox height. y goes from 140 (empty) to 0 (full).
  const surfaceY = useTransform(smooth, (v) => 140 - clamp01(v) * 140);
  const rectHeight = useTransform(smooth, (v) => clamp01(v) * 140 + 2);

  const [splashes, setSplashes] = useState<Splash[]>([]);
  const [pulsing, setPulsing] = useState(false);
  const splashId = useRef(0);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Celebrate only on the TRANSITION into goal, never on every re-render once
  // the user is already over target.
  const wasAtGoal = useRef(atGoal);
  const [celebrating, setCelebrating] = useState(false);
  useEffect(() => {
    if (atGoal && !wasAtGoal.current) {
      setCelebrating(true);
      void haptic('medium');
      const t = setTimeout(() => setCelebrating(false), 1400);
      return () => clearTimeout(t);
    }
    wasAtGoal.current = atGoal;
  }, [atGoal]);

  useEffect(
    () => () => {
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
    },
    [],
  );

  /**
   * Splash on the VALUE going up, not on the button press.
   *
   * Driving it from the prop means the effect is correct however the water was
   * added — this component's own presets, the sheet's buttons, or a sync from
   * another device — and it can never fire for an add that was rejected.
   */
  const previousMl = useRef(currentMl);
  useEffect(() => {
    const rose = currentMl > previousMl.current;
    previousMl.current = currentMl;
    if (!rose || reduced) return;

    const id = ++splashId.current;
    // Land the rings on the surface the liquid is rising TO.
    setSplashes((prev) => [...prev.slice(-2), { id, y: 140 - ratio * 140 }]);
    const clear = setTimeout(() => setSplashes((prev) => prev.filter((s) => s.id !== id)), 900);

    setPulsing(true);
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
    pulseTimer.current = setTimeout(() => setPulsing(false), 700);

    return () => clearTimeout(clear);
  }, [currentMl, ratio, reduced]);

  const handleAdd = (amount: number) => {
    void haptic('light');
    onAdd?.(amount);
  };

  return (
    <div className={cn('flex flex-col items-center', className)}>
      <motion.div
        className="relative"
        animate={celebrating && !reduced ? { scale: [1, 1.08, 0.97, 1] } : { scale: 1 }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Glow behind the drop. Blurred and pointer-events-none, so it never
            intercepts a tap meant for the buttons underneath. */}
        <motion.div
          aria-hidden="true"
          className="absolute inset-0 rounded-full blur-2xl pointer-events-none"
          style={{ background: atGoal ? 'rgba(204,255,0,0.30)' : 'rgba(0,180,255,0.28)' }}
          animate={{ opacity: pulsing ? 0.95 : 0.4, scale: pulsing ? 1.12 : 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 18 }}
        />

        <svg
          viewBox="0 0 100 140"
          className="relative w-40 h-56 sm:w-44 sm:h-60"
          role="img"
          aria-label={`Hydration: ${Math.round(currentMl)} of ${goalMl} millilitres`}
        >
          <defs>
            {/* The clip that makes the liquid take the drop's shape. */}
            <clipPath id={`${uid}-clip`}>
              <path d={DROP_PATH} />
            </clipPath>

            <linearGradient id={`${uid}-liquid`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={atGoal ? '#D9FF6B' : '#7FD8FF'} />
              <stop offset="55%" stopColor={atGoal ? '#B4F02A' : '#22A7E8'} />
              <stop offset="100%" stopColor={atGoal ? '#7FB000' : '#0B5C96'} />
            </linearGradient>

            <linearGradient id={`${uid}-glass`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="rgba(255,255,255,0.16)" />
              <stop offset="60%" stopColor="rgba(255,255,255,0.03)" />
            </linearGradient>
          </defs>

          {/* Empty container: low-opacity fill + subtle stroke. */}
          <path d={DROP_PATH} fill={`url(#${uid}-glass)`} />

          <g clipPath={`url(#${uid}-clip)`}>
            {/* Body of the liquid. */}
            <motion.rect
              x="-50"
              width="200"
              style={{ y: surfaceY, height: rectHeight }}
              fill={`url(#${uid}-liquid)`}
            />

            {/* Two wave layers at different speeds. Each path is one full period
                repeated, twice as wide as the viewBox, so translating it by
                exactly one period loops seamlessly. */}
            <motion.g style={{ y: surfaceY }}>
              <g className={reduced ? undefined : 'ff-wave-a'}>
                <path
                  d="M-100 0 q 25 -8 50 0 t 50 0 t 50 0 t 50 0 t 50 0 v 40 h -300 z"
                  fill={atGoal ? '#C6F53C' : '#3FBDF0'}
                  opacity="0.95"
                />
              </g>
              <g className={reduced ? undefined : 'ff-wave-b'}>
                <path
                  d="M-100 2 q 30 6 60 0 t 60 0 t 60 0 t 60 0 v 40 h -300 z"
                  fill={atGoal ? '#E4FF8F' : '#8AE0FF'}
                  opacity="0.45"
                />
              </g>
            </motion.g>

            {/* Splash rings, clipped so they break against the drop wall. */}
            <AnimatePresence>
              {splashes.map((s) => (
                <React.Fragment key={s.id}>
                  <motion.circle
                    cx="50"
                    cy={s.y}
                    initial={{ r: 2, opacity: 0.9 }}
                    animate={{ r: 34, opacity: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                    fill="none"
                    stroke="rgba(255,255,255,0.85)"
                    strokeWidth="2"
                  />
                  <motion.circle
                    cx="50"
                    cy={s.y}
                    initial={{ r: 1, opacity: 0.7 }}
                    animate={{ r: 20, opacity: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.55, ease: 'easeOut', delay: 0.08 }}
                    fill="none"
                    stroke="rgba(255,255,255,0.6)"
                    strokeWidth="1.5"
                  />
                </React.Fragment>
              ))}
            </AnimatePresence>
          </g>

          {/* Outline last, so it sits cleanly over the liquid. */}
          <path
            d={DROP_PATH}
            fill="none"
            stroke={atGoal ? 'rgba(204,255,0,0.75)' : 'rgba(255,255,255,0.28)'}
            strokeWidth="1.5"
          />
        </svg>

        {/* The number lives in the DOM, not the SVG: crisp at any density and
            readable by a screen reader without describing geometry. */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <p className="num text-3xl font-bold text-white tabular-nums leading-none drop-shadow-[0_2px_8px_rgba(0,0,0,0.55)]">
            <AnimatedNumber value={Math.round(currentMl)} fromZero={false} />
          </p>
          <p className="text-[11px] text-white/75 mt-1 drop-shadow-[0_1px_6px_rgba(0,0,0,0.6)]">
            of {goalMl.toLocaleString()} ml
          </p>
          {atGoal ? (
            <span className="text-eyebrow text-accent mt-1.5 drop-shadow-[0_1px_6px_rgba(0,0,0,0.6)]">
              Goal complete
            </span>
          ) : null}
        </div>
      </motion.div>

      {showPresets ? (
      <div className="grid grid-cols-4 gap-2 w-full mt-5">
        {presets.map((ml) => (
          <button
            key={ml}
            type="button"
            onClick={() => handleAdd(ml)}
            className="glass p-3 flex flex-col items-center gap-1 hover:border-accent-3/30 active:scale-95 transition-all"
          >
            <span className="num font-display text-lg font-bold text-white">{ml}</span>
            <span className="text-[10px] text-text-dim font-medium">ml</span>
          </button>
        ))}
      </div>
      ) : null}
    </div>
  );
};

export default HydrationDrop;
