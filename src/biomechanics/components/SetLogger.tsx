/**
 * Rep counter, set logger and rest timer.
 *
 * The rep counter is haptic-synced: the pulse fires on the same interaction
 * that increments the count, never on a timer, so the feedback always matches
 * what the athlete actually did. The progress ring is a plain SVG arc — a
 * canvas or 3D ring here would compete with the viewport for GPU time to draw
 * something a stroke-dasharray does perfectly well.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Minus, Plus, SkipForward, Timer } from 'lucide-react';

import { haptic } from '../../lib/haptics';
import { cn } from '../../lib/utils';
import {
  selectCurrentExercise,
  selectElapsedSec,
  selectRepCount,
  selectRestRemaining,
  selectSessionStatus,
  selectSessionVolume,
} from '../selectors';
import { useAppDispatch, useAppSelector } from '../store';
import {
  elapsedTicked,
  repCountAdjusted,
  repCounted,
  restSkipped,
  restStarted,
  restTicked,
  setLogged,
} from '../workoutSlice';

// ---------------------------------------------------------------------------
// Progress ring
// ---------------------------------------------------------------------------

const RING_SIZE = 148;
const RING_STROKE = 11;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const ProgressRing: React.FC<{ progress: number; children: React.ReactNode; pulse: boolean }> = ({
  progress,
  children,
  pulse,
}) => {
  const clamped = Math.max(0, Math.min(1, progress));
  return (
    <div
      className={cn(
        'relative shrink-0 transition-transform duration-150 ease-out motion-reduce:transition-none',
        pulse ? 'scale-[1.04]' : 'scale-100',
      )}
      style={{ width: RING_SIZE, height: RING_SIZE }}
    >
      <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} aria-hidden="true">
        <defs>
          <linearGradient id="ff-rep-ring" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#9CFF1F" />
            <stop offset="100%" stopColor="#C6FF3D" />
          </linearGradient>
        </defs>
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={RING_STROKE}
        />
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          stroke="url(#ff-rep-ring)"
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - clamped)}
          transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
          style={{ transition: 'stroke-dashoffset 220ms cubic-bezier(0.22,1,0.36,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Stepper
// ---------------------------------------------------------------------------

const Stepper: React.FC<{
  label: string;
  value: number;
  suffix?: string;
  step: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}> = ({ label, value, suffix, step, min, max, onChange }) => (
  <div className="flex-1">
    <label className="text-[11px] uppercase tracking-[0.14em] text-text-mute block mb-1.5">{label}</label>
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => {
          haptic('selection');
          onChange(Math.max(min, value - step));
        }}
        aria-label={`Decrease ${label}`}
        className="w-11 h-11 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-text-dim active:scale-95 transition-transform"
      >
        <Minus size={16} aria-hidden="true" />
      </button>
      <output className="num flex-1 text-center text-lg font-semibold text-white tabular-nums">
        {value}
        {suffix ? <span className="text-xs text-text-dim ml-0.5">{suffix}</span> : null}
      </output>
      <button
        type="button"
        onClick={() => {
          haptic('selection');
          onChange(Math.min(max, value + step));
        }}
        aria-label={`Increase ${label}`}
        className="w-11 h-11 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-text-dim active:scale-95 transition-transform"
      >
        <Plus size={16} aria-hidden="true" />
      </button>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

const formatClock = (totalSeconds: number): string => {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

interface Props {
  className?: string;
  /** Called after a set is banked, so the page can push it to the backend. */
  onSetLogged?: (payload: { weightKg: number; rpe: number; reps: number }) => void;
}

