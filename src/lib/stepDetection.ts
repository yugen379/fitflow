/**
 * Deciding whether a peak in the accelerometer signal is a STEP.
 *
 * Pure and storage-free on purpose: `pedometer.ts` cannot be loaded by a Node
 * harness (it reaches for IndexedDB), and this is the part actually worth
 * proving. Same split as `services/stepSyncPolicy.ts`.
 *
 * ## Why amplitude alone does not work
 *
 * The first version counted any peak above a threshold. That cannot tell
 * walking from a shake, because both produce big peaks — so pulling the phone
 * out of a pocket, gesturing with it, or setting it down all banked steps. Users
 * noticed immediately: "when I move the phone it also calculates".
 *
 * Rhythm can tell them apart. Walking is an unbroken train of peaks at a
 * near-constant interval (roughly 0.3–1.0 s apart) and very little else a phone
 * experiences looks like that. So:
 *
 *   • a peak closer than MIN_STEP_INTERVAL_MS is the same footfall ringing, and
 *     is dropped;
 *   • a peak further than MAX_STEP_INTERVAL_MS ends the run — walking stopped;
 *   • a peak whose interval disagrees with the rhythm established so far by
 *     more than RHYTHM_TOLERANCE restarts the run, crediting nothing;
 *   • nothing is credited at all until MIN_RUN consecutive rhythmic peaks have
 *     arrived. Once they have, the buffered peaks are credited retroactively so
 *     the first steps of a walk are not lost.
 *
 * The cost is a deliberate one: a genuine walk of fewer than MIN_RUN steps
 * counts as zero. Missing three steps is a far better failure than inventing
 * hundreds while the phone is being handled.
 */

/** Fastest believable human cadence, as a minimum gap between steps. */
export const MIN_STEP_INTERVAL_MS = 250;

/** Slowest gap that can still belong to the SAME walk. */
export const MAX_STEP_INTERVAL_MS = 2000;

/**
 * Consecutive rhythmic peaks required before any of them count.
 *
 * 5 rather than 4: marginally harder for random handling to trip by accident,
 * and free for real walking because a confirmed run credits its whole buffer
 * retroactively — the user never loses the first five steps of a walk.
 */
export const MIN_RUN = 5;

/** Permitted deviation from the run's established rhythm, as a fraction. */
export const RHYTHM_TOLERANCE = 0.45;

/** Sub-minimum peaks in a row before the run is treated as vibration. */
export const MAX_TOO_FAST = 2;

export class StepDetector {
  /** Timestamp of the last accepted peak. */
  private lastPeakAt = 0;
  /** Peaks awaiting confirmation that this is really a walk. */
  private pending: number[] = [];
  /** Rolling average interval, so cadence can drift without breaking the run. */
  private interval = 0;
  /** True once the current run has been accepted as walking. */
  private confirmed = false;
  /**
   * Consecutive peaks that arrived faster than a step can happen.
   *
   * One or two are the previous footfall ringing and are simply ignored. A
   * sustained train of them is vibration — and ignoring those without moving
   * the reference time let them ALIAS into a believable cadence: 80 ms peaks
   * were being accepted every ~320 ms, which looks exactly like walking. Past
   * MAX_TOO_FAST the run is torn down instead.
   */
  private tooFast = 0;

  /**
   * Offer a peak to the detector.
   *
   * @returns how many steps this peak credited — 0 normally, or MIN_RUN at the
   *          moment a run is confirmed and its buffer is flushed.
   */
  push(now: number): number {
    if (!Number.isFinite(now)) return 0;

    const gap = this.lastPeakAt > 0 ? now - this.lastPeakAt : 0;

    // Faster than a step can physically happen.
    if (gap > 0 && gap < MIN_STEP_INTERVAL_MS) {
      this.tooFast += 1;
      if (this.tooFast > MAX_TOO_FAST) {
        // Not ringing — a continuous high-frequency train. Tear the run down
        // and move the reference forward, so it cannot alias into a cadence.
        this.restart(now);
      }
      return 0;
    }

    // First peak, or too long a silence: begin a fresh candidate run.
    if (gap === 0 || gap > MAX_STEP_INTERVAL_MS) {
      this.restart(now);
      return 0;
    }

    const steady =
      this.interval === 0 || Math.abs(gap - this.interval) <= this.interval * RHYTHM_TOLERANCE;

    if (!steady) {
      // Irregular: handling, not walking. Everything buffered is discarded.
      this.restart(now);
      return 0;
    }

    this.lastPeakAt = now;
    this.tooFast = 0;
    this.interval = this.interval === 0 ? gap : this.interval * 0.6 + gap * 0.4;

    if (this.confirmed) return 1;

    this.pending.push(now);
    if (this.pending.length >= MIN_RUN) {
      this.confirmed = true;
      const credited = this.pending.length;
      this.pending = [];
      return credited;
    }
    return 0;
  }

  /**
   * Called when enough time has passed with no peaks that the walk is over.
   * Uncredited candidates are dropped, so two jolts ten seconds apart can never
   * combine into a "rhythm".
   */
  idle(now: number): void {
    if (this.lastPeakAt > 0 && now - this.lastPeakAt > MAX_STEP_INTERVAL_MS) {
      this.pending = [];
      this.interval = 0;
      this.confirmed = false;
      this.tooFast = 0;
    }
  }

  reset(): void {
    this.lastPeakAt = 0;
    this.pending = [];
    this.interval = 0;
    this.confirmed = false;
    this.tooFast = 0;
  }

  private restart(now: number): void {
    this.pending = [now];
    this.interval = 0;
    this.confirmed = false;
    this.tooFast = 0;
    this.lastPeakAt = now;
  }
}

