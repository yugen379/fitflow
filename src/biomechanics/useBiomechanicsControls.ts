/**
 * Controls for the biomechanics viewport: timeline scrubbing, camera damping
 * and telemetry subscriptions.
 *
 * The organising rule is *what runs at frame rate stays out of Redux*. Playback
 * position and camera position are advanced on mutable refs inside the render
 * loop and committed to the store on a throttle, so dragging the model does not
 * dispatch 60 actions a second. Everything a component actually needs to
 * re-render for — phase, cue, layer flags, activation — comes back through
 * memoised selectors.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';

import { clamp01, phaseAt, phaseSpanAt } from './motions';
import {
  selectActivationRows,
  selectActiveClip,
  selectCurrentCue,
  selectDominantMuscle,
  selectJointAngles,
  selectLayers,
  selectOrbit,
  selectPerf,
  selectPlaying,
  selectQuality,
  selectReducedMotion,
  selectScrubT,
  selectSuspended,
  selectViewportStatus,
} from './selectors';
import { useAppDispatch, useAppSelector } from './store';
import type { LayerVisibility } from './viewportSlice';
import {
  autoRotateSet,
  gestureEnded,
  gestureStarted,
  layerToggled,
  orbitChanged,
  orbitPreset,
  orbitReset,
  playbackRateSet,
  playbackSet,
  playbackToggled,
  scrubbed,
} from './viewportSlice';
import type { MovementPhase, OrbitState } from './types';
import { ORBIT_LIMITS } from './viewportSlice';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** How often the frame-rate-driven values are pushed into Redux. */
const COMMIT_INTERVAL_MS = 100;

/**
 * Camera smoothing time constant, seconds. Damping is framerate-independent
 * (`1 - exp(-dt/tau)`), so a 30 fps device feels the same as a 120 fps one
 * instead of being twice as sluggish.
 */
const CAMERA_TAU = 0.09;

/** Below this the damped value snaps, avoiding an infinite asymptotic crawl. */
const SNAP_EPSILON = 1e-4;

const TWO_PI = Math.PI * 2;

/** Shortest signed angular distance from `a` to `b`. */
const angleDelta = (a: number, b: number): number => {
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return d;
};

const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v);

// ---------------------------------------------------------------------------
// Gesture types
// ---------------------------------------------------------------------------

export interface OrbitGestureDelta {
  /** Horizontal drag in CSS pixels. */
  dx: number;
  /** Vertical drag in CSS pixels. */
  dy: number;
  /** Pinch scale factor relative to the gesture start (1 = unchanged). */
  pinch?: number;
  /** Viewport width, used to normalise drag distance across screen sizes. */
  width: number;
  height: number;
}

export interface BiomechanicsControls {
  clip: ReturnType<typeof selectActiveClip>;
  scrubT: number;
  phase: MovementPhase;
  cue: string;
  playing: boolean;
  layers: LayerVisibility;
  quality: ReturnType<typeof selectQuality>;
  perf: ReturnType<typeof selectPerf>;
  orbit: OrbitState;
  reducedMotion: boolean;
  suspended: boolean;
  status: ReturnType<typeof selectViewportStatus>;
  angles: ReturnType<typeof selectJointAngles>;
  activationRows: ReturnType<typeof selectActivationRows>;
  dominant: ReturnType<typeof selectDominantMuscle>;

  /** Live scrub position. Read by the render loop; never triggers a re-render. */
  scrubRef: { current: number };
  /** Damped camera the renderer actually uses. */
  dampedOrbitRef: { current: OrbitState };

  scrubTo: (t: number) => void;
  scrubBy: (delta: number) => void;
  snapToPhase: (phase: MovementPhase) => void;
  stepFrame: (direction: 1 | -1) => void;
  togglePlay: () => void;
  setPlaying: (value: boolean) => void;
  setRate: (rate: number) => void;
  toggleLayer: (layer: keyof LayerVisibility) => void;
  resetCamera: () => void;
  setPreset: (preset: 'front' | 'side' | 'rear' | 'three-quarter') => void;

  beginGesture: () => void;
  applyGesture: (delta: OrbitGestureDelta) => void;
  endGesture: () => void;
  /** Discrete zoom step, for wheel and keyboard. `factor` > 1 pulls back. */
  zoomBy: (factor: number) => void;

  /** Advance playback by `dtSec`. Returns the new normalised position. */
  advancePlayback: (dtSec: number) => number;
  /** Ease the damped camera toward the store's target. Returns the damped orbit. */
  stepCamera: (dtSec: number) => OrbitState;
  /** Push frame-loop values into Redux, throttled. Call once per frame. */
  commitIfDue: (now: number) => void;
  /** Forget throttle state — call when the loop resumes from a pause. */
  resetCommitClock: (now: number) => void;
}

/** One frame at 24 fps of timeline — the step size for frame-by-frame inspection. */
const FRAME_STEP = 1 / 24;

