/**
 * High-frequency telemetry bridge.
 *
 * The render loop produces a joint-angle + muscle-activation sample every frame.
 * At 60 Hz that is 3,600 samples a minute; dispatching each one would flood the
 * store, re-run every selector and re-render every subscribed component — the
 * classic way a "real-time" 3D panel drops to 12 fps on a mid-range Android.
 *
 * Instead:
 *   1. The loop calls `pushTelemetrySample`, which writes into a pre-allocated
 *      ring buffer. No dispatch, no allocation, no subscriber notification.
 *   2. This middleware drains the buffer on a fixed cadence (default 200 ms)
 *      and commits exactly one coalesced action.
 *
 * The committed snapshot reports the LATEST pose (that is what is on screen)
 * with the MEAN activation over the window (that is what the set summary wants).
 */

import { createAction } from '@reduxjs/toolkit';
import type { Middleware } from '@reduxjs/toolkit';

import { telemetryCommitted } from './workoutSlice';
import type { JointAngles, MovementPhase, TelemetrySample, TelemetrySnapshot } from './types';
import { MUSCLE_COUNT } from './types';

// ---------------------------------------------------------------------------
// Ring buffer
// ---------------------------------------------------------------------------

/** Three seconds of headroom at 60 Hz. Wrapping is tracked, never silent. */
const CAPACITY = 180;

const ANGLE_FIELDS = 6;

const buffer = {
  /** t, barHeight, at — one row per slot. */
  scalars: new Float32Array(CAPACITY * 3),
  angles: new Float32Array(CAPACITY * ANGLE_FIELDS),
  activation: new Float32Array(CAPACITY * MUSCLE_COUNT),
  phases: new Array<MovementPhase>(CAPACITY).fill('eccentric'),
  /** Monotonic write cursor; the slot is `writes % CAPACITY`. */
  writes: 0,
  /** Monotonic read cursor. */
  reads: 0,
  /** Samples lost because the writer lapped the reader. */
  dropped: 0,
};

/**
 * Write one sample. Safe to call from a requestAnimationFrame callback: it
 * performs no allocation and never touches the Redux store.
 */
export const pushTelemetrySample = (sample: TelemetrySample): void => {
  const pending = buffer.writes - buffer.reads;
  if (pending >= CAPACITY) {
    // The consumer has stalled (backgrounded tab, long task). Drop the oldest
    // sample rather than the newest — the newest is what the user is looking at.
    buffer.reads += 1;
    buffer.dropped += 1;
  }

  const slot = buffer.writes % CAPACITY;
  const s3 = slot * 3;
  buffer.scalars[s3] = sample.t;
  buffer.scalars[s3 + 1] = sample.barHeight;
  buffer.scalars[s3 + 2] = sample.at;

  const a6 = slot * ANGLE_FIELDS;
  buffer.angles[a6] = sample.angles.hip;
  buffer.angles[a6 + 1] = sample.angles.knee;
  buffer.angles[a6 + 2] = sample.angles.ankle;
  buffer.angles[a6 + 3] = sample.angles.shoulder;
  buffer.angles[a6 + 4] = sample.angles.elbow;
  buffer.angles[a6 + 5] = sample.angles.trunk;

  const mOffset = slot * MUSCLE_COUNT;
  const activation = sample.activation;
  for (let i = 0; i < MUSCLE_COUNT; i++) {
    buffer.activation[mOffset + i] = i < activation.length ? activation[i] : 0;
  }

  buffer.phases[slot] = sample.phase;
  buffer.writes += 1;
};

/**
 * Variant that takes the activation as a Float32Array, which is what the render
 * loop already has. Avoids the Array.from copy on the hot path.
 */
export const pushTelemetryFrame = (
  t: number,
  phase: MovementPhase,
  angles: JointAngles,
  activation: Float32Array,
  barHeight: number,
  at: number,
): void => {
  const pending = buffer.writes - buffer.reads;
  if (pending >= CAPACITY) {
    buffer.reads += 1;
    buffer.dropped += 1;
  }
  const slot = buffer.writes % CAPACITY;
  const s3 = slot * 3;
  buffer.scalars[s3] = t;
  buffer.scalars[s3 + 1] = barHeight;
  buffer.scalars[s3 + 2] = at;

  const a6 = slot * ANGLE_FIELDS;
  buffer.angles[a6] = angles.hip;
  buffer.angles[a6 + 1] = angles.knee;
  buffer.angles[a6 + 2] = angles.ankle;
  buffer.angles[a6 + 3] = angles.shoulder;
  buffer.angles[a6 + 4] = angles.elbow;
  buffer.angles[a6 + 5] = angles.trunk;

  buffer.activation.set(activation.subarray(0, MUSCLE_COUNT), slot * MUSCLE_COUNT);
  buffer.phases[slot] = phase;
  buffer.writes += 1;
};

