/**
 * Frame-rate and thermal guardrail.
 *
 * Honest caveat up front: the web platform exposes no thermal API. There is no
 * `navigator.thermalState`. What a browser *does* give you is frame timing,
 * device class hints and battery state, and sustained thermal throttling shows
 * up in frame timing before anything else does. So this guard treats a sustained
 * frame-time regression as the thermal signal, and uses device hints only to
 * pick a sensible starting tier rather than to predict throttling.
 *
 * Hysteresis matters more than the thresholds. Dropping quality the instant one
 * frame runs long produces visible flapping; every transition here is gated on
 * consecutive evaluation windows plus a dwell time.
 */

import type { QualityTier, ThrottleReason } from './types';

export interface GuardConfig {
  /** Average FPS below which quality steps down. */
  downThreshold: number;
  /** Average FPS above which quality may step back up. */
  upThreshold: number;
  /** How often a decision is considered, milliseconds. */
  windowMs: number;
  /** Consecutive bad windows required before stepping down. */
  windowsBeforeDown: number;
  /** Consecutive good windows required before stepping up. */
  windowsBeforeUp: number;
  /** Minimum time between tier changes, milliseconds. */
  dwellMs: number;
}

export const DEFAULT_GUARD_CONFIG: GuardConfig = {
  downThreshold: 55,
  upThreshold: 58,
  windowMs: 1000,
  windowsBeforeDown: 2,
  windowsBeforeUp: 6,
  dwellMs: 4000,
};

const TIERS: QualityTier[] = ['high', 'balanced', 'low'];

export interface GuardDecision {
  fps: number;
  fpsAvg: number;
  tier: QualityTier;
  reason: ThrottleReason;
  droppedFrames: number;
  /** True when `tier` differs from the tier before this evaluation. */
  changed: boolean;
}

/**
 * Pick a starting tier from device hints. Getting this right matters more than
 * the adaptive logic: a low-end phone that starts at `high` shows the user two
 * seconds of jank before the guard reacts.
 */
export const initialTierForDevice = (): { tier: QualityTier; reason: ThrottleReason } => {
  if (typeof navigator === 'undefined') return { tier: 'balanced', reason: 'device' };

  const nav = navigator as Navigator & { deviceMemory?: number; hardwareConcurrency?: number };
  const memory = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null;
  const cores = typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null;

  if ((memory !== null && memory <= 2) || (cores !== null && cores <= 2)) {
    return { tier: 'low', reason: 'device' };
  }
  if ((memory !== null && memory <= 4) || (cores !== null && cores <= 4)) {
    return { tier: 'balanced', reason: 'device' };
  }
  return { tier: 'high', reason: 'none' };
};

export class FpsGuard {
  private config: GuardConfig;
  private tier: QualityTier;
  private reason: ThrottleReason;

  private frames = 0;
  private windowStart = 0;
  private fpsAvg = 0;
  private lastFps = 0;
  private droppedFrames = 0;
  private badWindows = 0;
  private goodWindows = 0;
  private lastChangeAt = 0;
  /** Set once the guard has stepped down, so upward moves stay conservative. */
  private hasThrottled = false;
  private thermalPressure = false;

  constructor(startTier: QualityTier, startReason: ThrottleReason = 'none', config: Partial<GuardConfig> = {}) {
    this.config = { ...DEFAULT_GUARD_CONFIG, ...config };
    this.tier = startTier;
    this.reason = startReason;
  }

  /** Call once per rendered frame with the delta since the previous frame. */
  frame(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
    this.frames += 1;
    // A frame that took longer than two vsync intervals dropped at least one.
    if (deltaMs > 33.4) this.droppedFrames += 1;
  }

  /**
   * External thermal hint. Nothing in the browser provides this today, but
   * Capacitor plugins and future APIs can, so the seam exists rather than
   * being retrofitted later.
   */
  setThermalPressure(pressure: boolean): void {
    this.thermalPressure = pressure;
  }

  /**
   * Consider a tier change. Returns null until a full window has elapsed, so it
   * is safe to call every frame.
   */
  evaluate(now: number): GuardDecision | null {
    if (this.windowStart === 0) {
      this.windowStart = now;
      return null;
    }
    const elapsed = now - this.windowStart;
    // 60 frames of 16.667 ms sum to 999.99 ms, not 1000. Without this tolerance
    // the guard silently skips roughly every third window and reacts at half
    // the intended rate.
    if (elapsed < this.config.windowMs - 1) return null;

    const fps = (this.frames * 1000) / elapsed;
    this.lastFps = fps;
    // Seed the average on the first window instead of ramping up from zero,
    // which would otherwise look like a stall and trigger a false downgrade.
    this.fpsAvg = this.fpsAvg === 0 ? fps : this.fpsAvg * 0.6 + fps * 0.4;
    this.frames = 0;
    this.windowStart = now;

    const previousTier = this.tier;
    const canChange = now - this.lastChangeAt >= this.config.dwellMs;

    if (this.thermalPressure && this.tier !== 'low' && canChange) {
      this.tier = TIERS[Math.min(TIERS.length - 1, TIERS.indexOf(this.tier) + 1)];
      this.reason = 'thermal';
      this.hasThrottled = true;
      this.lastChangeAt = now;
      this.badWindows = 0;
      this.goodWindows = 0;
    } else if (this.fpsAvg < this.config.downThreshold) {
      this.badWindows += 1;
      this.goodWindows = 0;
      if (this.badWindows >= this.config.windowsBeforeDown && canChange && this.tier !== 'low') {
        this.tier = TIERS[Math.min(TIERS.length - 1, TIERS.indexOf(this.tier) + 1)];
        this.reason = 'fps';
        this.hasThrottled = true;
        this.lastChangeAt = now;
        this.badWindows = 0;
      }
    } else if (this.fpsAvg > this.config.upThreshold) {
      this.goodWindows += 1;
      this.badWindows = 0;
      // Only climb back if we throttled for frame rate, never after a thermal
      // step-down: the heat has not gone anywhere in four seconds.
      if (
        this.hasThrottled &&
        this.reason === 'fps' &&
        !this.thermalPressure &&
        this.goodWindows >= this.config.windowsBeforeUp &&
        canChange &&
        this.tier !== 'high'
      ) {
        this.tier = TIERS[Math.max(0, TIERS.indexOf(this.tier) - 1)];
        this.lastChangeAt = now;
        this.goodWindows = 0;
      }
    } else {
      this.badWindows = 0;
      this.goodWindows = 0;
    }

    return {
      fps: Math.round(fps),
      fpsAvg: this.fpsAvg,
      tier: this.tier,
      reason: this.reason,
      droppedFrames: this.droppedFrames,
      changed: this.tier !== previousTier,
    };
  }

  /** Clear timing history — used when the loop resumes after a background pause. */
  resetTiming(now: number): void {
    this.frames = 0;
    this.windowStart = now;
    this.badWindows = 0;
    this.goodWindows = 0;
  }

  get currentTier(): QualityTier {
    return this.tier;
  }

  get stats() {
    return { fps: this.lastFps, fpsAvg: this.fpsAvg, droppedFrames: this.droppedFrames, tier: this.tier };
  }
}