export const useBiomechanicsControls = (): BiomechanicsControls => {
  const dispatch = useAppDispatch();

  const clip = useAppSelector(selectActiveClip);
  const storeScrubT = useAppSelector(selectScrubT);
  const playing = useAppSelector(selectPlaying);
  const layers = useAppSelector(selectLayers);
  const quality = useAppSelector(selectQuality);
  const perf = useAppSelector(selectPerf);
  const orbit = useAppSelector(selectOrbit);
  const reducedMotion = useAppSelector(selectReducedMotion);
  const suspended = useAppSelector(selectSuspended);
  const status = useAppSelector(selectViewportStatus);
  const angles = useAppSelector(selectJointAngles);
  const activationRows = useAppSelector(selectActivationRows);
  const dominant = useAppSelector(selectDominantMuscle);
  const { phase, cue } = useAppSelector(selectCurrentCue);

  const scrubRef = useRef<number>(storeScrubT);
  const dampedOrbitRef = useRef<OrbitState>({ ...orbit });
  const targetOrbitRef = useRef<OrbitState>({ ...orbit });
  const lastCommitRef = useRef<number>(0);
  const committedScrubRef = useRef<number>(storeScrubT);
  const playbackRef = useRef({ playing, rate: 1, loop: true, duration: 4 });
  const clipRef = useRef(clip);
  const gestureStartRef = useRef<OrbitState>({ ...orbit });

  const playbackRate = useAppSelector((state) => state.viewport.playbackRate);
  const loop = useAppSelector((state) => state.viewport.loop);
  const repDurationSec = useAppSelector((state) => state.viewport.repDurationSec);

  // Mirror store values the render loop reads, so the loop closure never goes
  // stale and never has to be rebuilt when playback settings change.
  useEffect(() => {
    playbackRef.current = { playing, rate: playbackRate, loop, duration: repDurationSec };
  }, [playing, playbackRate, loop, repDurationSec]);

  useEffect(() => {
    clipRef.current = clip;
  }, [clip]);

  // The store is the source of truth for the camera *target*; the ref chases it.
  useEffect(() => {
    targetOrbitRef.current = { ...orbit };
  }, [orbit]);

  // An external scrub (deep link, phase button, slider) must win over whatever
  // the loop last wrote, but only when it genuinely differs.
  useEffect(() => {
    if (Math.abs(storeScrubT - committedScrubRef.current) > 1e-6) {
      scrubRef.current = storeScrubT;
      committedScrubRef.current = storeScrubT;
    }
  }, [storeScrubT]);

  // ---------------------------------------------------------------------------
  // Scrubbing
  // ---------------------------------------------------------------------------

  const commitScrub = useCallback(
    (t: number) => {
      const clamped = clamp01(t);
      scrubRef.current = clamped;
      committedScrubRef.current = clamped;
      dispatch(scrubbed({ t: clamped, phase: phaseAt(clipRef.current, clamped) }));
    },
    [dispatch],
  );

  const scrubTo = useCallback((t: number) => commitScrub(t), [commitScrub]);

  const scrubBy = useCallback((delta: number) => commitScrub(scrubRef.current + delta), [commitScrub]);

  const stepFrame = useCallback(
    (direction: 1 | -1) => {
      dispatch(playbackSet(false));
      commitScrub(scrubRef.current + direction * FRAME_STEP);
    },
    [commitScrub, dispatch],
  );

  const snapToPhase = useCallback(
    (target: MovementPhase) => {
      const span = clipRef.current.phases.find((p) => p.phase === target);
      if (!span) return;
      dispatch(playbackSet(false));
      // Land just inside the span so `phaseAt` agrees with the button pressed.
      commitScrub(span.start + Math.min(0.01, (span.end - span.start) * 0.1));
    },
    [commitScrub, dispatch],
  );

  const togglePlay = useCallback(() => dispatch(playbackToggled()), [dispatch]);
  const setPlaying = useCallback((value: boolean) => dispatch(playbackSet(value)), [dispatch]);
  const setRate = useCallback((rate: number) => dispatch(playbackRateSet(rate)), [dispatch]);
  const toggleLayer = useCallback((layer: keyof LayerVisibility) => dispatch(layerToggled(layer)), [dispatch]);

  // ---------------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------------

  const resetCamera = useCallback(() => {
    dispatch(orbitReset());
    dispatch(autoRotateSet(true));
  }, [dispatch]);

  const setPreset = useCallback(
    (preset: 'front' | 'side' | 'rear' | 'three-quarter') => {
      dispatch(orbitPreset(preset));
    },
    [dispatch],
  );

  const beginGesture = useCallback(() => {
    gestureStartRef.current = { ...targetOrbitRef.current };
    dispatch(gestureStarted());
  }, [dispatch]);

  /**
   * Convert a pointer/pinch delta into an orbit change.
   *
   * Drag is normalised against the viewport size so the same swipe rotates the
   * model by the same amount on a 360 px phone and a 900 px tablet. Every value
   * is clamped in the reducer, so a runaway gesture cannot invert the camera or
   * push the near plane through the avatar.
   */
  const applyGesture = useCallback(
    (delta: OrbitGestureDelta) => {
      const start = gestureStartRef.current;
      const width = Math.max(1, delta.width);
      const height = Math.max(1, delta.height);

      const azimuth = start.azimuth - (delta.dx / width) * Math.PI * 2;
      const polar = clamp(
        start.polar - (delta.dy / height) * Math.PI * 1.2,
        ORBIT_LIMITS.polarMin,
        ORBIT_LIMITS.polarMax,
      );
      const radius =
        delta.pinch && delta.pinch > 0
          ? clamp(start.radius / delta.pinch, ORBIT_LIMITS.radiusMin, ORBIT_LIMITS.radiusMax)
          : start.radius;

      const next: OrbitState = { azimuth, polar, radius, targetY: start.targetY };
      targetOrbitRef.current = next;
      dispatch(orbitChanged(next));
    },
    [dispatch],
  );

  const endGesture = useCallback(() => dispatch(gestureEnded()), [dispatch]);

  const zoomBy = useCallback(
    (factor: number) => {
      if (!Number.isFinite(factor) || factor <= 0) return;
      const next = clamp(targetOrbitRef.current.radius * factor, ORBIT_LIMITS.radiusMin, ORBIT_LIMITS.radiusMax);
      targetOrbitRef.current = { ...targetOrbitRef.current, radius: next };
      dispatch(orbitChanged({ radius: next }));
    },
    [dispatch],
  );

  const stepCamera = useCallback((dtSec: number): OrbitState => {
    const current = dampedOrbitRef.current;
    const target = targetOrbitRef.current;

    // Framerate-independent exponential smoothing.
    const k = 1 - Math.exp(-Math.max(0, dtSec) / CAMERA_TAU);

    const dAz = angleDelta(current.azimuth, target.azimuth);
    current.azimuth += dAz * k;

    const dPolar = target.polar - current.polar;
    current.polar += Math.abs(dPolar) < SNAP_EPSILON ? dPolar : dPolar * k;

    const dRadius = target.radius - current.radius;
    current.radius += Math.abs(dRadius) < SNAP_EPSILON ? dRadius : dRadius * k;

    const dTargetY = target.targetY - current.targetY;
    current.targetY += Math.abs(dTargetY) < SNAP_EPSILON ? dTargetY : dTargetY * k;

    return current;
  }, []);

  // ---------------------------------------------------------------------------
  // Playback
  // ---------------------------------------------------------------------------

  const advancePlayback = useCallback((dtSec: number): number => {
    const { playing: isPlaying, rate, loop: shouldLoop, duration } = playbackRef.current;
    if (!isPlaying || duration <= 0) return scrubRef.current;

    // A long frame (background tab, GC pause) must not teleport the animation
    // most of a rep forward, so the step is capped at a quarter of a second.
    const step = (Math.min(dtSec, 0.25) / duration) * rate;
    let next = scrubRef.current + step;

    if (next > 1) next = shouldLoop ? next % 1 : 1;
    if (next < 0) next = shouldLoop ? 1 + (next % 1) : 0;

    scrubRef.current = next;
    return next;
  }, []);

  const commitIfDue = useCallback(
    (now: number) => {
      if (now - lastCommitRef.current < COMMIT_INTERVAL_MS) return;
      lastCommitRef.current = now;

      const t = scrubRef.current;
      if (Math.abs(t - committedScrubRef.current) > 1e-3) {
        committedScrubRef.current = t;
        dispatch(scrubbed({ t, phase: phaseAt(clipRef.current, t) }));
      }
    },
    [dispatch],
  );

  const resetCommitClock = useCallback((now: number) => {
    lastCommitRef.current = now;
  }, []);

  // ---------------------------------------------------------------------------
  // Reduced motion — a system preference must stop playback, not just soften it
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (reducedMotion && playing) dispatch(playbackSet(false));
  }, [reducedMotion, playing, dispatch]);

  return useMemo(
    (): BiomechanicsControls => ({
      clip,
      scrubT: storeScrubT,
      phase,
      cue,
      playing,
      layers,
      quality,
      perf,
      orbit,
      reducedMotion,
      suspended,
      status,
      angles,
      activationRows,
      dominant,
      scrubRef,
      dampedOrbitRef,
      scrubTo,
      scrubBy,
      snapToPhase,
      stepFrame,
      togglePlay,
      setPlaying,
      setRate,
      toggleLayer,
      resetCamera,
      setPreset,
      beginGesture,
      applyGesture,
      endGesture,
      zoomBy,
      advancePlayback,
      stepCamera,
      commitIfDue,
      resetCommitClock,
    }),
    [
      clip,
      storeScrubT,
      phase,
      cue,
      playing,
      layers,
      quality,
      perf,
      orbit,
      reducedMotion,
      suspended,
      status,
      angles,
      activationRows,
      dominant,
      scrubTo,
      scrubBy,
      snapToPhase,
      stepFrame,
      togglePlay,
      setPlaying,
      setRate,
      toggleLayer,
      resetCamera,
      setPreset,
      beginGesture,
      applyGesture,
      endGesture,
      zoomBy,
      advancePlayback,
      stepCamera,
      commitIfDue,
      resetCommitClock,
    ],
  );
};

/** Exported for the proof harness — the phase a scrub position lands in. */
export const phaseForScrub = phaseSpanAt;
