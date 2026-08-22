/**
 * Offline-first background pedometer.
 *
 * On native builds FitFlow reads Health Connect, where the OS has already
 * counted steps at the kernel level and nothing here is needed. This is the
 * web/PWA path: an actual step detector over `devicemotion`, so a PWA installed
 * on a phone counts steps with no wearable, no account and no network.
 *
 * ## How the detection works
 *
 * Raw accelerometer magnitude during walking is a noisy ~2 Hz wave. Naively
 * counting threshold crossings double-counts badly, so this does three things:
 *
 *   1. **High-pass filter.** Subtract a slow-moving mean to remove gravity
 *      (~9.81 m/s²) and any constant tilt, leaving only the dynamic component.
 *   2. **Peak detection with hysteresis.** A step is registered when the signal
 *      rises above an upper threshold *after* having dropped below a lower one.
 *      One band would fire repeatedly while the signal jitters around it.
 *   3. **Refractory period.** Human cadence tops out around 240 steps/min even
 *      when running, so any peak within 250 ms of the last is the same step.
 *
 * A rolling sample buffer adapts the threshold to the device, because raw
 * magnitudes differ by an order of magnitude between phones.
 *
 * ## Persistence
 *
 * Counts are written to IndexedDB (via idb-keyval, already a dependency) keyed
 * by local date, debounced to once every few seconds. That survives reloads,
 * backgrounding and being offline. Days roll over on their own; nothing is ever
 * silently merged across a date boundary.
 *
 * ## Honest limits
 *
 * A browser cannot count steps while its tab is fully suspended. `devicemotion`
 * stops firing when the page is backgrounded on both iOS and Android. So this is
 * "offline-first", not "background" in the OS sense — the Service Worker cannot
 * subscribe to motion sensors. On native, Health Connect is the real answer and
 * takes priority; this fills the gap for PWA users, and it is upfront about the
 * difference rather than pretending to a capability the platform lacks.
 */

import { get, set } from 'idb-keyval';

import { StepPipeline } from './stepDetection';

import {
  KCAL_PER_STEP,
  KM_PER_STEP,
  caloriesFor,
  distanceKmFor,
  kmToMiles,
  speedKmhFor,
} from './stepFormulas';
import type { StepBody } from './stepFormulas';

// Re-exported so the dozens of existing call sites that import these from
// `pedometer` keep working; `stepFormulas` is now the single definition.
export { KCAL_PER_STEP, KM_PER_STEP, kmToMiles };
export type { StepBody };

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/**
 * Peak-to-step decision lives in `stepDetection.ts` — pure, and provable by the
 * harness, which cannot load this module because of its IndexedDB use.
 */

/** Gap after which walking is considered to have stopped, for active-time. */
const CADENCE_GAP_MS = 6000;

const STORAGE_PREFIX = 'ff-pedometer:';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StepSnapshot {
  /** Local date, YYYY-MM-DD. */
  date: string;
  steps: number;
  /** Kilometres. */
  distanceKm: number;
  /** Active kilocalories. */
  calories: number;
  /** Milliseconds spent actually walking. */
  activeMs: number;
  /** Steps per minute over the last few seconds; 0 when stopped. */
  cadence: number;
  /** Km/h derived from cadence and stride. */
  speedKmh: number;
}

export type PedometerStatus =
  | 'idle'
  | 'unsupported'
  | 'permission-required'
  | 'denied'
  | 'running';

type Listener = (snapshot: StepSnapshot, status: PedometerStatus) => void;

