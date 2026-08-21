/**
 * 3D viewport state: camera orbit, timeline scrubbing, visual layers and the
 * render-quality guardrail.
 *
 * The camera target lives here; the *damped* camera position does not. Damping
 * runs at frame rate inside `useBiomechanicsControls`, so storing the smoothed
 * value would put a dispatch on every frame. Redux holds where the camera is
 * heading, the render loop owns how it gets there.
 */

import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

import type { MovementPhase, OrbitState, PerfSnapshot, QualityProfile, QualityTier, ThrottleReason } from './types';

// ---------------------------------------------------------------------------
// Quality tiers
// ---------------------------------------------------------------------------

export const QUALITY_PROFILES: Readonly<Record<QualityTier, QualityProfile>> = {
  high: { tier: 'high', maxPixelRatio: 2, radialSegments: 20, shadow: true, antialias: true, barPathSamples: 96 },
  balanced: { tier: 'balanced', maxPixelRatio: 1.5, radialSegments: 12, shadow: true, antialias: true, barPathSamples: 64 },
  low: { tier: 'low', maxPixelRatio: 1, radialSegments: 8, shadow: false, antialias: false, barPathSamples: 40 },
};

const TIER_ORDER: QualityTier[] = ['high', 'balanced', 'low'];

export const stepTierDown = (tier: QualityTier): QualityTier =>
  TIER_ORDER[Math.min(TIER_ORDER.length - 1, TIER_ORDER.indexOf(tier) + 1)];

export const stepTierUp = (tier: QualityTier): QualityTier =>
  TIER_ORDER[Math.max(0, TIER_ORDER.indexOf(tier) - 1)];

// ---------------------------------------------------------------------------
// Camera limits
// ---------------------------------------------------------------------------

/**
 * Hard clamps on the orbit. The polar limits keep the camera off the poles
 * (where the view flips and the controls invert), and the radius limits stop a
 * pinch gesture from putting the near plane inside the avatar's head.
 */
export const ORBIT_LIMITS = {
  polarMin: 0.22,
  polarMax: Math.PI - 0.18,
  /**
   * `radius` is a multiple of the scene's auto-fit distance, not metres. The
   * camera frames the entire rep at 1.0, so one zoom range works for a bench
   * press and a deadlift without per-clip tuning.
   */
  radiusMin: 0.55,
  radiusMax: 2.4,
  /** Look-at offset from the framing centre, metres. */
  targetYMin: -0.6,
  targetYMax: 0.6,
} as const;

/**
 * Slightly above eye level. A dead-level camera flattens the hip hinge, which
 * is the one thing a lifter is looking at on a deadlift or a squat.
 */
export const DEFAULT_POLAR = Math.PI / 2 - 0.16;

export const DEFAULT_ORBIT: OrbitState = {
  azimuth: -0.62,
  polar: DEFAULT_POLAR,
  radius: 1,
  targetY: 0,
};

const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
};

/** Wrap azimuth into (-PI, PI] so it never grows without bound while spinning. */
const wrapAngle = (a: number): number => {
  if (!Number.isFinite(a)) return 0;
  const twoPi = Math.PI * 2;
  let v = (a + Math.PI) % twoPi;
  if (v < 0) v += twoPi;
  return v - Math.PI;
};

export const clampOrbit = (orbit: OrbitState): OrbitState => ({
  azimuth: wrapAngle(orbit.azimuth),
  polar: clamp(orbit.polar, ORBIT_LIMITS.polarMin, ORBIT_LIMITS.polarMax),
  radius: clamp(orbit.radius, ORBIT_LIMITS.radiusMin, ORBIT_LIMITS.radiusMax),
  targetY: clamp(orbit.targetY, ORBIT_LIMITS.targetYMin, ORBIT_LIMITS.targetYMax),
});

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface LayerVisibility {
  heatmap: boolean;
  jointVectors: boolean;
  barPath: boolean;
  skeleton: boolean;
  equipment: boolean;
}

export type ViewportStatus = 'idle' | 'initialising' | 'ready' | 'context-lost' | 'unsupported' | 'failed';

export interface ViewportState {
  status: ViewportStatus;
  /** Human-readable reason when status is 'failed' or 'unsupported'. */
  failure: string | null;
  orbit: OrbitState;
  /** Normalised timeline position, 0..1. */
  scrubT: number;
  /** Phase at `scrubT`, mirrored here so UI can subscribe without the clip. */
  phase: MovementPhase;
  playing: boolean;
  /** Seconds one full rep takes at 1x. */
  repDurationSec: number;
  playbackRate: number;
  loop: boolean;
  layers: LayerVisibility;
  quality: QualityProfile;
  perf: PerfSnapshot;
  /** True when the OS or the user asked for reduced motion. */
  reducedMotion: boolean;
  /** Auto-orbit while idle; disabled by any user gesture and by reduced motion. */
  autoRotate: boolean;
  /** Set while a pointer gesture owns the viewport, so parent scroll stays off. */
  gestureActive: boolean;
  /** Rendering is suspended while the app is backgrounded or the tab is hidden. */
  suspended: boolean;
}

const initialState: ViewportState = {
  status: 'idle',
  failure: null,
  orbit: { ...DEFAULT_ORBIT },
  scrubT: 0,
  phase: 'eccentric',
  playing: false,
  repDurationSec: 4,
  playbackRate: 1,
  loop: true,
  layers: { heatmap: true, jointVectors: true, barPath: true, skeleton: false, equipment: true },
  quality: QUALITY_PROFILES.high,
  perf: { fps: 0, fpsAvg: 0, tier: 'high', throttled: false, reason: 'none', droppedFrames: 0 },
  reducedMotion: false,
  autoRotate: true,
  gestureActive: false,
  suspended: false,
};

