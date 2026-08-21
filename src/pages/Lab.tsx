/**
 * Biomechanics Lab.
 *
 * The screen that ties the RTK session state, the RTK Query cache and the 3D
 * viewport together. It is deep-linkable (`/lab?clip=deadlift`) so a push
 * notification, a coach message or a library entry can drop the athlete
 * straight into the movement being discussed.
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, Info, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { haptic } from '../lib/haptics';
import { cn } from '../lib/utils';
import { Provider as ReduxProvider } from 'react-redux';

import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';

import { BiomechanicsViewport } from '../biomechanics/BiomechanicsViewport';
import { ActivationLegend } from '../biomechanics/components/ActivationLegend';
import { EquipmentPicker } from '../biomechanics/components/EquipmentPicker';
import { PhaseScrubber } from '../biomechanics/components/PhaseScrubber';
import { SetLogger } from '../biomechanics/components/SetLogger';
import { ViewControls } from '../biomechanics/components/ViewControls';
import {
  useGetAssetManifestQuery,
  useGetProgressionQuery,
  useLogSessionMutation,
  useRecordSetMutation,
} from '../biomechanics/fitnessApi';
import { getClipOrDefault } from '../biomechanics/motions';
import { selectCompletedSets, selectCurrentExercise, selectElapsedSec, selectSessionStatus } from '../biomechanics/selectors';
import { store as biomechanicsStore, useAppDispatch, useAppSelector } from '../biomechanics/store';
import { useBiomechanicsControls } from '../biomechanics/useBiomechanicsControls';
import { buildQueueEntry, exerciseSelected, sessionFinished, sessionStarted } from '../biomechanics/workoutSlice';

const LabInner: React.FC = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const controls = useBiomechanicsControls();
  const status = useAppSelector(selectSessionStatus);
  const exercise = useAppSelector(selectCurrentExercise);
  const completedSets = useAppSelector(selectCompletedSets);
  const elapsedSec = useAppSelector(selectElapsedSec);

  const { data: manifest, isLoading: manifestLoading, isError: manifestError, refetch } = useGetAssetManifestQuery();
  const [recordSet] = useRecordSetMutation();
  const [logSession, { isLoading: saving }] = useLogSessionMutation();

  const requestedClip = searchParams.get('clip');

  const queue = useMemo(() => {
    if (!manifest) return [];
    return manifest.clips.map((clip) =>
      buildQueueEntry({
        exerciseId: clip.id,
        name: clip.name,
        clipId: clip.id,
        targetSets: 3,
        targetReps: clip.posture === 'supine' ? 8 : 6,
        targetWeightKg: clip.id === 'deadlift' ? 100 : clip.id === 'squats' ? 80 : 50,
      }),
    );
  }, [manifest]);

  // Open a session as soon as the manifest lands, so the viewport always has a
  // clip and the telemetry accumulators always have somewhere to go.
  useEffect(() => {
    if (queue.length === 0 || status !== 'idle') return;
    dispatch(sessionStarted({ workoutType: 'Strength', queue, equipment: 'barbell' }));
  }, [queue, status, dispatch]);

  // Honour a deep link once the queue exists.
  useEffect(() => {
    if (!requestedClip || queue.length === 0) return;
    const index = queue.findIndex((item) => item.clipId === requestedClip);
    if (index >= 0 && index !== queue.findIndex((item) => item.exerciseId === exercise?.exerciseId)) {
      dispatch(exerciseSelected(index));
    }
  }, [requestedClip, queue, exercise?.exerciseId, dispatch]);

  const progressionArgs = useMemo(
    () => ({ userId: profile?.uid ?? '', exerciseId: exercise?.exerciseId ?? '' }),
    [profile?.uid, exercise?.exerciseId],
  );
  const { data: progression } = useGetProgressionQuery(progressionArgs, {
    skip: !profile?.uid || !exercise?.exerciseId,
  });

  const handleSelect = useCallback(
    (index: number) => {
      haptic('selection');
      dispatch(exerciseSelected(index));
      const clipId = queue[index]?.clipId;
      if (clipId) {
        const next = new URLSearchParams(searchParams);
        next.set('clip', clipId);
        setSearchParams(next, { replace: true });
      }
    },
    [dispatch, queue, searchParams, setSearchParams],
  );

  const handleSetLogged = useCallback(
    (payload: { weightKg: number; rpe: number; reps: number }) => {
      if (!profile?.uid || !exercise) return;
      // Fire and forget: the optimistic cache update has already moved the UI,
      // and `recordSet` rolls itself back if the write genuinely fails.
      void recordSet({
        userId: profile.uid,
        exerciseId: exercise.exerciseId,
        reps: payload.reps,
        weightKg: payload.weightKg,
        rpe: payload.rpe,
      });
    },
    [profile?.uid, exercise, recordSet],
  );

  const handleFinish = useCallback(async () => {
    if (!profile?.uid) {
      showToast('Sign in to save this session', 'info');
      return;
    }
    if (completedSets.length === 0) {
      showToast('Log at least one set first', 'info');
      return;
    }
    haptic('success');
    const volumeKg = completedSets.reduce((total, set) => total + set.weightKg * set.reps, 0);
    try {
      await logSession({
        userId: profile.uid,
        workoutType: 'Strength',
        durationMin: Math.max(1, Math.round(elapsedSec / 60)),
        // Rough MET-equivalent: strength work at ~5 MET against body weight.
        caloriesBurned: Math.round(5 * (profile.weight || 70) * (elapsedSec / 3600)),
        sets: completedSets,
        notes: `Biomechanics Lab · ${Math.round(volumeKg)} kg total volume`,
      }).unwrap();
      dispatch(sessionFinished());
      showToast('Session saved');
      navigate('/');
    } catch {
      // logWorkout queues offline internally, so a rejection here means the
      // write genuinely could not be accepted — say so instead of pretending.
      showToast('Could not save the session — it will retry when you are back online', 'error');
    }
  }, [profile, completedSets, elapsedSec, logSession, dispatch, showToast, navigate]);

  if (manifestLoading) {
    return (
      <div className="pb-28 pt-4 px-4">
        <div className="glass h-[46vh] flex items-center justify-center gap-2">
          <Loader2 size={18} className="animate-spin text-accent" aria-hidden="true" />
          <span className="text-sm text-text-dim">Loading movement library…</span>
        </div>
      </div>
    );
  }

  if (manifestError || !manifest) {
    return (
      <div className="pb-28 pt-4 px-4">
        <div className="glass p-6 text-center space-y-3">
          <h1 className="font-display text-xl font-semibold text-white">Movement library unavailable</h1>
          <p className="text-sm text-text-dim">The 3D movement manifest failed to load.</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="h-11 px-5 rounded-xl bg-white/[0.06] text-white text-sm font-medium"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const activeIndex = queue.findIndex((item) => item.exerciseId === exercise?.exerciseId);
  const activeClip = getClipOrDefault(exercise?.clipId ?? null);

  return (
    <div className="pb-28 pt-4 px-4 space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3 pt-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className="w-11 h-11 -ml-1 rounded-xl flex items-center justify-center text-text-dim active:scale-95 transition-transform"
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-eyebrow text-accent">Biomechanics Lab</p>
          <h1 className="font-display text-2xl font-bold text-white tracking-tight leading-tight mt-1 truncate">
            {activeClip.name}
          </h1>
        </div>
      </div>

      {/* Movement picker */}
      <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1" role="tablist" aria-label="Movement">
        {queue.map((item, index) => {
          const selected = index === activeIndex;
          return (
            <button
              key={item.exerciseId}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => handleSelect(index)}
              className={cn(
                'shrink-0 h-11 px-4 rounded-xl border text-sm font-medium transition-colors duration-150 active:scale-[0.97]',
                selected ? 'bg-accent/10 border-accent/30 text-accent' : 'bg-white/[0.02] border-white/[0.06] text-text-dim',
              )}
            >
              {item.name}
            </button>
          );
        })}
      </div>

      {/* Viewport */}
      <div className="h-[46vh] min-h-[300px] max-h-[440px]">
        <BiomechanicsViewport />
      </div>

      <PhaseScrubber controls={controls} />

      <SetLogger onSetLogged={handleSetLogged} />

      {progression?.known ? (
        <div className="glass p-4 flex items-start gap-3">
          <Info size={17} className="text-accent-3 shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-sm text-text-dim leading-relaxed">
            Based on your history, FitFlow suggests{' '}
            <span className="num text-white font-semibold tabular-nums">{progression.suggestedWeight} kg</span> for{' '}
            <span className="num text-white font-semibold tabular-nums">{progression.suggestedReps}</span> reps
            {progression.trend === 'up' ? ' — you are trending up.' : progression.trend === 'down' ? ' — back off slightly this week.' : '.'}
          </p>
        </div>
      ) : null}

      <ActivationLegend />

      <EquipmentPicker />

      <ViewControls controls={controls} />

      <button
        type="button"
        onClick={handleFinish}
        disabled={saving || completedSets.length === 0}
        className="w-full h-14 rounded-2xl bg-accent text-bg font-semibold text-base inline-flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-40 disabled:active:scale-100"
      >
        {saving ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : null}
        {saving ? 'Saving…' : `Finish session (${completedSets.length} ${completedSets.length === 1 ? 'set' : 'sets'})`}
      </button>
    </div>
  );
};

/**
 * The Redux Provider is mounted here rather than at the app root on purpose.
 *
 * Redux Toolkit plus react-redux costs about 31 kB gzipped, and nothing outside
 * this route reads the store — putting the Provider at the root would tax every
 * cold start on a phone for a feature most sessions never open. The store
 * itself is a module-level singleton, so session state, the RTK Query cache and
 * the telemetry accumulators all survive navigating away and back; only the
 * subscription boundary is scoped. Any other screen that wants the live session
 * wraps itself the same way, and shares the same store instance.
 */
export const Lab: React.FC = () => (
  <ReduxProvider store={biomechanicsStore}>
    <LabInner />
  </ReduxProvider>
);

export default Lab;
