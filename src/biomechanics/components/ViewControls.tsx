/**
 * Visual layer toggles, camera presets and the render-quality readout.
 *
 * The quality row is deliberately visible rather than hidden behind a debug
 * flag: when the guardrail drops detail on a hot phone, saying so is better
 * than letting the user assume the model just looks worse today.
 */

import React from 'react';
import { Activity, Box, Route, Thermometer, Waypoints } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { haptic } from '../../lib/haptics';
import { msg, t, tDyn } from '../../i18n/i18n';
import { cn } from '../../lib/utils';
import { selectPerf } from '../selectors';
import { useAppDispatch, useAppSelector } from '../store';
import type { QualityTier } from '../types';
import type { BiomechanicsControls } from '../useBiomechanicsControls';
import type { LayerVisibility } from '../viewportSlice';
import { qualitySet } from '../viewportSlice';

const LAYERS: { id: keyof LayerVisibility; label: string; icon: LucideIcon; hint: string }[] = [
  { id: 'heatmap', label: msg('Heatmap'), icon: Activity, hint: msg('Muscle activation shading') },
  { id: 'jointVectors', label: msg('Angles'), icon: Waypoints, hint: msg('Joint angle arcs and readouts') },
  { id: 'barPath', label: msg('Bar path'), icon: Route, hint: msg('Trajectory of the implement') },
  { id: 'skeleton', label: msg('Skeleton'), icon: Box, hint: msg('Underlying segment wireframe') },
];

const PRESETS: { id: 'front' | 'side' | 'rear' | 'three-quarter'; label: string }[] = [
  { id: 'front', label: msg('Front') },
  { id: 'side', label: msg('Side') },
  { id: 'rear', label: msg('Rear') },
  { id: 'three-quarter', label: '3/4' },
];

const TIERS: { id: QualityTier; label: string }[] = [
  { id: 'high', label: msg('High') },
  { id: 'balanced', label: msg('Balanced') },
  { id: 'low', label: msg('Battery saver') },
];

const throttleExplanation = (reason: string): string => {
  switch (reason) {
    case 'fps':
      return t('Detail reduced automatically to hold a smooth frame rate.');
    case 'thermal':
      return t('Detail reduced because the device is running hot.');
    case 'device':
      return t('Started at a lower detail level to match this device.');
    case 'battery':
      return t('Detail reduced to save battery.');
    default:
      return t('Running at full detail.');
  }
};

export const ViewControls: React.FC<{ controls: BiomechanicsControls; className?: string }> = ({
  controls,
  className,
}) => {
  const dispatch = useAppDispatch();
  const perf = useAppSelector(selectPerf);

  return (
    <div className={cn('glass p-4 space-y-4', className)}>
      <div>
        <p className="text-eyebrow text-accent">{t('Layers')}</p>
        <div className="grid grid-cols-2 gap-2 mt-2" role="group" aria-label={t('Visual layers')}>
          {LAYERS.map((layer) => {
            const on = controls.layers[layer.id];
            const Icon = layer.icon;
            return (
              <button
                key={layer.id}
                type="button"
                aria-pressed={on}
                title={tDyn(layer.hint)}
                onClick={() => {
                  haptic('selection');
                  controls.toggleLayer(layer.id);
                }}
                className={cn(
                  'h-11 px-3 rounded-xl border text-xs font-medium inline-flex items-center gap-2 transition-colors duration-150 active:scale-[0.97]',
                  on ? 'bg-accent/10 border-accent/25 text-accent' : 'bg-white/[0.02] border-white/[0.06] text-text-dim',
                )}
              >
                <Icon size={15} aria-hidden="true" />
                <span className="truncate">{tDyn(layer.label)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="text-eyebrow text-accent">{t('Camera')}</p>
        <div className="grid grid-cols-4 gap-2 mt-2" role="group" aria-label={t('Camera angle')}>
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                haptic('light');
                controls.setPreset(preset.id);
              }}
              className="h-11 rounded-xl bg-white/[0.02] border border-white/[0.06] text-text-dim text-xs font-medium active:scale-[0.97] transition-transform"
            >
              {tDyn(preset.label)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-eyebrow text-accent">{t('Detail')}</p>
          <span className="num text-[11px] text-text-mute tabular-nums inline-flex items-center gap-1.5">
            {perf.throttled ? <Thermometer size={12} className="text-accent-2" aria-hidden="true" /> : null}
            {perf.fps > 0 ? `${perf.fps} fps` : '—'}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-2" role="radiogroup" aria-label={t('Render detail')}>
          {TIERS.map((tier) => {
            const selected = perf.tier === tier.id;
            return (
              <button
                key={tier.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => dispatch(qualitySet(tier.id))}
                className={cn(
                  'h-11 rounded-xl border text-xs font-medium transition-colors duration-150 active:scale-[0.97]',
                  selected ? 'bg-accent/10 border-accent/25 text-accent' : 'bg-white/[0.02] border-white/[0.06] text-text-dim',
                )}
              >
                {tDyn(tier.label)}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-text-mute mt-2 leading-relaxed">{throttleExplanation(perf.reason)}</p>
      </div>
    </div>
  );
};