interface StoredDay {
  steps: number;
  activeMs: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const localDateKey = (date: Date = new Date()): string => {
  // Local, not UTC: a day boundary the user does not recognise is a bug.
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/**
 * Build a snapshot. `body` personalises distance (height) and calories
 * (weight); omitting it falls back to the documented population defaults, which
 * is what every pre-existing call site does.
 */
export const snapshotFrom = (
  date: string,
  steps: number,
  activeMs: number,
  cadence = 0,
  body: StepBody = {},
): StepSnapshot => ({
  date,
  steps,
  distanceKm: distanceKmFor(steps, body.heightCm),
  calories: caloriesFor(steps, body.weightKg),
  activeMs,
  cadence,
  speedKmh: speedKmhFor(cadence, body.heightCm),
});

/** "1h 18m" / "18m" / "0m" */
export const formatActiveTime = (ms: number): string => {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
};


// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

class Pedometer {
  private status: PedometerStatus = 'idle';
  private listeners = new Set<Listener>();
  /** Height/weight for the formulas. Set once the profile loads. */
  private body: StepBody = {};
  /** Called on every flush so a day can be mirrored to Firestore. */
  private syncHandler: ((snapshot: StepSnapshot) => void) | null = null;

  private date = localDateKey();
  private steps = 0;
  private activeMs = 0;

  // Detection state
  private lastStepAt = 0;
  private lastSampleAt = 0;
  /** Timestamps of recent steps, for cadence. */
  private recent: number[] = [];
  /** Signal -> steps. All thresholds and the rhythm gate live in stepDetection. */
  private pipeline = new StepPipeline();

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private hydrated = false;
  private handler: ((event: DeviceMotionEvent) => void) | null = null;

  // -------------------------------------------------------------------------
  // Public surface
  // -------------------------------------------------------------------------

  getStatus(): PedometerStatus {
    return this.status;
  }

  getSnapshot(): StepSnapshot {
    return snapshotFrom(this.date, this.steps, this.activeMs, this.currentCadence(), this.body);
  }

  /**
   * Personalise the formulas. Re-emits, because the distance and calories on
   * screen were computed with the old body and are now stale by a real margin
   * (a 55 kg user was being shown a 70 kg user's calories until this landed).
   */
  setBody(body: StepBody): void {
    const next = { weightKg: body?.weightKg ?? null, heightCm: body?.heightCm ?? null };
    if (next.weightKg === this.body.weightKg && next.heightCm === this.body.heightCm) return;
    this.body = next;
    this.emit();
  }

  /** Register the Firestore mirror. Called once, from the steps hook. */
  setSyncHandler(handler: ((snapshot: StepSnapshot) => void) | null): void {
    this.syncHandler = handler;
  }

  /**
   * Fold in a delta from the native hardware counter (tier 2).
   *
   * Deltas, not totals: `@capgo/capacitor-pedometer` restarts its own count
   * from zero on every `startMeasurementUpdates()`, so a total would reset the
   * user's day on every app resume. See `lib/nativePedometer.ts`.
   */
  addSteps(delta: number): void {
    const n = Number(delta);
    if (!Number.isFinite(n) || n <= 0) return;
    this.rollDateIfNeeded();
    this.steps += Math.round(n);
    const now = Date.now();
    this.lastStepAt = now;
    this.recent.push(now);
    if (this.recent.length > 240) this.recent.shift();
    this.emit();
    this.scheduleSave();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot(), this.status);
    return () => this.listeners.delete(listener);
  }

  /** True when the platform can report motion at all. */
  static isSupported(): boolean {
    return typeof window !== 'undefined' && typeof DeviceMotionEvent !== 'undefined';
  }

  /**
   * iOS 13+ gates motion behind a user-gesture permission prompt. Returns the
   * resulting status so callers can render an explicit "enable" affordance
   * rather than silently counting nothing.
   */
  async requestPermission(): Promise<PedometerStatus> {
    if (!Pedometer.isSupported()) {
      this.setStatus('unsupported');
      return this.status;
    }
    const anyEvent = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof anyEvent.requestPermission === 'function') {
      try {
        const result = await anyEvent.requestPermission();
        if (result !== 'granted') {
          this.setStatus('denied');
          return this.status;
        }
      } catch {
        this.setStatus('denied');
        return this.status;
      }
    }
    return this.start();
  }

  /** Begin counting. Safe to call repeatedly. */
  async start(): Promise<PedometerStatus> {
    if (!Pedometer.isSupported()) {
      this.setStatus('unsupported');
      return this.status;
    }
    await this.hydrate();
    if (this.handler) {
      this.setStatus('running');
      return this.status;
    }

    // iOS needs an explicit grant that only a user gesture can request.
    const anyEvent = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof anyEvent.requestPermission === 'function' && this.status !== 'running') {
      this.setStatus('permission-required');
      return this.status;
    }

