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

/** Consecutive rhythmic peaks required before any of them count. */
export const MIN_RUN = 4;

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
