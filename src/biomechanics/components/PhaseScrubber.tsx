/**
 * Scrubbable movement timeline.
 *
 * Built on a native range input rather than a custom drag surface. That is not
 * laziness: it buys keyboard scrubbing, screen-reader announcement and the
 * platform's own touch slop for free, all of which a div-with-pointer-events
 * would have to reimplement and usually gets wrong.
 */

import React, { useCallback, useId } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';

import { haptic } from '../../lib/haptics';
import { cn } from '../../lib/utils';
import { selectPhaseTrack } from '../selectors';
import { useAppSelector } from '../store';
import { PHASE_LABELS } from '../types';
import type { MovementPhase } from '../types';
import type { BiomechanicsControls } from '../useBiomechanicsControls';

const PHASE_STYLES: Record<MovementPhase, { bar: string; chip: string; dot: string }> = {
  eccentric: { bar: 'bg-accent-3/45', chip: 'text-accent-3 border-accent-3/30 bg-accent-3/10', dot: 'bg-accent-3' },
  isometric: { bar: 'bg-white/20', chip: 'text-white/80 border-white/15 bg-white/[0.06]', dot: 'bg-white/70' },
  concentric: { bar: 'bg-accent/50', chip: 'text-accent border-accent/30 bg-accent/10', dot: 'bg-accent' },
  lockout: { bar: 'bg-accent-bright/45', chip: 'text-accent-bright border-accent-bright/30 bg-accent-bright/10', dot: 'bg-accent-bright' },
};

const SPEEDS: { label: string; value: number }[] = [
  { label: '0.25×', value: 0.25 },
  { label: '0.5×', value: 0.5 },
  { label: '1×', value: 1 },
];

interface Props {
  controls: BiomechanicsControls;
  className?: string;
}

export const PhaseScrubber: React.FC<Props> = ({ controls, className }) => {
  const track = useAppSelector(selectPhaseTrack);
  const sliderId = useId();

  const { scrubT, phase, cue, playing, scrubTo, snapToPhase, stepFrame, togglePlay, setRate } = controls;
  const playbackRate = useAppSelector((state) => state.viewport.playbackRate);

  const handleInput = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      scrubTo(Number(event.target.value) / 1000);
    },
    [scrubTo],
  );

  const uniquePhases = track.map((span) => span.phase).filter((value, index, all) => all.indexOf(value) === index);

  return (
    <div className={cn('glass p-4 space-y-3.5', className)}>
      {/* Phase chips — the fast way to jump to the part of the lift you care about. */}
      <div className="flex items-center gap-2 overflow-x-auto -mx-1 px-1 pb-0.5" role="group" aria-label="Jump to movement phase">
        {uniquePhases.map((item) => {
          const active = phase === item;
          return (
            <button
              key={item}
              type="button"
              onClick={() => {
                haptic('selection');
                snapToPhase(item);
              }}
              aria-pressed={active}
              className={cn(
                'shrink-0 h-9 px-3 rounded-xl border text-xs font-medium transition-colors duration-150 inline-flex items-center gap-1.5',
                active ? PHASE_STYLES[item].chip : 'text-text-dim border-white/[0.06] bg-white/[0.02]',
              )}
            >
              <span className={cn('w-1.5 h-1.5 rounded-full', active ? PHASE_STYLES[item].dot : 'bg-text-mute')} aria-hidden="true" />
              {PHASE_LABELS[item]}
            </button>
          );
        })}
      </div>

      {/* Track */}
      <div className="relative pt-1">
        <div className="absolute inset-x-0 top-1.5 h-2.5 rounded-full overflow-hidden flex" aria-hidden="true">
          {track.map((span, index) => (
            <div
              key={`${span.phase}-${index}`}
              className={cn('h-full', PHASE_STYLES[span.phase].bar)}
              style={{ width: `${span.widthPct}%` }}
            />
          ))}
        </div>
        <input
          id={sliderId}
          type="range"
          min={0}
          max={1000}
          step={1}
          value={Math.round(scrubT * 1000)}
          onChange={handleInput}
          className="ff-scrubber relative w-full h-11 bg-transparent appearance-none cursor-pointer"
          aria-label="Movement timeline position"
          aria-valuetext={`${Math.round(scrubT * 100)} percent, ${PHASE_LABELS[phase]} phase`}
        />
      </div>

      {/* Transport */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            haptic('light');
            stepFrame(-1);
          }}
          aria-label="Previous frame"
          className="w-11 h-11 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-text-dim active:scale-95 transition-transform"
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => {
            haptic('medium');
            togglePlay();
          }}
          aria-label={playing ? 'Pause the movement' : 'Play the movement'}
          aria-pressed={playing}
          className="w-14 h-11 rounded-xl bg-accent text-bg font-semibold flex items-center justify-center active:scale-95 transition-transform"
        >
          {playing ? <Pause size={18} fill="currentColor" aria-hidden="true" /> : <Play size={18} fill="currentColor" aria-hidden="true" />}
        </button>

        <button
          type="button"
          onClick={() => {
            haptic('light');
            stepFrame(1);
          }}
          aria-label="Next frame"
          className="w-11 h-11 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-text-dim active:scale-95 transition-transform"
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>

        <div className="flex-1" />

        <div className="flex items-center gap-1" role="group" aria-label="Playback speed">
          {SPEEDS.map((speed) => (
            <button
              key={speed.value}
              type="button"
              onClick={() => setRate(speed.value)}
              aria-pressed={Math.abs(playbackRate - speed.value) < 0.01}
              className={cn(
                'num h-11 min-w-11 px-2 rounded-xl text-xs font-medium tabular-nums transition-colors duration-150',
                Math.abs(playbackRate - speed.value) < 0.01
                  ? 'bg-accent/12 text-accent border border-accent/25'
                  : 'text-text-dim border border-white/[0.06] bg-white/[0.02]',
              )}
            >
              {speed.label}
            </button>
          ))}
        </div>
      </div>

      {/* Cue for the current phase. */}
      <p className="text-sm text-text-dim leading-relaxed" aria-live="polite">
        <span className={cn('font-semibold', PHASE_STYLES[phase].chip.split(' ')[0])}>{PHASE_LABELS[phase]}.</span>{' '}
        {cue}
      </p>
    </div>
  );
};
