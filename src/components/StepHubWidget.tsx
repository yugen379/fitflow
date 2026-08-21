/**
 * Home-screen step widget.
 *
 * Tapping anywhere on it morphs into the full `/steps` analytics page via a
 * shared `layoutId` — the widget itself becomes the page header rather than
 * cross-fading to a new screen. That continuity is the point: the number you
 * tapped is the number you land on.
 *
 * The progress bar carries a liquid neon shimmer, which is doing real work
 * rather than decoration: it is the only element that moves while the count is
 * static, so it reads as "still counting" instead of "stale".
 */

import React from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Flame, Footprints, MapPin, Timer } from 'lucide-react';

import { cn } from '../lib/utils';
import { haptic } from '../lib/haptics';
import { AnimatedNumber } from './AnimatedNumber';
import { formatActiveTime } from '../lib/pedometer';
import { spawnRipple } from './ui/WaterRipple';
import { prefetchRoute } from '../lib/prefetch';
import { SPRING } from '../lib/motion';

export interface StepHubWidgetProps {
  steps: number;
  goal: number;
  distanceKm: number;
  calories: number;
  activeMs: number;
  /** Shown when the sensor needs an explicit grant (iOS). */
  needsPermission?: boolean;
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
  onEnable,
  className,
}) => {
  const navigate = useNavigate();
  const ratio = goal > 0 ? Math.max(0, Math.min(1, steps / goal)) : 0;
  const remaining = Math.max(0, goal - steps);

  // Composed explicitly rather than spreading prefetch handlers over this one:
  // a spread silently wins over an inline handler and would kill the ripple.
  const open = (event: React.PointerEvent<HTMLDivElement>) => {
    void haptic('medium');
    prefetchRoute('steps');
    spawnRipple(event.currentTarget, event.clientX, event.clientY, 'lime');
    navigate('/steps');
  };

  return (
    <motion.div
      layoutId="step-hub-transition"
      transition={SPRING.weighty}
      role="button"
      tabIndex={0}
      aria-label={`Steps today: ${Math.round(steps)} of ${goal}. Open step analytics.`}
      onPointerDown={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          void haptic('medium');
          navigate('/steps');
        }
      }}
      onPointerEnter={() => prefetchRoute('steps')}
      className={cn(
        'glass-spatial p-5 relative overflow-hidden isolate cursor-pointer spatial-press',
        className,
      )}
    >
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
        <ChevronRight size={18} className="text-text-mute shrink-0 mt-1" aria-hidden="true" />
      </div>

      {/* Liquid neon progress */}
      <div className="mt-4 h-2.5 rounded-full bg-white/[0.05] overflow-hidden relative">
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

      <p className="text-[11px] text-text-dim mt-2">
        {remaining > 0
          ? `${remaining.toLocaleString()} steps to your goal`
          : 'Daily goal complete — nice work.'}
      </p>

      <div className="grid grid-cols-3 gap-3 mt-4">
        <Metric icon={<MapPin size={14} />} value={`${distanceKm.toFixed(1)} km`} label="Distance" />
        <Metric icon={<Flame size={14} />} value={`${Math.round(calories)} kcal`} label="Burned" />
        <Metric icon={<Timer size={14} />} value={formatActiveTime(activeMs)} label="Active" />
      </div>

      {needsPermission && onEnable ? (
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            void haptic('selection');
            onEnable();
          }}
          className="mt-4 w-full h-11 rounded-2xl bg-accent/12 border border-accent/30 text-accent text-xs font-semibold active:scale-[0.98] transition-transform"
        >
          Enable motion access to count steps
        </button>
      ) : null}
    </motion.div>
  );
};

export default StepHubWidget;
