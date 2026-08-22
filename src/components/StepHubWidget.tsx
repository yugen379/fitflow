/**
 * Home-screen step widget.
 *
 * Tapping anywhere on it morphs into the full `/steps` analytics page via a
 * shared `layoutId` — the widget itself becomes the page header rather than
 * cross-fading to a new screen. That continuity is the point: the number you
 * tapped is the number you land on.
 *
 * ## Depth
 *
 * The card tilts toward the pointer on a spring, and its contents sit at three
 * different `translateZ` depths so they separate as it moves — that parallax is
 * what sells the tilt as depth rather than as a skewed image. The 3D dial
 * behind the count reads the same pointer position and counter-rotates, so it
 * feels like a physical object sitting inside the card.
 *
 * Tilt is suppressed under `prefers-reduced-motion`, where the card stays flat
 * and everything still works.
 *
 * ## Permission
 *
 * Counting can be gated (Android ACTIVITY_RECOGNITION, or the iOS motion
 * grant). Rather than showing a zero and letting the user assume the feature is
 * broken, the widget states why it is zero and offers the grant. If the user
 * has actually refused, it stops asking and says what to do instead — a button
 * that re-prompts after a hard denial does nothing on Android and just looks
 * broken.
 */

import React, { useRef, useState } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Flame, Footprints, MapPin, Timer } from 'lucide-react';

import { cn } from '../lib/utils';
import { haptic } from '../lib/haptics';
import { AnimatedNumber } from './AnimatedNumber';
import { formatActiveTime } from '../lib/pedometer';
import { spawnRipple } from './ui/WaterRipple';
import { prefetchRoute } from '../lib/prefetch';
import { SPRING, prefersReducedMotion } from '../lib/motion';

const StepDial = React.lazy(() => import('./3d/StepDial').then((m) => ({ default: m.StepDial })));

export interface StepHubWidgetProps {
  steps: number;
  goal: number;
  distanceKm: number;
  calories: number;
  activeMs: number;
  /** Shown when counting needs an explicit grant. */
  needsPermission?: boolean;
  /** Set when the user refused: stop asking, explain instead. */
  permissionDenied?: boolean;
  onEnable?: () => void;
  className?: string;
}

const Metric: React.FC<{ icon: React.ReactNode; value: string; label: string }> = ({
  icon,
  value,
  label,
}) => (
  <div className="flex items-center gap-2 min-w-0">
    <span className="shrink-0 text-text-mute">{icon}</span>
    <span className="min-w-0">
      <span className="num block text-sm font-semibold text-white tabular-nums leading-none truncate">{value}</span>
      <span className="block text-[10px] uppercase tracking-[0.12em] text-text-mute mt-0.5">{label}</span>
    </span>
  </div>
);

