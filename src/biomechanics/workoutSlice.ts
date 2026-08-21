/**
 * Active workout session state machine.
 *
 * This slice owns everything about "what the athlete is doing right now":
 * which movement is loaded, which set they are on, the rep counter, the rest
 * timer, and the most recent coalesced telemetry snapshot.
 *
 * It deliberately does NOT own high-frequency data. Joint angles and muscle
 * activation arrive at 60 Hz from the render loop; dispatching that would mean
 * ~3,600 actions a minute and a re-render storm. Those samples land in the ring
 * buffer inside `telemetryMiddleware`, which folds them and commits a single
 * `telemetryCommitted` action a few times a second.
 */

import { createSlice, nanoid } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

import { getClipOrDefault } from './motions';
import type {
  EquipmentId,
  JointAngles,
  SessionStatus,
  SetEntry,
  TelemetrySnapshot,
} from './types';
import { MUSCLE_COUNT } from './types';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface QueuedExercise {
  exerciseId: string;
  name: string;
  /** 3D clip to render for this exercise; null when no clip covers it. */
  clipId: string | null;
  targetSets: number;
  targetReps: number;
  targetWeightKg: number;
}

export interface WorkoutState {
  status: SessionStatus;
  /** Session identity, generated client-side so optimistic writes are stable. */
  sessionId: string | null;
  workoutType: string | null;
  queue: QueuedExercise[];
  currentIndex: number;
  equipment: EquipmentId;
  /** Reps completed in the set currently in progress. */
  repCount: number;
  /** Sets already banked this session. */
  completedSets: SetEntry[];
  startedAt: number | null;
  /** Wall-clock seconds of work, excluding paused time. */
  elapsedSec: number;
  /** Seconds left on the rest timer; null when not resting. */
  restRemaining: number | null;
  restDuration: number;
  /** Latest coalesced telemetry. Null until the viewport produces a frame. */
  telemetry: TelemetrySnapshot | null;
  /** Samples the middleware dropped because the ring buffer wrapped. */
  droppedSamples: number;
  /**
   * Running mean of the activation vector for the set in progress, used to
   * stamp `SetEntry.activation` when the set is logged.
   */
  setActivationSum: number[];
  setActivationCount: number;
  setPeakAngles: JointAngles;
  lastError: string | null;
}

const ZERO_ANGLES: JointAngles = { hip: 0, knee: 0, ankle: 0, shoulder: 0, elbow: 0, trunk: 0 };

const zeroVector = (): number[] => new Array<number>(MUSCLE_COUNT).fill(0);

const initialState: WorkoutState = {
  status: 'idle',
  sessionId: null,
  workoutType: null,
  queue: [],
  currentIndex: 0,
  equipment: 'barbell',
  repCount: 0,
  completedSets: [],
  startedAt: null,
  elapsedSec: 0,
  restRemaining: null,
  restDuration: 60,
  telemetry: null,
  droppedSamples: 0,
  setActivationSum: zeroVector(),
  setActivationCount: 0,
  setPeakAngles: { ...ZERO_ANGLES },
  lastError: null,
};

const resetSetAccumulators = (state: WorkoutState) => {
  state.repCount = 0;
  state.setActivationSum = zeroVector();
  state.setActivationCount = 0;
  state.setPeakAngles = { ...ZERO_ANGLES };
};

/** Clamp helper — every numeric input from the UI passes through one of these. */
const clampInt = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
};

const clampFloat = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
};

// ---------------------------------------------------------------------------
// Slice
// ---------------------------------------------------------------------------

