/**
 * Muscle activation legend.
 *
 * Reads the coalesced telemetry snapshot (about five updates a second), never
 * the render loop. Bars are driven by `transform: scaleX`, so an update is a
 * compositor job with no layout pass — which is what keeps the panel from
 * fighting the 3D view for main-thread time.
 */

import React from 'react';

import { cn } from '../../lib/utils';
import { selectActivationRows, selectDominantMuscle } from '../selectors';
import { useAppSelector } from '../store';
import type { MuscleActivationRow } from '../types';

const barColor = (value: number, primary: boolean): string => {
  if (value >= 0.75) return 'bg-accent';
  if (value >= 0.45) return 'bg-accent-3';
  return primary ? 'bg-white/25' : 'bg-white/15';
};

/**
 * Intensity words rather than a bare number, because "82%" of a muscle means
 * nothing to most athletes while "peak" does. The number stays available for
 * anyone who wants it.
 */
const intensityLabel = (value: number): string => {
  if (value >= 0.8) return 'Peak';
  if (value >= 0.55) return 'High';
  if (value >= 0.3) return 'Moderate';
  if (value >= 0.08) return 'Light';
  return 'Idle';
};

const Row: React.FC<{ row: MuscleActivationRow }> = ({ row }) => (
  <li className="flex items-center gap-3">
    <span
      className={cn(
        'w-[6.5rem] shrink-0 text-xs truncate',
        row.primary ? 'text-white font-medium' : 'text-text-dim',
      )}
    >
      {row.label}
    </span>
    <span className="flex-1 h-2 rounded-full bg-white/[0.05] overflow-hidden" aria-hidden="true">
      <span
        className={cn('block h-full origin-left rounded-full transition-transform duration-200 ease-out', barColor(row.value, row.primary))}
        style={{ transform: `scaleX(${Math.max(0.01, Math.min(1, row.value))})` }}
      />
    </span>
    <span className="num w-10 text-right text-[11px] text-text-dim tabular-nums">{Math.round(row.value * 100)}%</span>
  </li>
);

export const ActivationLegend: React.FC<{ className?: string }> = ({ className }) => {
  const rows = useAppSelector(selectActivationRows);
  const dominant = useAppSelector(selectDominantMuscle);

  return (
    <section className={cn('glass p-4 space-y-3', className)} aria-labelledby="activation-heading">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-eyebrow text-accent">Muscle load</p>
          <h2 id="activation-heading" className="font-display text-lg font-semibold text-white mt-0.5">
            Working right now
          </h2>
        </div>
        {dominant ? (
          <div className="text-right">
            <p className="text-sm font-semibold text-white leading-tight">{dominant.label}</p>
            <p className="num text-[11px] text-text-dim tabular-nums">
              {intensityLabel(dominant.value)} · {Math.round(dominant.value * 100)}%
            </p>
          </div>
        ) : null}
      </div>

      {/* Screen readers get the summary, not 16 animated bars. */}
      <p className="sr-only" aria-live="polite">
        {dominant
          ? `${dominant.label} at ${intensityLabel(dominant.value).toLowerCase()} intensity, ${Math.round(dominant.value * 100)} percent.`
          : 'No muscle activation yet.'}
      </p>

      <ul className="space-y-2" aria-hidden="true">
        {rows.map((row) => (
          <Row key={row.id} row={row} />
        ))}
      </ul>

      {rows.length === 0 ? (
        <p className="text-sm text-text-dim">Start the movement to see which muscles take the load.</p>
      ) : (
        <p className="text-[11px] text-text-mute leading-relaxed">
          Primary movers in white, supporting muscles dimmed. Values are modelled from the joint angles at each point in
          the lift, not measured from your body.
        </p>
      )}
    </section>
  );
};
