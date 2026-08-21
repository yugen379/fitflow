/**
 * RTK Query service for the biomechanics lab.
 *
 * FitFlow's backend is Firestore, not REST, so there is no useful `baseUrl` to
 * point at. `fakeBaseQuery` plus per-endpoint `queryFn` gives us the entire RTK
 * Query feature set — normalised cache, tag invalidation, polling, optimistic
 * updates, request de-duplication — over the SDK calls the app already uses.
 *
 * Two rules hold everywhere in this file:
 *   1. Every `queryFn` returns `{ data }` or `{ error }`. It never throws, so a
 *      Firestore outage degrades a panel instead of unmounting the tree.
 *   2. Nothing non-serialisable enters the cache. Firestore `Timestamp` objects
 *      are converted to epoch milliseconds at the boundary.
 */

import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react';

import { getWorkouts, logWorkout } from '../services/dataService';
import { analyzeProgression, updateProgression } from '../services/progressionService';
import type { ProgressionLog, WorkoutRecord } from '../types';
import { EXERCISE_TO_CLIP, MOTION_CLIPS, peakActivation, recruitedMuscles } from './motions';
import type { EquipmentId, MotionClip, MuscleId, SetEntry } from './types';

// ---------------------------------------------------------------------------
// Serialisation helpers
// ---------------------------------------------------------------------------

/** Firestore Timestamp | Date | number | undefined -> epoch ms. */
const toEpochMs = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === 'object') {
    const ts = value as { toMillis?: () => number; seconds?: number };
    if (typeof ts.toMillis === 'function') {
      try {
        return ts.toMillis();
      } catch {
        /* fall through */
      }
    }
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  }
  return 0;
};

/** Cache-safe shape of a workout log. */
export interface WorkoutLogEntry {
  id: string;
  type: string;
  duration: number;
  caloriesBurned: number;
  /** Epoch ms. */
  timestamp: number;
  notes: string;
  exerciseLogs: {
    exerciseId: string;
    name: string;
    sets: number;
    reps: number;
    weight: number;
    difficulty: number;
  }[];
}

const normaliseWorkout = (record: WorkoutRecord): WorkoutLogEntry => ({
  id: String(record.id ?? ''),
  type: String(record.type ?? 'Workout'),
  duration: Number.isFinite(record.duration) ? record.duration : 0,
  caloriesBurned: Number.isFinite(record.caloriesBurned) ? record.caloriesBurned : 0,
  timestamp: toEpochMs(record.timestamp),
  notes: typeof record.notes === 'string' ? record.notes : '',
  exerciseLogs: Array.isArray(record.exerciseLogs)
    ? record.exerciseLogs.map((log: Record<string, unknown>) => ({
        exerciseId: String(log?.exerciseId ?? ''),
        name: String(log?.name ?? ''),
        sets: Number(log?.sets ?? 0) || 0,
        reps: Number(log?.reps ?? 0) || 0,
        weight: Number(log?.weight ?? 0) || 0,
        difficulty: Number(log?.difficulty ?? 3) || 3,
      }))
    : [],
});

// ---------------------------------------------------------------------------
// Asset manifest
// ---------------------------------------------------------------------------

/**
 * What the viewport needs to know about a clip before it decides to load it.
 * Clips ship in the bundle today, but the manifest is modelled as an endpoint
 * so swapping in remotely hosted geometry later is a queryFn change and nothing
 * else.
 */
export interface ClipManifestEntry {
  id: string;
  name: string;
  posture: MotionClip['posture'];
  equipment: EquipmentId[];
  primary: MuscleId[];
  secondary: MuscleId[];
  /** Peak activation per muscle across the whole clip, for the legend ordering. */
  peak: number[];
  keyframeCount: number;
  phaseCount: number;
}

export interface AssetManifest {
  version: number;
  clips: ClipManifestEntry[];
  /** exerciseId -> clipId, for resolving a library exercise to a 3D movement. */
  exerciseMap: Record<string, string>;
}

const MANIFEST_VERSION = 1;

