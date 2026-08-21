/**
 * Motion and physics presets.
 *
 * One vocabulary for every animation in the app, so a card, a dock pill and a
 * 3D ring all settle with the same weight. Durations and springs are tuned for
 * a phone held in one hand: fast enough to feel immediate, slow enough that the
 * eye can follow where a thing came from.
 *
 * Springs are specified by stiffness/damping rather than duration because
 * spring motion is interruptible — a user can grab a card mid-flight and it
 * behaves sensibly. Duration-based tweens cannot do that.
 */

import type { Transition, Variants } from 'motion/react';

// ---------------------------------------------------------------------------
// Springs
// ---------------------------------------------------------------------------

export const SPRING = {
  /** Default for anything the user directly manipulates. */
  fluid: { type: 'spring', stiffness: 280, damping: 30, mass: 0.9 },
  /** Snappier — dock pills, toggles, small state flips. */
  snap: { type: 'spring', stiffness: 420, damping: 34, mass: 0.7 },
  /** Heavier, for large surfaces entering: sheets, panels, page bodies. */
  weighty: { type: 'spring', stiffness: 190, damping: 28, mass: 1.15 },
  /** Overshoots — celebratory only (PR badges, milestone reveals). */
  elastic: { type: 'spring', stiffness: 340, damping: 16, mass: 0.8 },
  /** Liquid settle: slow to start, long tail. Gauges and meniscus fills. */
  viscous: { type: 'spring', stiffness: 120, damping: 26, mass: 1.4 },
} satisfies Record<string, Transition>;

// ---------------------------------------------------------------------------
// Easings
// ---------------------------------------------------------------------------

/** The house curve. Fast out of the gate, long glide — reads as momentum. */
export const EASE_SPATIAL = [0.16, 1, 0.3, 1] as const;
/** Symmetric, for cross-fades where neither end should dominate. */
export const EASE_SOFT = [0.45, 0, 0.55, 1] as const;

export const DURATION = {
  /** Micro-interactions. Anything longer feels laggy on a tap. */
  instant: 0.14,
  quick: 0.22,
  base: 0.34,
  /** Page-level. Beyond this the user starts waiting on the app. */
  spatial: 0.48,
} as const;

// ---------------------------------------------------------------------------
// Page transitions
// ---------------------------------------------------------------------------

/**
 * Depth-based route change. The outgoing screen recedes and tilts away rather
 * than sliding, which keeps the sense that screens live at different depths in
 * one space instead of side by side on a strip.
 *
 * `rotateX` is deliberately tiny (4deg): enough to register as dimensional,
 * small enough that text never blurs through the transform.
 */
export const spatialPageVariants: Variants = {
  initial: { opacity: 0, scale: 0.94, rotateX: 4, y: 14 },
  animate: {
    opacity: 1,
    scale: 1,
    rotateX: 0,
    y: 0,
    transition: { ...SPRING.weighty, opacity: { duration: DURATION.base, ease: EASE_SPATIAL } },
  },
  exit: {
    opacity: 0,
    scale: 0.96,
    rotateX: -3,
    y: -10,
    // Exits run at ~65% of the enter duration: leaving should feel decisive.
    transition: { duration: DURATION.quick, ease: EASE_SPATIAL },
  },
};

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

/** Container that staggers its children in. Pair with `riseItem`. */
export const staggerContainer = (stagger = 0.045, delay = 0): Variants => ({
  initial: {},
  animate: { transition: { staggerChildren: stagger, delayChildren: delay } },
});

export const riseItem: Variants = {
  initial: { opacity: 0, y: 18, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: SPRING.fluid },
};

/** Cards that should feel like they surface out of the background. */
export const surfaceItem: Variants = {
  initial: { opacity: 0, y: 26, scale: 0.965, filter: 'blur(6px)' },
  animate: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', transition: SPRING.weighty },
};

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

/**
 * Press feedback. Scale only — never width/height/top/left, which would force
 * layout on every frame of the animation.
 */
export const pressable = {
  whileTap: { scale: 0.97 },
  transition: SPRING.snap,
} as const;

export const pressableSoft = {
  whileTap: { scale: 0.985 },
  transition: SPRING.snap,
} as const;

// ---------------------------------------------------------------------------
// Reduced motion
// ---------------------------------------------------------------------------

/**
 * Read once, synchronously. Components that build variants at render time need
 * the answer before the first frame, not from an effect a tick later.
 */
export const prefersReducedMotion = (): boolean => {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

/** Collapse any variant set to a plain cross-fade. */
export const stillVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.01 } },
  exit: { opacity: 0, transition: { duration: 0.01 } },
};