/** Discard everything queued. Called when a session ends or the viewport unmounts. */
export const resetTelemetryBuffer = (): void => {
  buffer.reads = buffer.writes;
  buffer.dropped = 0;
};

export const telemetryBufferStats = () => ({
  pending: buffer.writes - buffer.reads,
  dropped: buffer.dropped,
  capacity: CAPACITY,
});

/**
 * Drain the buffer into a single snapshot. Returns null when nothing arrived
 * since the last drain, so the middleware can skip the dispatch entirely.
 */
const drain = (): { snapshot: TelemetrySnapshot; dropped: number } | null => {
  const pending = buffer.writes - buffer.reads;
  // Nothing new to show. Any drop count stays on the buffer so it folds into
  // the next commit rather than being lost.
  if (pending <= 0) return null;

  const mean = new Array<number>(MUSCLE_COUNT).fill(0);
  let lastSlot = 0;

  for (let n = 0; n < pending; n++) {
    const slot = (buffer.reads + n) % CAPACITY;
    lastSlot = slot;
    const mOffset = slot * MUSCLE_COUNT;
    for (let i = 0; i < MUSCLE_COUNT; i++) mean[i] += buffer.activation[mOffset + i];
  }
  for (let i = 0; i < MUSCLE_COUNT; i++) {
    mean[i] = Math.round((mean[i] / pending) * 1000) / 1000;
  }

  const s3 = lastSlot * 3;
  const a6 = lastSlot * ANGLE_FIELDS;
  const snapshot: TelemetrySnapshot = {
    t: buffer.scalars[s3],
    barHeight: Math.round(buffer.scalars[s3 + 1] * 1000) / 1000,
    at: buffer.scalars[s3 + 2],
    phase: buffer.phases[lastSlot],
    angles: {
      hip: buffer.angles[a6],
      knee: buffer.angles[a6 + 1],
      ankle: buffer.angles[a6 + 2],
      shoulder: buffer.angles[a6 + 3],
      elbow: buffer.angles[a6 + 4],
      trunk: buffer.angles[a6 + 5],
    },
    activation: mean,
    sampleCount: pending,
  };

  buffer.reads = buffer.writes;
  const dropped = buffer.dropped;
  buffer.dropped = 0;
  return { snapshot, dropped };
};

// ---------------------------------------------------------------------------
// Control actions
// ---------------------------------------------------------------------------

export interface TelemetryStreamOptions {
  /** Commit cadence in milliseconds. Clamped to 50..1000 by the middleware. */
  intervalMs?: number;
}

export const telemetryStreamStarted = createAction(
  'telemetry/streamStarted',
  (options?: TelemetryStreamOptions) => ({ payload: options ?? {} }),
);
export const telemetryStreamStopped = createAction('telemetry/streamStopped');

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

const DEFAULT_INTERVAL_MS = 200;

/**
 * Streams coalesced telemetry into the store while a viewport is mounted.
 *
 * The timer is owned by the middleware and torn down on `telemetryStreamStopped`,
 * so an unmounted viewport can never leave a timer dispatching into a dead
 * component tree.
 */
export const telemetryMiddleware: Middleware = (store) => {
  let timer: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    resetTelemetryBuffer();
  };

  const start = (intervalMs: number) => {
    stop();
    timer = setInterval(() => {
      // Nothing to publish while the document is hidden — the render loop is
      // paused, so any pending samples are stale by definition.
      if (typeof document !== 'undefined' && document.hidden) {
        resetTelemetryBuffer();
        return;
      }
      const result = drain();
      if (result) store.dispatch(telemetryCommitted(result));
    }, intervalMs);
  };

  return (next) => (action) => {
    if (telemetryStreamStarted.match(action)) {
      // The middleware signature types `action` as unknown, so re-attach the
      // action's own payload type rather than reaching into an untyped value.
      const payload = (action as { payload: TelemetryStreamOptions }).payload;
      const intervalMs = Math.min(1000, Math.max(50, payload?.intervalMs ?? DEFAULT_INTERVAL_MS));
      start(intervalMs);
      return next(action);
    }
    if (telemetryStreamStopped.match(action)) {
      stop();
      return next(action);
    }
    return next(action);
  };
};