const buildManifest = (): AssetManifest => ({
  version: MANIFEST_VERSION,
  clips: MOTION_CLIPS.map((clip) => ({
    id: clip.id,
    name: clip.name,
    posture: clip.posture,
    equipment: [...clip.equipment],
    primary: [...clip.primary],
    secondary: [...clip.secondary],
    peak: Array.from(peakActivation(clip)),
    keyframeCount: clip.keyframes.length,
    phaseCount: clip.phases.length,
  })),
  exerciseMap: { ...EXERCISE_TO_CLIP },
});

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export interface LogSessionArgs {
  userId: string;
  workoutType: string;
  durationMin: number;
  caloriesBurned: number;
  sets: SetEntry[];
  notes?: string;
}

export interface ProgressionArgs {
  userId: string;
  exerciseId: string;
}

export interface RecordSetArgs {
  userId: string;
  exerciseId: string;
  reps: number;
  weightKg: number;
  rpe: number;
}

export const fitnessApi = createApi({
  reducerPath: 'fitnessApi',
  baseQuery: fakeBaseQuery<string>(),
  tagTypes: ['WorkoutLog', 'Progression', 'AssetManifest'],
  // Workout history is worth keeping warm across screen changes; five minutes
  // covers a whole session without pinning stale data forever.
  keepUnusedDataFor: 300,
  refetchOnReconnect: true,
  endpoints: (builder) => ({
    /** Local today, remote later — the cache contract does not change either way. */
    getAssetManifest: builder.query<AssetManifest, void>({
      queryFn: async () => {
        try {
          return { data: buildManifest() };
        } catch (error) {
          return { error: error instanceof Error ? error.message : 'Manifest build failed' };
        }
      },
      providesTags: ['AssetManifest'],
    }),

    getWorkoutLogs: builder.query<WorkoutLogEntry[], string>({
      queryFn: async (userId) => {
        if (!userId) return { data: [] };
        try {
          const records = await getWorkouts(userId);
          if (!Array.isArray(records)) return { data: [] };
          return { data: records.map(normaliseWorkout) };
        } catch (error) {
          return { error: error instanceof Error ? error.message : 'Could not load workouts' };
        }
      },
      providesTags: (result) =>
        result
          ? [...result.map((log) => ({ type: 'WorkoutLog' as const, id: log.id })), { type: 'WorkoutLog' as const, id: 'LIST' }]
          : [{ type: 'WorkoutLog' as const, id: 'LIST' }],
    }),

    getProgression: builder.query<ProgressionSnapshot, ProgressionArgs>({
      queryFn: async ({ userId, exerciseId }) => {
        if (!userId || !exerciseId) {
          return { data: { exerciseId, suggestedWeight: 20, suggestedReps: 10, trend: 'stable', known: false } };
        }
        try {
          const log: ProgressionLog | null = await analyzeProgression(userId, exerciseId);
          if (!log) {
            return { data: { exerciseId, suggestedWeight: 20, suggestedReps: 10, trend: 'stable', known: false } };
          }
          return {
            data: {
              exerciseId,
              suggestedWeight: Number.isFinite(log.suggestedWeight) ? log.suggestedWeight : 20,
              suggestedReps: Number.isFinite(log.suggestedReps) ? log.suggestedReps : 10,
              trend: log.trend ?? 'stable',
              known: true,
            },
          };
        } catch (error) {
          return { error: error instanceof Error ? error.message : 'Could not load progression' };
        }
      },
      providesTags: (_result, _error, arg) => [{ type: 'Progression', id: arg.exerciseId }],
    }),

    /**
     * Bank a finished session.
     *
     * The optimistic update inserts the session at the head of the cached log
     * list immediately, so the summary screen and the history card update on the
     * same frame the button is pressed. `logWorkout` queues offline on failure
     * and resolves rather than rejecting, so the patch is only rolled back on a
     * genuine throw.
     */
    logSession: builder.mutation<{ id: string }, LogSessionArgs>({
      queryFn: async ({ userId, workoutType, durationMin, caloriesBurned, sets, notes }) => {
        if (!userId) return { error: 'Not signed in' };
        try {
          const exerciseLogs = sets.map((set) => ({
            exerciseId: set.exerciseId,
            name: set.exerciseName,
            sets: 1,
            reps: set.reps,
            weight: set.weightKg,
            difficulty: Math.max(1, Math.min(5, Math.round(set.rpe / 2))),
            equipment: set.equipment,
            peakAngles: set.peakAngles,
          }));
          const id = await logWorkout(userId, {
            type: workoutType,
            duration: Math.max(1, Math.round(durationMin)),
            caloriesBurned: Math.max(0, Math.round(caloriesBurned)),
            exerciseLogs,
            notes: notes ?? '',
          });
          return { data: { id: String(id ?? 'queued') } };
        } catch (error) {
          return { error: error instanceof Error ? error.message : 'Could not save the session' };
        }
      },
      async onQueryStarted(arg, { dispatch, queryFulfilled }) {
        const optimisticId = `optimistic-${Date.now()}`;
        const patch = dispatch(
          fitnessApi.util.updateQueryData('getWorkoutLogs', arg.userId, (draft) => {
            draft.unshift({
              id: optimisticId,
              type: arg.workoutType,
              duration: Math.max(1, Math.round(arg.durationMin)),
              caloriesBurned: Math.max(0, Math.round(arg.caloriesBurned)),
              timestamp: Date.now(),
              notes: arg.notes ?? '',
              exerciseLogs: arg.sets.map((set) => ({
                exerciseId: set.exerciseId,
                name: set.exerciseName,
                sets: 1,
                reps: set.reps,
                weight: set.weightKg,
                difficulty: Math.max(1, Math.min(5, Math.round(set.rpe / 2))),
              })),
            });
          }),
        );
        try {
          const { data } = await queryFulfilled;
          // Swap the placeholder id for the real document id so a later
          // invalidation does not produce a duplicate row.
          dispatch(
            fitnessApi.util.updateQueryData('getWorkoutLogs', arg.userId, (draft) => {
              const entry = draft.find((log) => log.id === optimisticId);
              if (entry) entry.id = data.id;
            }),
          );
        } catch {
          patch.undo();
        }
      },
      invalidatesTags: (_result, _error, arg) => [
        { type: 'WorkoutLog', id: 'LIST' },
        ...arg.sets.map((set) => ({ type: 'Progression' as const, id: set.exerciseId })),
      ],
    }),

    /**
     * Push one completed set into the progression engine. Optimistically nudges
     * the cached suggestion so the next set's pre-filled weight reacts instantly.
     */
    recordSet: builder.mutation<{ isPR: boolean }, RecordSetArgs>({
      queryFn: async ({ userId, exerciseId, reps, weightKg, rpe }) => {
        if (!userId || !exerciseId) return { error: 'Missing exercise' };
        try {
          const pr = await updateProgression(userId, exerciseId, {
            completed: true,
            difficulty: Math.max(1, Math.min(5, Math.round(rpe / 2))),
            weight: weightKg,
            reps,
          });
          return { data: { isPR: Boolean(pr.isWeightPR || pr.isRepsPR || pr.isOneRMPR) } };
        } catch (error) {
          return { error: error instanceof Error ? error.message : 'Could not record the set' };
        }
      },
      async onQueryStarted({ userId, exerciseId, rpe }, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          fitnessApi.util.updateQueryData('getProgression', { userId, exerciseId }, (draft) => {
            // Mirrors progressionService's rule: easy sets add load, hard ones
            // shed it. Keeping the two in step avoids a visible snap-back when
            // the server response lands.
            const difficulty = Math.max(1, Math.min(5, Math.round(rpe / 2)));
            if (difficulty <= 2) {
              draft.suggestedWeight += 2.5;
              draft.trend = 'up';
            } else if (difficulty >= 4) {
              draft.suggestedWeight = Math.max(0, draft.suggestedWeight - 2.5);
              draft.trend = 'down';
            } else {
              draft.trend = 'stable';
            }
          }),
        );
        try {
          await queryFulfilled;
        } catch {
          patch.undo();
        }
      },
      invalidatesTags: (_result, _error, arg) => [{ type: 'Progression', id: arg.exerciseId }],
    }),
  }),
});

export interface ProgressionSnapshot {
  exerciseId: string;
  suggestedWeight: number;
  suggestedReps: number;
  trend: 'up' | 'down' | 'stable';
  /** False when the athlete has never logged this exercise. */
  known: boolean;
}

export const {
  useGetAssetManifestQuery,
  useGetWorkoutLogsQuery,
  useGetProgressionQuery,
  useLogSessionMutation,
  useRecordSetMutation,
} = fitnessApi;

/** Muscles a clip recruits, ordered primary-first — used by the legend. */
export const clipMuscleOrder = (clipId: string): MuscleId[] => {
  const clip = MOTION_CLIPS.find((c) => c.id === clipId);
  return clip ? recruitedMuscles(clip) : [];
};