export const StepHubWidget: React.FC<StepHubWidgetProps> = ({
  steps,
  goal,
  distanceKm,
  calories,
  activeMs,
  needsPermission,
  permissionDenied,
  onEnable,
  className,
}) => {
  const navigate = useNavigate();
  const cardRef = useRef<HTMLDivElement>(null);
  const reduced = prefersReducedMotion();

  const ratio = goal > 0 ? Math.max(0, Math.min(1, steps / goal)) : 0;
  const remaining = Math.max(0, goal - steps);

  // -1..1 pointer position, spring-damped so the card trails the finger.
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 210, damping: 20, mass: 0.4 });
  const sy = useSpring(py, { stiffness: 210, damping: 20, mass: 0.4 });

  const rotateX = useTransform(sy, [-1, 1], [7, -7]);
  const rotateY = useTransform(sx, [-1, 1], [-7, 7]);
  // The specular sweep tracks the pointer, so the card reads as catching light.
  const glare = useTransform(
    [sx, sy],
    ([x, y]: number[]) =>
      `radial-gradient(circle at ${50 + x * 40}% ${50 + y * 40}%, rgba(255,255,255,0.16), transparent 58%)`,
  );

  // Mirrored into React state for the 3D dial, which needs a plain number.
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const track = (clientX: number, clientY: number) => {
    if (reduced || !cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = ((clientY - rect.top) / rect.height) * 2 - 1;
    px.set(nx);
    py.set(ny);
    setTilt({ x: nx, y: ny });
  };

  const release = () => {
    px.set(0);
    py.set(0);
    setTilt({ x: 0, y: 0 });
  };

  /**
   * Guards against activating twice.
   *
   * The card opens on `pointerdown` so the ripple starts under the finger
   * rather than a frame later — but pointerdown is followed by a real `click`,
   * and that click has to be handled too (see below). Without this, an ordinary
   * tap would navigate twice.
   */
  const activatedAt = useRef(0);

  const open = (clientX?: number, clientY?: number, target?: HTMLElement) => {
    const now = Date.now();
    if (now - activatedAt.current < 700) return;
    activatedAt.current = now;

    void haptic('medium');
    prefetchRoute('steps');
    if (target && clientX !== undefined && clientY !== undefined) {
      spawnRipple(target, clientX, clientY, 'lime');
    }
    navigate('/steps');
  };

  // Anything at a non-zero depth needs its own layer, or the browser flattens
  // it back into the card and the parallax silently disappears.
  const layer = (z: number) => ({ transform: `translateZ(${z}px)`, transformStyle: 'preserve-3d' as const });

  return (
    <motion.div
      ref={cardRef}
      layoutId="step-hub-transition"
      transition={SPRING.weighty}
      role="button"
      tabIndex={0}
      aria-label={`Steps today: ${Math.round(steps)} of ${goal}. Open step analytics.`}
      onPointerDown={(event) => open(event.clientX, event.clientY, event.currentTarget)}
      // ALSO on click, not only pointerdown. Screen readers activate a
      // role="button" by dispatching a synthetic click — no pointer events at
      // all — so a pointerdown-only handler is unreachable with TalkBack or
      // VoiceOver. Verified: a synthetic click() did nothing before this.
      // `open` de-dupes, so a normal tap (pointerdown then click) still
      // navigates exactly once.
      onClick={(event) => open(event.clientX, event.clientY, event.currentTarget)}
      onPointerMove={(event) => track(event.clientX, event.clientY)}
      onPointerLeave={release}
      onPointerUp={release}
      onPointerCancel={release}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      }}
      onPointerEnter={() => prefetchRoute('steps')}
      style={reduced ? undefined : { rotateX, rotateY, transformPerspective: 1100, transformStyle: 'preserve-3d' }}
      className={cn(
        'glass-spatial p-5 relative overflow-hidden isolate cursor-pointer spatial-press',
        className,
      )}
    >
      {/* The dial sits behind the content, bleeding off the right edge so the
          card feels like a window onto something larger than itself. */}
      <React.Suspense fallback={null}>
        <StepDial
          ratio={ratio}
          tilt={tilt}
          className="absolute right-3 top-8 w-24 h-24 opacity-90 pointer-events-none"
        />
      </React.Suspense>

      {!reduced && (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[inherit] mix-blend-overlay"
          style={{ background: glare }}
        />
      )}

      <div className="relative" style={layer(28)}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-eyebrow text-accent inline-flex items-center gap-1.5">
              <Footprints size={12} aria-hidden="true" />
              Steps today
            </p>
            <p className="num text-4xl font-bold text-white tabular-nums leading-none mt-1.5">
              <AnimatedNumber value={Math.round(steps)} />
              <span className="text-base text-text-dim font-medium"> / {goal.toLocaleString()}</span>
            </p>
          </div>
          <ChevronRight size={18} className="text-text-mute shrink-0 mt-1 -mr-1" aria-hidden="true" />
        </div>
      </div>

      {/* Liquid neon progress */}
      <div className="mt-4 h-2.5 rounded-full bg-white/[0.05] overflow-hidden relative" style={layer(16)}>
        <div
          className="h-full rounded-full relative overflow-hidden transition-[width] duration-700 ease-out"
          style={{
            width: `${Math.max(2, ratio * 100)}%`,
            background: 'linear-gradient(90deg, #CCFF00 0%, #D4FF00 55%, #00F5FF 100%)',
            boxShadow: '0 0 18px -2px rgba(204,255,0,0.7)',
          }}
        >
          <span
            className="absolute inset-0 liquid-wave"
            style={{
              background:
                'linear-gradient(100deg, transparent 0%, rgba(255,255,255,0.45) 45%, transparent 90%)',
              width: '200%',
            }}
          />
        </div>
      </div>

      <p className="text-[11px] text-text-dim mt-2 relative" style={layer(16)}>
        {remaining > 0
          ? `${remaining.toLocaleString()} steps to your goal`
          : 'Daily goal complete — nice work.'}
      </p>

      <div className="grid grid-cols-3 gap-3 mt-4 relative" style={layer(10)}>
        <Metric icon={<MapPin size={14} />} value={`${distanceKm.toFixed(1)} km`} label="Distance" />
        <Metric icon={<Flame size={14} />} value={`${Math.round(calories)} kcal`} label="Burned" />
        <Metric icon={<Timer size={14} />} value={formatActiveTime(activeMs)} label="Active" />
      </div>

      {permissionDenied ? (
        // No button: Android will not re-prompt after a hard denial, so one
        // here would do nothing at all when tapped.
        <p
          className="mt-4 text-[11px] text-text-mute leading-relaxed relative"
          style={layer(10)}
          onPointerDown={(event) => event.stopPropagation()}
        >
          Motion access is off, so steps are not being counted. Turn on Physical activity for FitFlow in your
          device settings, or connect Health Connect.
        </p>
      ) : needsPermission && onEnable ? (
        <button
          type="button"
          style={layer(10)}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            void haptic('selection');
            onEnable();
          }}
          className="mt-4 w-full h-11 rounded-2xl bg-accent/12 border border-accent/30 text-accent text-xs font-semibold active:scale-[0.98] transition-transform relative"
        >
          Enable motion access to count steps
        </button>
      ) : null}
    </motion.div>
  );
};

export default StepHubWidget;