const workoutSlice = createSlice({
  name: 'workout',
  initialState,
  reducers: {
    sessionStarted: {
      reducer(state, action: PayloadAction<{ sessionId: string; workoutType: string; queue: QueuedExercise[]; equipment: EquipmentId; startedAt: number }>) {
        const { sessionId, workoutType, queue, equipment, startedAt } = action.payload;
        state.status = 'active';
        state.sessionId = sessionId;
        state.workoutType = workoutType;
        state.queue = queue.length > 0 ? queue : [];
        state.currentIndex = 0;
        state.equipment = equipment;
        state.completedSets = [];
        state.startedAt = startedAt;
        state.elapsedSec = 0;
        state.restRemaining = null;
        state.telemetry = null;
        state.droppedSamples = 0;
        state.lastError = null;
        resetSetAccumulators(state);
      },
      prepare(payload: { workoutType: string; queue: QueuedExercise[]; equipment?: EquipmentId }) {
        return {
          payload: {
            sessionId: nanoid(),
            workoutType: payload.workoutType,
            queue: payload.queue,
            equipment: payload.equipment ?? 'barbell',
            startedAt: Date.now(),
          },
        };
      },
    },

    /** Jump to a specific exercise in the queue. Out-of-range indices are ignored. */
    exerciseSelected(state, action: PayloadAction<number>) {
      const index = action.payload;
      if (index < 0 || index >= state.queue.length) return;
      state.currentIndex = index;
      state.restRemaining = null;
      if (state.status === 'resting') state.status = 'active';
      resetSetAccumulators(state);
    },

    equipmentChanged(state, action: PayloadAction<EquipmentId>) {
      state.equipment = action.payload;
    },

    /** One rep banked. The haptic pulse is fired by the component, not here. */
    repCounted(state) {
      if (state.status !== 'active') return;
      state.repCount = Math.min(state.repCount + 1, 999);
    },

    repCountAdjusted(state, action: PayloadAction<number>) {
      state.repCount = clampInt(action.payload, 0, 999);
    },

    /**
     * Bank the set in progress. Weight and RPE come from the UI; activation and
     * peak angles come from telemetry accumulated since the last set.
     */
    setLogged: {
      reducer(state, action: PayloadAction<{ id: string; weightKg: number; rpe: number; completedAt: number }>) {
        const exercise = state.queue[state.currentIndex];
        if (!exercise || state.repCount <= 0) return;
        const divisor = state.setActivationCount || 1;
        state.completedSets.push({
          id: action.payload.id,
          exerciseId: exercise.exerciseId,
          exerciseName: exercise.name,
          reps: state.repCount,
          weightKg: clampFloat(action.payload.weightKg, 0, 1000),
          rpe: clampInt(action.payload.rpe, 1, 10),
          equipment: state.equipment,
          completedAt: action.payload.completedAt,
          activation: state.setActivationSum.map((sum) => Math.round((sum / divisor) * 1000) / 1000),
          peakAngles: { ...state.setPeakAngles },
        });
        resetSetAccumulators(state);
      },
      prepare(payload: { weightKg: number; rpe: number }) {
        return { payload: { id: nanoid(), weightKg: payload.weightKg, rpe: payload.rpe, completedAt: Date.now() } };
      },
    },

    restStarted(state, action: PayloadAction<number | undefined>) {
      const seconds = clampInt(action.payload ?? state.restDuration, 5, 600);
      state.restDuration = seconds;
      state.restRemaining = seconds;
      state.status = 'resting';
    },

    restTicked(state) {
      if (state.restRemaining === null) return;
      const next = state.restRemaining - 1;
      if (next <= 0) {
        state.restRemaining = null;
        state.status = 'active';
      } else {
        state.restRemaining = next;
      }
    },

    restSkipped(state) {
      state.restRemaining = null;
      if (state.status === 'resting') state.status = 'active';
    },

    /** Called once per second by the session timer while work is in progress. */
    elapsedTicked(state) {
      if (state.status === 'active') state.elapsedSec += 1;
    },

    sessionPaused(state) {
      if (state.status === 'active' || state.status === 'resting') state.status = 'paused';
    },

    sessionResumed(state) {
      if (state.status === 'paused') state.status = state.restRemaining !== null ? 'resting' : 'active';
    },

    sessionSaving(state) {
      state.status = 'saving';
    },

    sessionFinished(state) {
      state.status = 'summary';
      state.restRemaining = null;
    },

    sessionReset() {
      // Returning a fresh object rather than mutating guarantees no stale
      // telemetry or accumulator survives into the next session.
      return { ...initialState, setActivationSum: zeroVector(), setPeakAngles: { ...ZERO_ANGLES } };
    },

    /**
     * Committed by `telemetryMiddleware` only. Components must never dispatch
     * this directly — doing so at frame rate is precisely the problem the
     * middleware exists to prevent.
     */
    telemetryCommitted(state, action: PayloadAction<{ snapshot: TelemetrySnapshot; dropped: number }>) {
      const { snapshot, dropped } = action.payload;
      state.telemetry = snapshot;
      state.droppedSamples += dropped;

      // Fold into the per-set accumulators while a set is actually running.
      if (state.status !== 'active') return;
      const activation = snapshot.activation;
      for (let i = 0; i < state.setActivationSum.length && i < activation.length; i++) {
        state.setActivationSum[i] += activation[i];
      }
      state.setActivationCount += 1;

      const peak = state.setPeakAngles;
      const angles = snapshot.angles;
      if (angles.hip > peak.hip) peak.hip = angles.hip;
      if (angles.knee > peak.knee) peak.knee = angles.knee;
      if (angles.ankle > peak.ankle) peak.ankle = angles.ankle;
      if (angles.shoulder > peak.shoulder) peak.shoulder = angles.shoulder;
      if (angles.elbow > peak.elbow) peak.elbow = angles.elbow;
      if (angles.trunk > peak.trunk) peak.trunk = angles.trunk;
    },

    errorRaised(state, action: PayloadAction<string>) {
      state.lastError = action.payload;
    },

    errorCleared(state) {
      state.lastError = null;
    },
  },
});

export const {
  sessionStarted,
  exerciseSelected,
  equipmentChanged,
  repCounted,
  repCountAdjusted,
  setLogged,
  restStarted,
  restTicked,
  restSkipped,
  elapsedTicked,
  sessionPaused,
  sessionResumed,
  sessionSaving,
  sessionFinished,
  sessionReset,
  telemetryCommitted,
  errorRaised,
  errorCleared,
} = workoutSlice.actions;

export default workoutSlice.reducer;

// ---------------------------------------------------------------------------
// Helpers used by callers building a queue from the exercise library
// ---------------------------------------------------------------------------

/**
 * Build a queue entry, resolving the exercise to a 3D clip where one exists.
 * Exercises with no clip stay in the session — they just render the 2D fallback
 * rather than an unrelated movement.
 */
export const buildQueueEntry = (input: {
  exerciseId: string;
  name: string;
  clipId?: string | null;
  targetSets?: number;
  targetReps?: number;
  targetWeightKg?: number;
}): QueuedExercise => ({
  exerciseId: input.exerciseId,
  name: input.name,
  clipId: input.clipId ?? null,
  targetSets: clampInt(input.targetSets ?? 3, 1, 20),
  targetReps: clampInt(input.targetReps ?? 10, 1, 100),
  targetWeightKg: clampFloat(input.targetWeightKg ?? 20, 0, 1000),
});

/** The clip the viewport should render for the current queue position. */
export const resolveActiveClip = (state: WorkoutState) =>
  getClipOrDefault(state.queue[state.currentIndex]?.clipId ?? null);