const viewportSlice = createSlice({
  name: 'viewport',
  initialState,
  reducers: {
    viewportInitialising(state) {
      state.status = 'initialising';
      state.failure = null;
    },

    viewportReady(state) {
      state.status = 'ready';
      state.failure = null;
    },

    viewportFailed(state, action: PayloadAction<{ reason: string; unsupported?: boolean }>) {
      state.status = action.payload.unsupported ? 'unsupported' : 'failed';
      state.failure = action.payload.reason;
      state.playing = false;
    },

    /** WebGL context loss is recoverable — the canvas rebuilds on restore. */
    contextLost(state) {
      state.status = 'context-lost';
      state.playing = false;
    },

    contextRestored(state) {
      state.status = 'ready';
      state.failure = null;
    },

    orbitChanged(state, action: PayloadAction<Partial<OrbitState>>) {
      state.orbit = clampOrbit({ ...state.orbit, ...action.payload });
    },

    orbitNudged(state, action: PayloadAction<{ dAzimuth?: number; dPolar?: number; dRadius?: number; dTargetY?: number }>) {
      const { dAzimuth = 0, dPolar = 0, dRadius = 0, dTargetY = 0 } = action.payload;
      state.orbit = clampOrbit({
        azimuth: state.orbit.azimuth + dAzimuth,
        polar: state.orbit.polar + dPolar,
        radius: state.orbit.radius + dRadius,
        targetY: state.orbit.targetY + dTargetY,
      });
    },

    orbitReset(state) {
      state.orbit = { ...DEFAULT_ORBIT };
    },

    /** Snap to one of the four cardinal coaching views. */
    orbitPreset(state, action: PayloadAction<'front' | 'side' | 'rear' | 'three-quarter'>) {
      const azimuth =
        action.payload === 'front' ? 0
        : action.payload === 'side' ? -Math.PI / 2
        : action.payload === 'rear' ? Math.PI
        : -0.62;
      state.orbit = clampOrbit({ ...state.orbit, azimuth, polar: DEFAULT_POLAR });
    },

    scrubbed(state, action: PayloadAction<{ t: number; phase: MovementPhase }>) {
      state.scrubT = clamp(action.payload.t, 0, 1);
      state.phase = action.payload.phase;
    },

    playbackToggled(state) {
      if (state.status !== 'ready') return;
      state.playing = !state.playing;
    },

    playbackSet(state, action: PayloadAction<boolean>) {
      state.playing = action.payload && state.status === 'ready';
    },

    playbackRateSet(state, action: PayloadAction<number>) {
      state.playbackRate = clamp(action.payload, 0.15, 2);
    },

    repDurationSet(state, action: PayloadAction<number>) {
      state.repDurationSec = clamp(action.payload, 1, 20);
    },

    loopToggled(state) {
      state.loop = !state.loop;
    },

    layerToggled(state, action: PayloadAction<keyof LayerVisibility>) {
      state.layers[action.payload] = !state.layers[action.payload];
    },

    qualitySet(state, action: PayloadAction<QualityTier>) {
      state.quality = QUALITY_PROFILES[action.payload];
      state.perf.tier = action.payload;
    },

    /**
     * Committed by the render loop's guardrail at most once a second, never per
     * frame. `tier` is applied here so the profile and the reported tier can
     * never disagree.
     */
    perfSampled(state, action: PayloadAction<{ fps: number; fpsAvg: number; tier: QualityTier; reason: ThrottleReason; droppedFrames: number }>) {
      const { fps, fpsAvg, tier, reason, droppedFrames } = action.payload;
      state.perf.fps = Math.round(fps);
      state.perf.fpsAvg = Math.round(fpsAvg * 10) / 10;
      state.perf.droppedFrames = droppedFrames;
      state.perf.reason = reason;
      if (tier !== state.perf.tier) {
        state.perf.tier = tier;
        state.quality = QUALITY_PROFILES[tier];
        if (tier !== 'high') state.perf.throttled = true;
      }
    },

    reducedMotionSet(state, action: PayloadAction<boolean>) {
      state.reducedMotion = action.payload;
      if (action.payload) {
        state.autoRotate = false;
        state.playing = false;
      }
    },

    autoRotateSet(state, action: PayloadAction<boolean>) {
      state.autoRotate = action.payload && !state.reducedMotion;
    },

    gestureStarted(state) {
      state.gestureActive = true;
      state.autoRotate = false;
    },

    gestureEnded(state) {
      state.gestureActive = false;
    },

    /** Backgrounding pauses the loop; the scrub position is preserved exactly. */
    suspendedSet(state, action: PayloadAction<boolean>) {
      state.suspended = action.payload;
      if (action.payload) state.playing = false;
    },

    viewportReset() {
      return { ...initialState, orbit: { ...DEFAULT_ORBIT } };
    },
  },
});

export const {
  viewportInitialising,
  viewportReady,
  viewportFailed,
  contextLost,
  contextRestored,
  orbitChanged,
  orbitNudged,
  orbitReset,
  orbitPreset,
  scrubbed,
  playbackToggled,
  playbackSet,
  playbackRateSet,
  repDurationSet,
  loopToggled,
  layerToggled,
  qualitySet,
  perfSampled,
  reducedMotionSet,
  autoRotateSet,
  gestureStarted,
  gestureEnded,
  suspendedSet,
  viewportReset,
} = viewportSlice.actions;

export default viewportSlice.reducer;