// ---------------------------------------------------------------------------
// Full signal pipeline
// ---------------------------------------------------------------------------

/** Samples used to adapt the threshold to the device. */
export const WINDOW = 50;

/**
 * Noise floor. Below this, nothing is a step whatever the adaptive band says.
 *
 * Tuned against simulated gait rather than by feel (see `proof:steps`, Part J).
 * A phone carried in the hand at an easy pace only swings about 1.5 m/s2
 * peak-to-mean, so a floor set much above 1.0 stops counting for exactly the
 * people who walk gently — which is what happened when this was briefly 1.8.
 *
 * 1.0 is a measured optimum, not a guess. Dropping it to 0.8 does buy a gentle
 * walk at a 12 Hz sample rate, but it also lets a vibrating surface invent 53
 * steps from nothing; at 0.6 it is 60. Inventing steps is the worse failure, so
 * the floor stays where vibration is rejected. Rejecting irregular HANDLING is
 * the rhythm gate's job, not this threshold's.
 */
export const MIN_PEAK_MAGNITUDE = 1.0;

/**
 * Peak threshold as a multiple of the window's standard deviation.
 *
 * For a sinusoid, std = A / sqrt(2), so 0.85 * std = 0.6 * A — comfortably
 * under the peak but well above the noise between steps.
 */
export const PEAK_STD_FACTOR = 0.85;

/** Re-arm level, as a fraction of the peak threshold (hysteresis). */
export const REARM_FACTOR = 0.4;

/**
 * Low-pass cutoff, in Hz.
 *
 * Human gait lives at 1-3 Hz. Everything above is engine hum, a phone buzzing
 * on a table, a bumpy car ride or plain sensor noise — and without filtering,
 * that content ALIASES into the walking band: at 60 Hz sampling a 12 Hz
 * vibration only clears the hysteresis every few cycles, presenting as a
 * beautifully steady ~300 ms "cadence" that counted 60 steps of nothing.
 *
 * The coefficient is derived per sample from the REAL elapsed time, never
 * hard-coded. That is not a nicety: `devicemotion` is not 60 Hz. It is whatever
 * the device and browser feel like — measured at 14 Hz in one environment, and
 * commonly 16-60 Hz across Android. A fixed alpha of 0.3, which is ~4 Hz at
 * 60 Hz sampling, becomes a ~1 Hz cutoff at 14 Hz — i.e. it filters out WALKING
 * and the counter sits at zero forever. That shipped, and this is the fix.
 */
export const LOWPASS_CUTOFF_HZ = 4;

/** Clamp for the per-sample delta, so a backgrounded tab cannot blow up the filter. */
const MIN_DT_S = 0.002;
const MAX_DT_S = 0.5;

/**
 * The whole accelerometer-magnitude -> steps path, with no storage in it.
 *
 * `pedometer.ts` owns the sensor, the day, and persistence; everything that
 * decides whether a wobble was a step lives here, so it can be driven with
 * synthetic gait in a Node harness. That matters more than it sounds: the
 * thresholds are the difference between "counts my walk" and "counts me
 * putting my phone down", and both failure modes have already shipped once.
 */
export class StepPipeline {
  private window: number[] = [];
  private armed = true;
  private detector = new StepDetector();
  /** Low-pass state; null until the first sample seeds it. */
  private smoothed: number | null = null;
  /** Timestamp of the previous sample, for the time-aware filter coefficient. */
  private lastSampleAt: number | null = null;

  /**
   * Feed one accelerometer magnitude sample.
   *
   * @returns steps credited by this sample (usually 0).
   */
  push(magnitude: number, now: number): number {
    if (!Number.isFinite(magnitude) || !Number.isFinite(now)) return 0;

    // Low-pass FIRST. Everything downstream — the mean, the spread, the peak
    // threshold and the rhythm gate — works on gait-band signal only.
    //
    // alpha is recomputed every sample from the actual elapsed time:
    //   RC = 1 / (2*pi*fc),  alpha = dt / (RC + dt)
    // so the cutoff stays at LOWPASS_CUTOFF_HZ whatever rate the device
    // happens to deliver.
    const dtSeconds =
      this.lastSampleAt === null
        ? 1 / 60
        : Math.min(MAX_DT_S, Math.max(MIN_DT_S, (now - this.lastSampleAt) / 1000));
    this.lastSampleAt = now;

    const rc = 1 / (2 * Math.PI * LOWPASS_CUTOFF_HZ);
    const alpha = dtSeconds / (rc + dtSeconds);

    this.smoothed =
      this.smoothed === null ? magnitude : this.smoothed + alpha * (magnitude - this.smoothed);
    const filtered = this.smoothed;

    this.window.push(filtered);
    if (this.window.length > WINDOW) this.window.shift();

    const mean = this.window.reduce((a, b) => a + b, 0) / this.window.length;
    const dynamic = filtered - mean;

    const variance =
      this.window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / this.window.length;
    const spread = Math.sqrt(variance);

    const upper = Math.max(MIN_PEAK_MAGNITUDE, spread * PEAK_STD_FACTOR);
    const lower = upper * REARM_FACTOR;

    let credited = 0;
    if (this.armed && dynamic > upper) {
      credited = this.detector.push(now);
      this.armed = false;
    } else if (!this.armed && dynamic < lower) {
      this.armed = true;
    }

    this.detector.idle(now);
    return credited;
  }

  reset(): void {
    this.window = [];
    this.armed = true;
    this.smoothed = null;
    this.lastSampleAt = null;
    this.detector.reset();
  }
}
