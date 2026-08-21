/**
 * The dashboard centrepiece: Move · Eat · Recover as volumetric orbital rings,
 * with rolling counters and a tap-to-expand breakdown.
 *
 * The 3D canvas is code-split behind `React.lazy`, so three.js and R3F stay off
 * the boot path entirely — the card renders its flat SVG shape immediately and
 * upgrades to the volumetric version when the chunk lands. On a cold start you
 * see the real numbers straight away and the depth arrives a beat later, which
 * is the right order: data first, atmosphere second.
 */

import React, { Suspense, lazy, useMemo, useState } from 'react';
import { ChevronDown, Flame, HeartPulse, Footprints } from 'lucide-react';

import { cn } from '../../lib/utils';
import { haptic } from '../../lib/haptics';
import { AnimatedNumber } from '../AnimatedNumber';
import type { RingDatum } from './VolumetricRings';

const VolumetricRings = lazy(() =>
  import('./VolumetricRings').then((m) => ({ default: m.VolumetricRings })),
);

export interface OrbitalHUDProps {
  steps: number | null;
  stepGoal: number;
  caloriesConsumed: number;
  calorieGoal: number;
  /** 0–100. Null when no wearable/recovery signal is available. */
  recovery: number | null;
  className?: string;
}

/** Flat placeholder with the same footprint, so nothing reflows on upgrade. */
const RingsPlaceholder: React.FC = () => (
  <div className="aspect-square w-full max-w-[19rem] mx-auto rounded-full liquid-skeleton" aria-hidden="true" />
);

const LEGEND = [
  { id: 'move', label: 'Move', icon: Footprints, color: '#CCFF00' },
  { id: 'eat', label: 'Eat', icon: Flame, color: '#00F5FF' },
  { id: 'recover', label: 'Recover', icon: HeartPulse, color: '#FF3366' },
] as const;

export const OrbitalHUD: React.FC<OrbitalHUDProps> = ({
  steps,
  stepGoal,
  caloriesConsumed,
  calorieGoal,
  recovery,
  className,
}) => {
  const [expanded, setExpanded] = useState(false);

  const rings = useMemo<RingDatum[]>(
    () => [
      { id: 'move', label: 'Move', value: steps ?? 0, goal: stepGoal, unit: 'steps', color: '#CCFF00' },
      { id: 'eat', label: 'Eat', value: caloriesConsumed, goal: calorieGoal, unit: 'kcal', color: '#00F5FF' },
      { id: 'recover', label: 'Recover', value: recovery ?? 0, goal: 100, unit: 'percent', color: '#FF3366' },
    ],
    [steps, stepGoal, caloriesConsumed, calorieGoal, recovery],
  );

  const values: { id: string; primary: React.ReactNode; secondary: string }[] = [
    {
      id: 'move',
      primary: steps === null ? '—' : <AnimatedNumber value={steps} />,
      secondary: steps === null ? 'Connect a tracker' : `of ${stepGoal.toLocaleString()} steps`,
    },
    {
      id: 'eat',
      primary: <AnimatedNumber value={Math.round(caloriesConsumed)} />,
      secondary: `of ${Math.round(calorieGoal).toLocaleString()} kcal`,
    },
    {
      id: 'recover',
      primary: recovery === null ? '—' : `${Math.round(recovery)}%`,
      secondary: recovery === null ? 'No signal today' : 'readiness',
    },
  ];

  return (
    <section className={cn('glass-spatial p-5 relative overflow-hidden', className)} aria-labelledby="orbital-heading">
      <div className="flex items-start justify-between gap-3 relative z-10">
        <div>
          <p className="text-eyebrow text-accent">Today</p>
          <h2 id="orbital-heading" className="font-display text-xl font-bold text-white mt-0.5 tracking-tight">
            Move · Eat · Recover
          </h2>
        </div>
      </div>

      <div className="relative my-2">
        <Suspense fallback={<RingsPlaceholder />}>
          <VolumetricRings rings={rings} />
        </Suspense>

        {/* Rolling counters sit in the ring core — DOM text, so it stays crisp
            at any density and is selectable and screen-reader friendly. */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="num text-4xl font-bold text-white tabular-nums leading-none">
            {values[0].primary}
          </span>
          <span className="text-[11px] text-text-dim mt-1.5">{values[0].secondary}</span>
        </div>
      </div>

      {/* Legend */}
      <ul className="grid grid-cols-3 gap-2 relative z-10">
        {LEGEND.map((item, index) => (
          <li key={item.id} className="text-center">
            <div className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: item.color, boxShadow: `0 0 8px ${item.color}` }} />
              <span className="text-[10px] uppercase tracking-[0.14em] text-text-mute">{item.label}</span>
            </div>
            <p className="num text-sm font-semibold text-white tabular-nums mt-0.5">{values[index].primary}</p>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => {
          void haptic('selection');
          setExpanded((v) => !v);
        }}
        aria-expanded={expanded}
        className="mt-4 w-full h-11 rounded-2xl bg-white/[0.04] border border-white/[0.07] text-text-dim text-xs font-medium inline-flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform relative z-10"
      >
        {expanded ? 'Hide breakdown' : 'Show breakdown'}
        <ChevronDown size={14} className={cn('transition-transform duration-300', expanded && 'rotate-180')} aria-hidden="true" />
      </button>

      {expanded && (
        <div className="mt-3 space-y-2 relative z-10">
          {LEGEND.map((item, index) => (
            <div key={item.id} className="flex items-center gap-3 rounded-2xl bg-white/[0.03] border border-white/[0.05] px-3 py-2.5">
              <item.icon size={16} style={{ color: item.color }} aria-hidden="true" />
              <span className="flex-1 text-sm text-white font-medium">{item.label}</span>
              <span className="num text-sm text-text-dim tabular-nums">{values[index].secondary}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

export default OrbitalHUD;
