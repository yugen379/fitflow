/**
 * Precision nutrition panel: the daily fuel gauge plus the three macro
 * orbitals, over whatever the athlete has actually logged today.
 *
 * The gauge is a liquid-fill meniscus rather than a bar — two offset waves at
 * different speeds, so the surface never reads as a single looping sine. The
 * 3D orbitals underneath are code-split; this card paints its numbers
 * immediately and the spheres arrive when their chunk lands.
 */

import React, { Suspense, lazy, useMemo } from 'react';
import { Flame } from 'lucide-react';

import { cn } from '../../lib/utils';
import { AnimatedNumber } from '../AnimatedNumber';
import type { MacroDatum } from './MacroOrbitals';

const MacroOrbitals = lazy(() => import('./MacroOrbitals').then((m) => ({ default: m.MacroOrbitals })));

export interface MacroMatrixProps {
  caloriesConsumed: number;
  calorieTarget: number;
  proteinG: number;
  proteinTargetG: number;
  carbsG: number;
  carbsTargetG: number;
  fatsG: number;
  fatsTargetG: number;
  className?: string;
}

/**
 * Liquid meniscus fill.
 *
 * Two SVG wave paths translating at different rates; their interference is what
 * sells it as a surface rather than an animation. The whole thing is clipped to
 * the fill height, so "empty" is genuinely empty.
 */
const LiquidFill: React.FC<{ ratio: number; color: string }> = ({ ratio, color }) => {
  const clamped = Math.max(0, Math.min(1, ratio));

  return (
    <div className="absolute inset-0 overflow-hidden rounded-[24px]" aria-hidden="true">
      <div
        className="absolute inset-x-0 bottom-0 transition-[height] duration-700 ease-out"
        style={{ height: `${clamped * 100}%`, background: `linear-gradient(180deg, ${color}33 0%, ${color}14 100%)` }}
      >
        {/* Surface waves sit just above the fill line. */}
        <svg
          className="absolute -top-[7px] left-0 w-[200%] h-4 liquid-wave"
          viewBox="0 0 200 16"
          preserveAspectRatio="none"
        >
          <path d="M0 8 Q 25 0 50 8 T 100 8 T 150 8 T 200 8 V16 H0 Z" fill={color} opacity="0.5" />
        </svg>
        <svg
          className="absolute -top-[5px] left-0 w-[200%] h-4 liquid-wave liquid-wave-slow"
          viewBox="0 0 200 16"
          preserveAspectRatio="none"
        >
          <path d="M0 8 Q 25 16 50 8 T 100 8 T 150 8 T 200 8 V16 H0 Z" fill={color} opacity="0.34" />
        </svg>
      </div>
      <span className="sr-only">{Math.round(clamped * 100)}% of target</span>
    </div>
  );
};

const MacroRow: React.FC<{ label: string; value: number; target: number; color: string }> = ({
  label,
  value,
  target,
  color,
}) => {
  const ratio = target > 0 ? Math.max(0, Math.min(1, value / target)) : 0;
  return (
    <li className="flex items-center gap-3">
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
      <span className="w-16 shrink-0 text-xs text-text-dim">{label}</span>
      <span className="flex-1 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
        <span
          className="block h-full rounded-full origin-left transition-transform duration-500 ease-out"
          style={{ background: color, transform: `scaleX(${Math.max(0.02, ratio)})` }}
        />
      </span>
      <span className="num text-[11px] text-white tabular-nums w-20 text-right">
        {Math.round(value)} / {Math.round(target)}g
      </span>
    </li>
  );
};

export const MacroMatrix: React.FC<MacroMatrixProps> = ({
  caloriesConsumed,
  calorieTarget,
  proteinG,
  proteinTargetG,
  carbsG,
  carbsTargetG,
  fatsG,
  fatsTargetG,
  className,
}) => {
  const macros = useMemo<MacroDatum[]>(
    () => [
      { id: 'protein', label: 'Protein', grams: proteinG, targetG: proteinTargetG, color: '#CCFF00' },
      { id: 'carbs', label: 'Carbs', grams: carbsG, targetG: carbsTargetG, color: '#00F5FF' },
      { id: 'fat', label: 'Fat', grams: fatsG, targetG: fatsTargetG, color: '#FF3366' },
    ],
    [proteinG, proteinTargetG, carbsG, carbsTargetG, fatsG, fatsTargetG],
  );

  const remaining = Math.max(0, calorieTarget - caloriesConsumed);
  const ratio = calorieTarget > 0 ? caloriesConsumed / calorieTarget : 0;
  const over = caloriesConsumed > calorieTarget;

  return (
    <section className={cn('glass-spatial relative overflow-hidden', className)} aria-labelledby="fuel-heading">
      <LiquidFill ratio={ratio} color={over ? '#FF3366' : '#CCFF00'} />

      <div className="relative z-10 p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-eyebrow text-accent">Daily fuel</p>
            <h2 id="fuel-heading" className="font-display text-xl font-bold text-white mt-0.5 tracking-tight">
              Macro matrix
            </h2>
          </div>
          <div className="text-right">
            <p className="num text-2xl font-bold text-white tabular-nums leading-none">
              <AnimatedNumber value={Math.round(caloriesConsumed)} />
              <span className="text-sm text-text-dim font-medium"> / {Math.round(calorieTarget)}</span>
            </p>
            <p className={cn('text-[11px] mt-1 font-medium', over ? 'text-accent-2' : 'text-text-dim')}>
              {over ? `${Math.round(caloriesConsumed - calorieTarget)} kcal over` : `${Math.round(remaining)} kcal left`}
            </p>
          </div>
        </div>

        <Suspense fallback={<div className="h-32 liquid-skeleton rounded-[24px]" />}>
          <MacroOrbitals macros={macros} />
        </Suspense>

        <ul className="space-y-2.5">
          {macros.map((m) => (
            <MacroRow key={m.id} label={m.label} value={m.grams} target={m.targetG} color={m.color} />
          ))}
        </ul>

        <p className="text-[11px] text-text-mute leading-relaxed inline-flex items-center gap-1.5">
          <Flame size={12} className="text-accent-4 shrink-0" aria-hidden="true" />
          Spheres fill as you log. Targets come from your goal and today's day type.
        </p>
      </div>
    </section>
  );
};

export default MacroMatrix;
