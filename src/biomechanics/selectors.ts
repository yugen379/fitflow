/**
 * Memoised selectors.
 *
 * Telemetry lands in the store several times a second, so anything reading it
 * must be memoised or every commit re-renders every subscriber. Each selector
 * here is built with `createSelector` and returns either a primitive or a
 * stable reference, which lets components subscribe to exactly the slice of
 * telemetry they draw and nothing more.
 */

import { createSelector } from '@reduxjs/toolkit';

import { getClipOrDefault, phaseAt, recruitedMuscles } from './motions';
import type { RootState } from './store';
import { MUSCLE_COUNT, MUSCLE_INDEX, MUSCLE_LABELS } from './types';
import type { JointAngles, MovementPhase, MuscleId, MuscleActivationRow } from './types';

// ---------------------------------------------------------------------------
// Roots
// ---------------------------------------------------------------------------

export const selectWorkout = (state: RootState) => state.workout;
export const selectViewport = (state: RootState) => state.viewport;

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export const selectSessionStatus = (state: RootState) => state.workout.status;
export const selectRepCount = (state: RootState) => state.workout.repCount;
export const selectRestRemaining = (state: RootState) => state.workout.restRemaining;
export const selectElapsedSec = (state: RootState) => state.workout.elapsedSec;
export const selectEquipment = (state: RootState) => state.workout.equipment;
export const selectCompletedSets = (state: RootState) => state.workout.completedSets;

export const selectCurrentExercise = createSelector(
  [(state: RootState) => state.workout.queue, (state: RootState) => state.workout.currentIndex],
  (queue, index) => queue[index] ?? null,
);

/** The clip the viewport should be rendering right now. */
export const selectActiveClip = createSelector([selectCurrentExercise], (exercise) =>
  getClipOrDefault(exercise?.clipId ?? null),
);

export const selectQueueProgress = createSelector(
  [(state: RootState) => state.workout.queue, (state: RootState) => state.workout.currentIndex],
  (queue, index) => ({
    index,
    total: queue.length,
    label: queue.length > 0 ? `${index + 1} of ${queue.length}` : '—',
  }),
);

export const selectSessionVolume = createSelector([selectCompletedSets], (sets) => {
  let volumeKg = 0;
  let reps = 0;
  for (const set of sets) {
    volumeKg += set.weightKg * set.reps;
    reps += set.reps;
  }
  return { volumeKg: Math.round(volumeKg), reps, setCount: sets.length };
});

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

const EMPTY_ANGLES: JointAngles = { hip: 0, knee: 0, ankle: 0, shoulder: 0, elbow: 0, trunk: 0 };

export const selectTelemetry = (state: RootState) => state.workout.telemetry;

/**
 * Joint angles only. Returns a stable reference while the numbers are
 * unchanged, so the angle chips do not re-render on activation-only commits.
 */
export const selectJointAngles = createSelector([selectTelemetry], (telemetry): JointAngles =>
  telemetry ? telemetry.angles : EMPTY_ANGLES,
);

export const selectBarHeight = createSelector([selectTelemetry], (telemetry) => telemetry?.barHeight ?? 0);

export const selectTelemetryPhase = createSelector(
  [selectTelemetry, (state: RootState) => state.viewport.phase],
  (telemetry, viewportPhase): MovementPhase => telemetry?.phase ?? viewportPhase,
);

const EMPTY_ACTIVATION: number[] = new Array<number>(MUSCLE_COUNT).fill(0);

export const selectActivationVector = createSelector(
  [selectTelemetry],
  (telemetry): number[] => telemetry?.activation ?? EMPTY_ACTIVATION,
);

/**
 * Activation rows for the legend, ordered primary muscles first and filtered to
 * the muscles this clip actually recruits. Rebuilds only when the clip or the
 * activation vector changes.
 */
export const selectActivationRows = createSelector(
  [selectActiveClip, selectActivationVector],
  (clip, activation): MuscleActivationRow[] => {
    const order = recruitedMuscles(clip);
    const primary = new Set<MuscleId>(clip.primary);
    return order.map((id) => ({
      id,
      label: MUSCLE_LABELS[id],
      value: activation[MUSCLE_INDEX[id]] ?? 0,
      primary: primary.has(id),
    }));
  },
);

/** The single hardest-working muscle right now — drives the headline readout. */
export const selectDominantMuscle = createSelector([selectActivationRows], (rows) => {
  let best: MuscleActivationRow | null = null;
  for (const row of rows) {
    if (!best || row.value > best.value) best = row;
  }
  return best;
});

export const selectDroppedSamples = (state: RootState) => state.workout.droppedSamples;

// ---------------------------------------------------------------------------
// Viewport
// ---------------------------------------------------------------------------

export const selectOrbit = (state: RootState) => state.viewport.orbit;
export const selectScrubT = (state: RootState) => state.viewport.scrubT;
export const selectPlaying = (state: RootState) => state.viewport.playing;
export const selectLayers = (state: RootState) => state.viewport.layers;
export const selectQuality = (state: RootState) => state.viewport.quality;
export const selectPerf = (state: RootState) => state.viewport.perf;
export const selectViewportStatus = (state: RootState) => state.viewport.status;
export const selectReducedMotion = (state: RootState) => state.viewport.reducedMotion;
export const selectSuspended = (state: RootState) => state.viewport.suspended;

/** Phase spans widened into percentages, ready to paint the scrubber track. */
export const selectPhaseTrack = createSelector([selectActiveClip], (clip) =>
  clip.phases.map((span) => ({
    phase: span.phase,
    startPct: span.start * 100,
    widthPct: Math.max(0, (span.end - span.start) * 100),
  })),
);

/** The coaching cue for wherever the scrubber currently sits. */
export const selectCurrentCue = createSelector([selectActiveClip, selectScrubT], (clip, t) => {
  const phase = phaseAt(clip, t);
  return { phase, cue: clip.cues[phase] };
});

/** True when the viewport can render — used to gate the play button. */
export const selectViewportInteractive = createSelector(
  [selectViewportStatus, selectSuspended],
  (status, suspended) => status === 'ready' && !suspended,
);
