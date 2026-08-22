/**
 * Zero-flicker spatial route transitions.
 *
 * The problem this solves: with lazy routes, every navigation used to blank the
 * screen to a skeleton, then blank again as the real page mounted. Two flashes
 * per tap. The fix has three parts:
 *
 *   1. **The background never unmounts.** `ParticleField` lives outside the
 *      routed subtree, so the atmosphere is continuous across routes and the
 *      screen is never actually empty — only the content layer changes.
 *   2. **Depth, not sliding.** Screens rise through depth rather than sliding
 *      sideways, which preserves the sense that they occupy different depths of
 *      one space.
 *   3. **Liquid skeletons.** The Suspense fallback is a flowing shimmer that
 *      shares the page's shape, so the swap to real content is a fill rather
 *      than a replacement.
 *
 * Performance: the particle field is CSS transforms on a handful of nodes, not
 * a canvas. It costs no JavaScript per frame and no GPU context, which matters
 * because it is the one thing on screen that is always running.
 */

import React, { useMemo } from 'react';
import { useLocation } from 'react-router-dom';

import { cn } from '../../lib/utils';
import { prefersReducedMotion } from '../../lib/motion';

// ---------------------------------------------------------------------------
// Atmosphere
// ---------------------------------------------------------------------------

interface Particle {
  left: number;
  top: number;
  size: number;
  delay: number;
  duration: number;
  tone: string;
}

/**
 * Persistent volumetric dust.
 *
 * Deterministic rather than random: a fixed field means the atmosphere does not
 * visibly reshuffle when React re-renders, and it looks identical every launch.
 */
const buildField = (count: number): Particle[] => {
  const out: Particle[] = [];
  // Cheap deterministic hash — no dependency, stable across reloads.
  let seed = 0x9e3779b9;
  const rand = () => {
    seed ^= seed << 13;
    seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return seed / 0xffffffff;
  };
  for (let i = 0; i < count; i++) {
    const r = rand();
    out.push({
      left: rand() * 100,
      top: rand() * 100,
      size: 1 + rand() * 2.5,
      delay: rand() * 8,
      duration: 14 + rand() * 16,
      tone: r > 0.72 ? 'rgba(0,245,255,0.5)' : r > 0.35 ? 'rgba(204,255,0,0.42)' : 'rgba(255,255,255,0.28)',
    });
  }
  return out;
};

export const ParticleField: React.FC<{ density?: number; className?: string }> = ({
  density = 26,
  className,
}) => {
  const reduced = prefersReducedMotion();
  const particles = useMemo(() => buildField(reduced ? 10 : density), [density, reduced]);

  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none fixed inset-0 overflow-hidden', className)}
      style={{ zIndex: 0 }}
    >
      {/* Volumetric wash — two static neon pools that give the void depth. */}
      <div
        className="absolute -top-1/4 left-1/2 -translate-x-1/2 w-[130vw] h-[60vh] rounded-full blur-[120px] opacity-[0.5]"
        style={{ background: 'radial-gradient(circle, rgba(204,255,0,0.08) 0%, transparent 65%)' }}
      />
      <div
        className="absolute -bottom-1/4 left-1/2 -translate-x-1/2 w-[120vw] h-[55vh] rounded-full blur-[130px] opacity-[0.45]"
        style={{ background: 'radial-gradient(circle, rgba(0,245,255,0.07) 0%, transparent 65%)' }}
      />

      {particles.map((p, i) => (
        <span
          key={i}
          className={reduced ? 'absolute rounded-full' : 'absolute rounded-full ff-drift'}
          style={{
            left: `${p.left}%`,
            top: `${p.top}%`,
            width: p.size,
            height: p.size,
            background: p.tone,
            boxShadow: `0 0 ${p.size * 3}px ${p.tone}`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

/**
 * Liquid loading state. Shaped like a real screen — eyebrow, title, hero card,
 * a stat pair, a list — so the transition to actual content is a fill rather
 * than a re-layout.
 */
export const LiquidSkeleton: React.FC = () => (
  <div className="pb-32 pt-6 px-4 space-y-5" role="status" aria-label="Loading">
    <div className="space-y-2">
      <div className="liquid-skeleton h-3 w-24 rounded-full" />
      <div className="liquid-skeleton h-8 w-52 rounded-xl" />
    </div>
    <div className="liquid-skeleton h-44 rounded-[28px]" />
    <div className="grid grid-cols-2 gap-3">
      <div className="liquid-skeleton h-28 rounded-[24px]" />
      <div className="liquid-skeleton h-28 rounded-[24px]" />
    </div>
    <div className="liquid-skeleton h-36 rounded-[28px]" />
    <span className="sr-only">Loading</span>
  </div>
);

// ---------------------------------------------------------------------------
// Transition shell
// ---------------------------------------------------------------------------

/**
 * Wraps the routed content. Keyed on pathname, so React replaces the node on
 * every navigation and the CSS enter animation replays.
 *
 * **Why CSS and not AnimatePresence.** The obvious implementation wraps this in
 * `<AnimatePresence>` and gets a proper exit animation. It also drags the
 * animation library (~42 kB gzipped) onto the boot path — a 25% increase in
 * critical-path JavaScript for every cold start, to animate a screen the user
 * has not navigated away from yet. `proof:perf` fails the build when that
 * happens, and it did on the first attempt here.
 *
 * The compromise is deliberate and, on a phone, nearly invisible: the outgoing
 * screen is replaced immediately while the incoming one rises through depth
 * over the persistent particle field. Because the atmosphere never unmounts,
 * there is no blank frame between routes — which was the actual problem an exit
 * animation would have been solving. In-page motion still uses the full library;
 * it lives in lazy route chunks where it costs nothing at boot.
 *
 * Depth comes from the `perspective()` function inside the keyframe transform,
 * NOT from a `perspective` property on the container — see the comment on the
 * wrapper below for why that distinction is load-bearing.
 */
export const SpatialPageTransition: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const reduced = prefersReducedMotion();

  return (
    // NO `perspective` on this wrapper. Like `transform`, the `perspective`
    // property makes an element the CONTAINING BLOCK for every
    // `position: fixed` descendant — which meant every modal in the app (water
    // picker, edit profile, permissions sheet, scanner) was sized against this
    // wrapper instead of the viewport, and opened far below the fold on any
    // long page. The user taps, the modal mounts, nothing appears to happen.
    //
    // The depth effect is unaffected: the `ff-spatial-enter` keyframes already
    // carry their own `perspective(1400px)` inside the transform function, so
    // rotateX still has real depth rather than flattening into a squash.
    <div className="relative">
      <main
        key={location.pathname}
        // `relative` WITHOUT a z-index on purpose. `z-10` here created a
        // stacking context, which trapped every nested modal's `z-[100]` at
        // root level 10 — underneath the FloatingDock at `z-[60]`. That is why
        // the dock and the camera button painted on top of open sheets and ate
        // their buttons. With `z-index: auto` this element no longer forms a
        // context, so a modal's z-100 competes with the dock directly and wins.
        //
        // It still paints above ParticleField, which is `z-index: 0` and comes
        // earlier in DOM order.
        className={cn('relative', !reduced && 'spatial-enter')}
        style={{ transformOrigin: '50% 20%' }}
      >
        {children}
      </main>
    </div>
  );
};