export const SetLogger: React.FC<Props> = ({ className, onSetLogged }) => {
  const dispatch = useAppDispatch();
  const status = useAppSelector(selectSessionStatus);
  const reps = useAppSelector(selectRepCount);
  const exercise = useAppSelector(selectCurrentExercise);
  const restRemaining = useAppSelector(selectRestRemaining);
  const elapsed = useAppSelector(selectElapsedSec);
  const volume = useAppSelector(selectSessionVolume);

  const [weightKg, setWeightKg] = useState<number>(exercise?.targetWeightKg ?? 60);
  const [rpe, setRpe] = useState(7);
  const [pulse, setPulse] = useState(false);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const targetReps = exercise?.targetReps ?? 10;

  // Keep the pre-filled load in step with whatever exercise is loaded.
  useEffect(() => {
    if (exercise) setWeightKg(exercise.targetWeightKg);
  }, [exercise?.exerciseId, exercise?.targetWeightKg]);

  // Session clock.
  useEffect(() => {
    if (status !== 'active') return;
    const id = setInterval(() => dispatch(elapsedTicked()), 1000);
    return () => clearInterval(id);
  }, [status, dispatch]);

  // Rest clock. Kept separate so pausing work does not pause rest.
  useEffect(() => {
    if (restRemaining === null) return;
    const id = setInterval(() => dispatch(restTicked()), 1000);
    return () => clearInterval(id);
  }, [restRemaining === null, dispatch]);

  // Announce the end of rest with a distinct haptic rather than a silent flip.
  const previousRest = useRef<number | null>(restRemaining);
  useEffect(() => {
    if (previousRest.current !== null && restRemaining === null) haptic('success');
    previousRest.current = restRemaining;
  }, [restRemaining]);

  useEffect(
    () => () => {
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
    },
    [],
  );

  const addRep = useCallback(() => {
    haptic('medium');
    dispatch(repCounted());
    setPulse(true);
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
    pulseTimer.current = setTimeout(() => setPulse(false), 160);
  }, [dispatch]);

  const logSet = useCallback(() => {
    if (reps <= 0) return;
    haptic('success');
    const banked = reps;
    dispatch(setLogged({ weightKg, rpe }));
    dispatch(restStarted(90));
    onSetLogged?.({ weightKg, rpe, reps: banked });
  }, [dispatch, onSetLogged, reps, rpe, weightKg]);

  return (
    <section className={cn('glass p-4 space-y-4', className)} aria-labelledby="set-logger-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-eyebrow text-accent">Live set</p>
          <h2 id="set-logger-heading" className="font-display text-lg font-semibold text-white mt-0.5">
            {exercise?.name ?? 'No exercise loaded'}
          </h2>
        </div>
        <div className="text-right">
          <p className="num text-sm text-white tabular-nums">{formatClock(elapsed)}</p>
          <p className="text-[11px] text-text-mute">
            {volume.setCount} {volume.setCount === 1 ? 'set' : 'sets'} · {volume.volumeKg} kg
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <ProgressRing progress={targetReps > 0 ? reps / targetReps : 0} pulse={pulse}>
          <span className="num text-4xl font-bold text-white tabular-nums leading-none">{reps}</span>
          <span className="text-[11px] text-text-dim mt-1">of {targetReps} reps</span>
        </ProgressRing>

        <div className="flex-1 space-y-2">
          <button
            type="button"
            onClick={addRep}
            disabled={status !== 'active'}
            className="w-full h-14 rounded-2xl bg-accent text-bg font-semibold text-base active:scale-[0.98] transition-transform disabled:opacity-40 disabled:active:scale-100"
          >
            Count rep
          </button>
          <button
            type="button"
            onClick={() => {
              haptic('light');
              dispatch(repCountAdjusted(Math.max(0, reps - 1)));
            }}
            disabled={reps === 0}
            className="w-full h-11 rounded-xl bg-white/[0.04] border border-white/[0.06] text-text-dim text-sm font-medium active:scale-[0.98] transition-transform disabled:opacity-40"
          >
            Undo rep
          </button>
        </div>
      </div>

      <div className="flex gap-3">
        <Stepper label="Load" value={weightKg} suffix="kg" step={2.5} min={0} max={400} onChange={setWeightKg} />
        <Stepper label="RPE" value={rpe} step={1} min={1} max={10} onChange={setRpe} />
      </div>

      {restRemaining !== null ? (
        <div className="flex items-center gap-3 rounded-2xl bg-accent-3/[0.07] border border-accent-3/20 p-3">
          <Timer size={18} className="text-accent-3 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <p className="text-sm font-medium text-white" aria-live="polite">
              Resting — {formatClock(restRemaining)}
            </p>
            <p className="text-[11px] text-text-dim">Next set when the clock hits zero.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              haptic('light');
              dispatch(restSkipped());
            }}
            className="h-11 px-4 rounded-xl bg-white/[0.06] text-white text-sm font-medium inline-flex items-center gap-1.5 active:scale-95 transition-transform"
          >
            <SkipForward size={14} aria-hidden="true" />
            Skip
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={logSet}
          disabled={reps <= 0}
          className="w-full h-12 rounded-2xl bg-white/[0.06] border border-white/[0.08] text-white font-semibold inline-flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-40 disabled:active:scale-100"
        >
          <Check size={17} aria-hidden="true" />
          Log set {volume.setCount + 1}
        </button>
      )}
    </section>
  );
};