    this.handler = (event: DeviceMotionEvent) => this.onMotion(event);
    window.addEventListener('devicemotion', this.handler);
    this.setStatus('running');
    return this.status;
  }

  stop(): void {
    if (this.handler) {
      window.removeEventListener('devicemotion', this.handler);
      this.handler = null;
    }
    this.flush();
    if (this.status === 'running') this.setStatus('idle');
  }

  /**
   * Fold in an authoritative count from the OS (Health Connect). The device's
   * own counter always wins over our estimate — this exists so the UI can show
   * one number rather than two competing ones.
   */
  async adoptDeviceCount(steps: number): Promise<void> {
    await this.hydrate();
    this.rollDateIfNeeded();
    if (steps > this.steps) {
      this.steps = Math.round(steps);
      this.emit();
      this.scheduleSave();
    }
  }

  /** Read a stored day without starting the sensor. */
  static async readDay(date: string, body: StepBody = {}): Promise<StepSnapshot> {
    try {
      const stored = (await get(STORAGE_PREFIX + date)) as StoredDay | undefined;
      return snapshotFrom(date, stored?.steps ?? 0, stored?.activeMs ?? 0, 0, body);
    } catch {
      return snapshotFrom(date, 0, 0, 0, body);
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private setStatus(status: PedometerStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emit();
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot, this.status);
      } catch {
        // A broken subscriber must not stop the sensor.
      }
    }
  }

  private currentCadence(): number {
    const now = Date.now();
    // Steps in the last 10 seconds, scaled to a per-minute rate.
    const cutoff = now - 10000;
    const recent = this.recent.filter((t) => t >= cutoff);
    if (recent.length < 2) return 0;
    return Math.round((recent.length / 10) * 60);
  }

  private async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    this.date = localDateKey();
    try {
      const stored = (await get(STORAGE_PREFIX + this.date)) as StoredDay | undefined;
      if (stored) {
        this.steps = stored.steps ?? 0;
        this.activeMs = stored.activeMs ?? 0;
      }
    } catch {
      // No IndexedDB (private mode, old webview): count for this session only.
    }
    this.emit();
  }

  private rollDateIfNeeded(): void {
    const today = localDateKey();
    if (today === this.date) return;
    // Persist the finished day before resetting; never merge across midnight.
    this.flush();
    this.date = today;
    this.steps = 0;
    this.activeMs = 0;
    this.recent = [];
    this.pipeline.reset();
  }

  private onMotion(event: DeviceMotionEvent): void {
    const acceleration = event.accelerationIncludingGravity ?? event.acceleration;
    if (!acceleration) return;
    const { x, y, z } = acceleration;
    if (x == null || y == null || z == null) return;

    const now = Date.now();
    this.rollDateIfNeeded();

    // Accumulate active time only while steps are actually happening.
    if (this.lastSampleAt > 0 && this.lastStepAt > 0 && now - this.lastStepAt < CADENCE_GAP_MS) {
      this.activeMs += Math.min(now - this.lastSampleAt, 1000);
    }
    this.lastSampleAt = now;

    const magnitude = Math.sqrt(x * x + y * y + z * z);

    // Everything from here — high-pass, adaptive threshold, hysteresis and the
    // rhythm gate — lives in stepDetection.ts so it can be driven with
    // synthetic gait by the proof harness.
    const credited = this.pipeline.push(magnitude, now);
    if (credited > 0) this.creditSteps(credited, now);
  }

  private creditSteps(count: number, now: number): void {
    this.steps += count;
    this.lastStepAt = now;
    for (let i = 0; i < count; i++) this.recent.push(now);
    while (this.recent.length > 240) this.recent.shift();
    this.emit();
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    // Debounced: IndexedDB writes on every step would be thousands a day.
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 4000);
  }

  private flush(): void {
    const payload: StoredDay = { steps: this.steps, activeMs: this.activeMs };
    void set(STORAGE_PREFIX + this.date, payload).catch(() => {
      // Storage unavailable — the in-memory count still drives the UI.
    });
    if (this.syncHandler && this.steps > 0) {
      try {
        this.syncHandler(this.getSnapshot());
      } catch {
        // A failing mirror must never break local persistence.
      }
    }
  }
}

export const pedometer = new Pedometer();
export const isPedometerSupported = Pedometer.isSupported;
export const readStoredDay = Pedometer.readDay;

// Persist on the way out, so a backgrounded or closed tab does not lose the
// last few seconds of counting.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => pedometer.stop());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') pedometer.stop();
    else void pedometer.start();
  });
}
