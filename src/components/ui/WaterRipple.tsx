/**
 * Water-tap ripple.
 *
 * A radial wave that spawns at the exact contact point and expands out — the
 * physical cue that a surface registered your touch. Two details make it read
 * as liquid rather than as Material's ink ripple:
 *
 *   1. It starts at the pointer, not the centre. A ripple that always blooms
 *      from the middle reads as an animation; one that starts under the finger
 *      reads as a consequence.
 *   2. The radius is derived from the distance to the furthest corner, so the
 *      wave always reaches the edge of the surface no matter where you tap.
 *
 * Implementation notes that matter:
 *   • Nodes are removed on `animationend`, so a button tapped a hundred times
 *     holds zero extra DOM.
 *   • Ripples are appended to a `pointer-events: none` overlay, so they can
 *     never intercept the tap they were caused by.
 *   • Everything animates on transform/opacity — no layout, no paint storms.
 *   • Honours `prefers-reduced-motion` by not spawning at all.
 */

import React, { useCallback, useRef } from 'react';
import type { ButtonHTMLAttributes, PointerEvent as ReactPointerEvent, ReactNode } from 'react';

import { cn } from '../../lib/utils';
import { haptic } from '../../lib/haptics';

export type RippleTone = 'lime' | 'aqua' | 'coral' | 'amber';

/** Subset of lib/haptics' Strength that makes sense paired with a ripple. */
export type RippleHaptic = 'light' | 'medium' | 'heavy' | 'selection' | 'success';

interface RippleOptions {
  tone?: RippleTone;
  /** Fires a haptic pulse with the ripple, or `false` for silent surfaces. */
  haptics?: RippleHaptic | false;
}

interface WaterRippleProps extends RippleOptions {
  children: ReactNode;
  className?: string;
  /** Set when the wrapper itself should be the rounded surface. */
  rounded?: string;
}

/**
 * Imperative spawner, for surfaces that already own their pointer handlers
 * (the 3D viewport, custom gesture regions) and cannot wrap children.
 */
export const spawnRipple = (
  host: HTMLElement,
  clientX: number,
  clientY: number,
  tone: RippleTone = 'lime',
): void => {
  if (typeof window === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const rect = host.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  const x = clientX - rect.left;
  const y = clientY - rect.top;

  // Reach the furthest corner so the wave always clears the whole surface.
  const radius = Math.max(
    Math.hypot(x, y),
    Math.hypot(rect.width - x, y),
    Math.hypot(x, rect.height - y),
    Math.hypot(rect.width - x, rect.height - y),
  );
  const size = radius * 2;

  const node = document.createElement('span');
  node.className = 'ripple-effect';
  node.dataset.tone = tone;
  node.style.width = `${size}px`;
  node.style.height = `${size}px`;
  node.style.left = `${x - radius}px`;
  node.style.top = `${y - radius}px`;
  node.addEventListener('animationend', () => node.remove(), { once: true });
  host.appendChild(node);
};

/**
 * Wrapper that makes any subtree tappable-with-ripple.
 *
 * Renders a `<span>` rather than a `<div>` so it stays valid inside buttons and
 * anchors, which is where it is used most.
 */
export const WaterRipple: React.FC<WaterRippleProps> = ({
  children,
  className,
  rounded,
  tone = 'lime',
  haptics = 'light',
}) => {
  const hostRef = useRef<HTMLSpanElement | null>(null);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLSpanElement>) => {
      const host = hostRef.current;
      if (!host) return;
      if (haptics) void haptic(haptics);
      spawnRipple(host, event.clientX, event.clientY, tone);
    },
    [tone, haptics],
  );

  return (
    <span
      ref={hostRef}
      onPointerDown={onPointerDown}
      className={cn('relative inline-block overflow-hidden isolate', rounded, className)}
    >
      {children}
    </span>
  );
};

/**
 * Hook form, for components that render their own element and just want the
 * behaviour bolted on:
 *
 *   const { ref, onPointerDown } = useWaterRipple('aqua');
 *   <button ref={ref} onPointerDown={onPointerDown} className="relative overflow-hidden">
 */
export const useWaterRipple = <T extends HTMLElement = HTMLElement>(
  tone: RippleTone = 'lime',
  haptics: RippleHaptic | false = 'light',
) => {
  const ref = useRef<T | null>(null);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<T>) => {
      const host = ref.current;
      if (!host) return;
      if (haptics) void haptic(haptics);
      spawnRipple(host, event.clientX, event.clientY, tone);
    },
    [tone, haptics],
  );

  return { ref, onPointerDown };
};

// ---------------------------------------------------------------------------
// Primary CTA
// ---------------------------------------------------------------------------

interface GlowButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: RippleTone;
  /** Renders the quieter glass treatment instead of the full laser glow. */
  variant?: 'laser' | 'glass';
  fullWidth?: boolean;
}

const TONE_CLASS: Record<RippleTone, string> = {
  lime: '',
  aqua: 'glow-aqua',
  coral: 'glow-coral',
  amber: 'glow-coral',
};

const TONE_TEXT: Record<RippleTone, string> = {
  lime: 'text-[#04060A]',
  aqua: 'text-[#04060A]',
  coral: 'text-white',
  amber: 'text-[#04060A]',
};

const TONE_FILL: Record<RippleTone, string> = {
  lime: 'bg-accent',
  aqua: 'bg-accent-3',
  coral: 'bg-accent-2',
  amber: 'bg-accent-4',
};

/**
 * The high-energy CTA: gradient hairline border, dual color-dodge glow layers
 * (see `.btn-laser-glow` in index.css) and a water ripple on contact.
 */
export const GlowButton: React.FC<GlowButtonProps> = ({
  children,
  className,
  tone = 'lime',
  variant = 'laser',
  fullWidth,
  disabled,
  onPointerDown,
  ...rest
}) => {
  const { ref, onPointerDown: ripple } = useWaterRipple<HTMLButtonElement>(tone, 'medium');

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!disabled) ripple(event);
    onPointerDown?.(event);
  };

  if (variant === 'glass') {
    return (
      <button
        ref={ref}
        onPointerDown={handlePointerDown}
        disabled={disabled}
        className={cn(
          'relative overflow-hidden isolate spatial-press',
          'h-13 min-h-[3.25rem] px-6 rounded-full font-semibold text-[0.95rem]',
          'glass-spatial text-white',
          'disabled:opacity-40 disabled:pointer-events-none',
          fullWidth && 'w-full',
          className,
        )}
        {...rest}
      >
        <span className="relative z-10 inline-flex items-center justify-center gap-2">{children}</span>
      </button>
    );
  }

  return (
    <span className={cn('btn-laser-glow inline-block', TONE_CLASS[tone], fullWidth && 'w-full', disabled && 'opacity-40')}>
      <button
        ref={ref}
        onPointerDown={handlePointerDown}
        disabled={disabled}
        className={cn(
          'relative overflow-hidden isolate w-full',
          'h-[3.25rem] px-7 rounded-full font-bold text-[0.95rem] tracking-tight',
          TONE_FILL[tone],
          TONE_TEXT[tone],
          'disabled:pointer-events-none',
          className,
        )}
        {...rest}
      >
        <span className="relative z-10 inline-flex items-center justify-center gap-2">{children}</span>
      </button>
    </span>
  );
};
