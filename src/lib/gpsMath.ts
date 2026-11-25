/**
 * GPS track maths for walk / run / cycle recording.
 *
 * Pure: no Capacitor, no Firebase, no DOM. It is exercised directly by
 * scripts/gps-proof.mjs against synthetic tracks with known answers, and it is
 * what both the native (GpsTracker) and the web (watchPosition) paths feed.
 *
 * Pipeline, per recording segment (a user pause starts a new segment):
 *   1. accuracy gate      — drop fixes worse than 25 m
 *   2. spike gate         — drop fixes implying an impossible speed for the activity
 *   3. jitter gate        — drop fixes still inside the accuracy radius of the last kept one
 *   4. RTS Kalman smooth  — constant-velocity model in local metres; removes the
 *                           zig-zag that otherwise inflates distance by tens of %
 *   5. metrics            — distance / moving time with auto-pause, splits, elevation
 */

export type GpsActivity = 'walk' | 'run' | 'cycle';
export type UnitSystem = 'metric' | 'imperial';

export interface GpsPoint {
  lat: number;
  lng: number;
  /** Epoch milliseconds. */
  t: number;
  /** Horizontal accuracy in metres (Android: 68% radius). */
  acc?: number;
  /** Altitude in metres, if the fix has one. */
  alt?: number;
  /** Doppler speed from the GPS chip (m/s), when the fix has one. Far more reliable than position differences at a standstill. */
  spd?: number;
  /** Recording segment; increments on every user resume. Distance never bridges segments. */
  seg?: number;
}

export interface Split {
  /** 1-based. */
  index: number;
  /** Distance covered in this split, metres (the unit length, or less for the final partial split). */
  distanceM: number;
  /** Moving seconds spent on this split. */
  seconds: number;
  partial: boolean;
}

export interface TrackSummary {
  distanceM: number;
  /** Wall-clock seconds across segments (user pauses excluded). */
  elapsedS: number;
  /** Elapsed minus auto-paused time. */
  movingS: number;
  /** Seconds per km over moving time; 0 when there is no distance. */
  paceSPerKm: number;
  /** Metres per second over moving time. */
  speedMps: number;
  splits: Split[];
  elevationGainM: number;
  calories: number;
  /** Filtered + smoothed points actually used for the numbers. */
  cleaned: GpsPoint[];
  /** How many raw fixes each gate removed (diagnostics). */
  dropped: { accuracy: number; spike: number; jitter: number };
}

export const MAX_ACCURACY_M = 25;
export const MAX_SPEED_MPS: Record<GpsActivity, number> = { walk: 4, run: 8, cycle: 25 };
export const AUTO_PAUSE_SPEED_MPS = 0.5;
/** Position-only resume threshold. A Schmitt trigger: once paused, jitter that
 *  momentarily reads 0.5 m/s must not flicker the clock back on. */
export const AUTO_RESUME_SPEED_MPS = 1.0;
export const AUTO_PAUSE_AFTER_S = 10;
export const ELEVATION_HYSTERESIS_M = 3;
export const MAX_STORED_POINTS = 500;
const EARTH_R = 6_371_008.8;
const MILE_M = 1609.344;
/** Process noise (m/s^2) for the Kalman smoother: how hard each activity can change velocity. */
// Tuned on the proof's synthetic tracks: higher values let white position noise
// through as distance; much lower values start cutting real corners.
const ACCEL_SIGMA: Record<GpsActivity, number> = { walk: 0.15, run: 0.3, cycle: 1.6 };

const rad = (d: number) => (d * Math.PI) / 180;
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Great-circle distance in metres. */
export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Equirectangular projection around an origin; accurate to well under 0.1% over a city. */
function projector(origin: { lat: number; lng: number }) {
  const k = Math.cos(rad(origin.lat));
  return {
    toXY: (p: { lat: number; lng: number }) => ({
      x: rad(p.lng - origin.lng) * EARTH_R * k,
      y: rad(p.lat - origin.lat) * EARTH_R,
    }),
    toLatLng: (x: number, y: number) => ({
      lat: origin.lat + (y / EARTH_R) * (180 / Math.PI),
      lng: origin.lng + (x / (EARTH_R * (k || 1e-9))) * (180 / Math.PI),
    }),
  };
}

function validPoint(p: GpsPoint): boolean {
  return isNum(p.lat) && isNum(p.lng) && isNum(p.t) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

/** Split raw points by `seg`, keeping time order inside each. */
function segments(points: GpsPoint[]): GpsPoint[][] {
  const bySeg = new Map<number, GpsPoint[]>();
  for (const p of points) {
    if (!validPoint(p)) continue;
    const s = isNum(p.seg) ? p.seg : 0;
    if (!bySeg.has(s)) bySeg.set(s, []);
    bySeg.get(s)!.push(p);
  }
  return [...bySeg.keys()].sort((a, b) => a - b).map((k) => bySeg.get(k)!.slice().sort((a, b) => a.t - b.t));
}

export interface FilterOptions {
  /** Disable individual gates — used by the proof's controls. */
  skipSpike?: boolean;
  skipJitter?: boolean;
  skipAccuracy?: boolean;
}

/** Gates 1–3 on one segment. */
export function filterPoints(
  seg: GpsPoint[],
  activity: GpsActivity,
  opts: FilterOptions = {},
): { kept: GpsPoint[]; dropped: { accuracy: number; spike: number; jitter: number } } {
  const dropped = { accuracy: 0, spike: 0, jitter: 0 };
  const kept: GpsPoint[] = [];
  const vmax = MAX_SPEED_MPS[activity];
  let rejectRun: GpsPoint[] = [];
  let tail: GpsPoint | null = null;
  for (const p of seg) {
    if (!opts.skipAccuracy && isNum(p.acc) && p.acc > MAX_ACCURACY_M) { dropped.accuracy++; continue; }
    const last = kept[kept.length - 1];
    if (!last) { kept.push(p); continue; }
    const dt = (p.t - last.t) / 1000;
    if (dt <= 0) { dropped.jitter++; continue; }
    const d = haversineM(last, p);
    if (!opts.skipSpike && d / dt > vmax) {
      // A single wild fix is a spike. But if the *anchor* was the bad one, every
      // later fix looks impossible relative to it — so after 5 consecutive
      // rejections that agree with each other, believe them and re-anchor.
      rejectRun.push(p);
      const consistent = rejectRun.length >= 5 && rejectRun.every((q, i) =>
        i === 0 || haversineM(rejectRun[i - 1], q) / Math.max(1e-3, (q.t - rejectRun[i - 1].t) / 1000) <= vmax);
      if (consistent) {
        // The anchor was the outlier (or the signal came back far away after a
        // gap): drop it if it was isolated, and start a fresh piece so the jump
        // itself is never counted as distance.
        const prev = kept[kept.length - 2];
        if (!prev || (last as GpsPoint & { brk?: boolean }).brk) { kept.pop(); dropped.spike++; }
        rejectRun.forEach((q, i) => kept.push(i === 0 ? { ...q, brk: true } as GpsPoint : q));
        rejectRun = [];
      } else {
        dropped.spike++;
        if (rejectRun.length > 5) rejectRun.shift();
      }
      continue;
    }
    rejectRun = [];
    const radius = Math.max(isNum(p.acc) ? p.acc : 0, isNum(last.acc) ? last.acc : 0);
    if (!opts.skipJitter && d < radius) { dropped.jitter++; tail = p; continue; }
    tail = null;
    kept.push(p);
  }
  // Keep the segment's final fix even if it sat inside the jitter radius, so
  // the cleaned track ends when the recording did (moving time can't fall short
  // of elapsed for a session that never stopped).
  if (tail && kept.length && tail.t > kept[kept.length - 1].t) { kept.push(tail); dropped.jitter--; }
  return { kept, dropped };
}

/**
 * Rauch-Tung-Striebel smoother, constant-velocity model, independent x/y axes.
 * Measurement sigma comes from each fix's accuracy (68% radius ≈ 1.5 per-axis sigma).
 */
export function smoothTrack(seg: GpsPoint[], activity: GpsActivity): GpsPoint[] {
  if (seg.length < 3) return seg.slice();
  const proj = projector(seg[0]);
  const xy = seg.map((p) => proj.toXY(p));
  const q = ACCEL_SIGMA[activity] ** 2;
  const out = seg.map((p) => ({ ...p }));
  for (const axis of ['x', 'y'] as const) {
    const n = seg.length;
    const xf: number[][] = [], Pf: number[][][] = [], xp: number[][] = [], Pp: number[][][] = [], dts: number[] = [];
    let x = [xy[0][axis], 0];
    const r0 = Math.max(3, (seg[0].acc ?? 10) / 1.5);
    let P = [[r0 * r0, 0], [0, 25]];
    for (let k = 0; k < n; k++) {
      const dt = k === 0 ? 0 : Math.max(0.001, (seg[k].t - seg[k - 1].t) / 1000);
      dts.push(dt);
      // predict
      const xpk = [x[0] + dt * x[1], x[1]];
      const dt2 = dt * dt, dt3 = dt2 * dt, dt4 = dt3 * dt;
      const Ppk = [
        [P[0][0] + dt * (P[1][0] + P[0][1]) + dt2 * P[1][1] + q * dt4 / 4, P[0][1] + dt * P[1][1] + q * dt3 / 2],
        [P[1][0] + dt * P[1][1] + q * dt3 / 2, P[1][1] + q * dt2],
      ];
      // update
      const sigma = Math.max(3, (seg[k].acc ?? 10) / 1.5);
      const S = Ppk[0][0] + sigma * sigma;
      const K = [Ppk[0][0] / S, Ppk[1][0] / S];
      const yres = xy[k][axis] - xpk[0];
      x = [xpk[0] + K[0] * yres, xpk[1] + K[1] * yres];
      P = [
        [(1 - K[0]) * Ppk[0][0], (1 - K[0]) * Ppk[0][1]],
        [Ppk[1][0] - K[1] * Ppk[0][0], Ppk[1][1] - K[1] * Ppk[0][1]],
      ];
      xp.push(xpk); Pp.push(Ppk); xf.push(x); Pf.push(P);
    }
    // backward pass
    const xs = xf.map((v) => v.slice());
    for (let k = n - 2; k >= 0; k--) {
      const dt = dts[k + 1];
      const Pk = Pf[k], Pn = Pp[k + 1];
      // C = Pk F^T Pn^-1
      const PFt = [[Pk[0][0] + dt * Pk[0][1], Pk[0][1]], [Pk[1][0] + dt * Pk[1][1], Pk[1][1]]];
      const det = Pn[0][0] * Pn[1][1] - Pn[0][1] * Pn[1][0];
      if (!isNum(det) || Math.abs(det) < 1e-12) continue;
      const inv = [[Pn[1][1] / det, -Pn[0][1] / det], [-Pn[1][0] / det, Pn[0][0] / det]];
      const C = [
        [PFt[0][0] * inv[0][0] + PFt[0][1] * inv[1][0], PFt[0][0] * inv[0][1] + PFt[0][1] * inv[1][1]],
        [PFt[1][0] * inv[0][0] + PFt[1][1] * inv[1][0], PFt[1][0] * inv[0][1] + PFt[1][1] * inv[1][1]],
      ];
      const d0 = xs[k + 1][0] - xp[k + 1][0], d1 = xs[k + 1][1] - xp[k + 1][1];
      xs[k] = [xf[k][0] + C[0][0] * d0 + C[0][1] * d1, xf[k][1] + C[1][0] * d0 + C[1][1] * d1];
    }
    for (let k = 0; k < n; k++) (xy[k] as any)['s' + axis] = xs[k][0];
  }
  for (let k = 0; k < out.length; k++) {
    const s = xy[k] as any;
    if (isNum(s.sx) && isNum(s.sy)) {
      const ll = proj.toLatLng(s.sx, s.sy);
      out[k].lat = ll.lat; out[k].lng = ll.lng;
    }
  }
  return out;
}

/** Elevation gain with a hysteresis band: wobbles smaller than `band` never count. */
export function elevationGain(alts: number[], band = ELEVATION_HYSTERESIS_M): number {
  let ref: number | null = null, gain = 0;
  for (const a of alts) {
    if (!isNum(a)) continue;
    if (ref === null) { ref = a; continue; }
    if (a - ref >= band) { gain += a - ref; ref = a; }
    else if (ref - a >= band) ref = a;
  }
  return gain;
}

/** MET for the activity. Running uses the ACSM equation: VO2 = 3.5 + 0.2 * speed(m/min). */
export function metFor(activity: GpsActivity, speedMps: number): number {
  if (activity === 'walk') return 3.5;
  if (activity === 'cycle') return 7.5;
  const vo2 = 3.5 + 0.2 * Math.max(0, speedMps) * 60;
  return Math.min(23, Math.max(6, vo2 / 3.5));
}

export function caloriesFor(activity: GpsActivity, weightKg: number, movingS: number, speedMps: number): number {
  const kg = isNum(weightKg) && weightKg > 20 && weightKg < 400 ? weightKg : 70;
  const kcal = metFor(activity, speedMps) * kg * (Math.max(0, movingS) / 3600);
  return isNum(kcal) ? kcal : 0;
}

export interface SummaryOptions extends FilterOptions {
  weightKg?: number;
  /** Split length; defaults to 1 km (or 1 mi for imperial). */
  units?: UnitSystem;
  /** Skip auto-pause (used by the proof's control). */
  skipAutoPause?: boolean;
  /** Skip the Kalman smoother (used by the proof's control). */
  skipSmoothing?: boolean;
}

export function summarize(points: GpsPoint[], activity: GpsActivity, opts: SummaryOptions = {}): TrackSummary {
  const splitLen = opts.units === 'imperial' ? MILE_M : 1000;
  const dropped = { accuracy: 0, spike: 0, jitter: 0 };
  const cleaned: GpsPoint[] = [];
  let distanceM = 0, elapsedS = 0, movingS = 0, elevationGainM = 0;
  const splits: Split[] = [];
  let splitD = 0, splitT = 0;

  const pushSplitProgress = (d: number, t: number) => {
    // Distribute one moving step across split boundaries, interpolating time.
    while (d > 0) {
      const room = splitLen - splitD;
      if (d >= room) {
        const frac = room / d;
        splitT += t * frac;
        splits.push({ index: splits.length + 1, distanceM: splitLen, seconds: splitT, partial: false });
        d -= room; t -= t * frac; splitD = 0; splitT = 0;
      } else { splitD += d; splitT += t; d = 0; }
    }
  };

  for (const raw of segments(points)) {
    const f = filterPoints(raw, activity, opts);
    dropped.accuracy += f.dropped.accuracy; dropped.spike += f.dropped.spike; dropped.jitter += f.dropped.jitter;
    if (raw.length >= 2) elapsedS += Math.max(0, (raw[raw.length - 1].t - raw[0].t) / 1000);
    const pieces: GpsPoint[][] = [];
    for (const p of f.kept) {
      if ((p as GpsPoint & { brk?: boolean }).brk || !pieces.length) pieces.push([]);
      const { brk: _b, ...clean } = p as GpsPoint & { brk?: boolean };
      pieces[pieces.length - 1].push(clean);
    }
    for (const piece of pieces) {
      const seg = opts.skipSmoothing ? piece : smoothTrack(piece, activity);
      cleaned.push(...seg);
      elevationGainM += elevationGain(seg.map((p) => p.alt as number).filter(isNum));

      // Auto-pause: a step counts as stopped when the NET displacement over the
      // AUTO_PAUSE_AFTER_S window is below AUTO_PAUSE_SPEED_MPS — i.e.
      // "slower than 0.5 m/s for more than 10 s". Net displacement, not summed
      // step lengths, because standing-still jitter has length but goes nowhere.
      // Stopped steps contribute neither time nor (jitter) distance.
      let wasStopped = false;
      // Doppler pre-pass: a step is slow when both its fixes report < 0.5 m/s;
      // a contiguous run of slow steps lasting > 10 s is a stop. Exactly the
      // rule, no windows needed.
      const dopplerStop = new Uint8Array(seg.length);
      for (let i = 1; i < seg.length;) {
        const slow = (k: number) => isNum(seg[k].spd) && isNum(seg[k - 1].spd) &&
          seg[k].spd! < AUTO_PAUSE_SPEED_MPS && seg[k - 1].spd! < AUTO_PAUSE_SPEED_MPS;
        if (!slow(i)) { i++; continue; }
        let e = i;
        while (e + 1 < seg.length && slow(e + 1)) e++;
        if ((seg[e].t - seg[i - 1].t) / 1000 > AUTO_PAUSE_AFTER_S) for (let k = i; k <= e; k++) dopplerStop[k] = 1;
        i = e + 1;
      }
      for (let i = 1; i < seg.length; i++) {
        const d = haversineM(seg[i - 1], seg[i]);
        const t = Math.max(0, (seg[i].t - seg[i - 1].t) / 1000);
        if (!isNum(d) || !isNum(t)) continue;
        let stopped = false;
        if (!opts.skipAutoPause && isNum(seg[i].spd)) {
          stopped = dopplerStop[i] === 1;
        } else if (!opts.skipAutoPause) {
          const thr = wasStopped ? AUTO_RESUME_SPEED_MPS : AUTO_PAUSE_SPEED_MPS;
          if (t >= AUTO_PAUSE_AFTER_S) stopped = d / t < thr; // a long gap is its own window
          else {
            // Window CENTRED on this step (so neither a stop nor a restart is
            // judged late), widened one fix at a time until it spans 10 s.
            let a = i - 1, b = i;
            while ((seg[b].t - seg[a].t) / 1000 < AUTO_PAUSE_AFTER_S && (a > 0 || b < seg.length - 1)) {
              const growBack = a > 0 && (b === seg.length - 1 || (seg[i].t - seg[a].t) <= (seg[b].t - seg[i - 1].t));
              if (growBack) a--; else b++;
            }
            const span = (seg[b].t - seg[a].t) / 1000;
            if (span >= AUTO_PAUSE_AFTER_S) stopped = haversineM(seg[a], seg[b]) / span < thr;
          }
        }
        wasStopped = stopped;
        if (stopped) continue;
        distanceM += d; movingS += t; pushSplitProgress(d, t);
      }
    }
  }
  // A tail under 5% of a split is GPS noise at the finish, not a split.
  if (splitD >= splitLen * 0.05) splits.push({ index: splits.length + 1, distanceM: splitD, seconds: splitT, partial: true });

  const speedMps = movingS > 0 ? distanceM / movingS : 0;
  const paceSPerKm = distanceM > 0 ? movingS / (distanceM / 1000) : 0;
  return {
    distanceM,
    elapsedS,
    movingS,
    paceSPerKm,
    speedMps,
    splits,
    elevationGainM,
    calories: caloriesFor(activity, opts.weightKg ?? 70, movingS, speedMps),
    cleaned,
    dropped,
  };
}

/** Perpendicular distance from p to segment ab, in projected metres. */
function segDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Douglas-Peucker at a fixed tolerance (metres). Iterative; always keeps both endpoints. */
export function douglasPeucker<T extends { lat: number; lng: number }>(pts: T[], toleranceM: number): T[] {
  if (pts.length <= 2) return pts.slice();
  const proj = projector(pts[0]);
  const xy = pts.map((p) => proj.toXY(p));
  const keep = new Uint8Array(pts.length);
  keep[0] = 1; keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = -1, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDist(xy[i], xy[s], xy[e]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx > 0 && maxD > toleranceM) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Simplify until at most `maxPoints` remain, doubling the tolerance from 2 m. */
export function simplifyForStorage<T extends { lat: number; lng: number }>(
  pts: T[], maxPoints = MAX_STORED_POINTS,
): { points: T[]; toleranceM: number } {
  let tol = 2;
  let out = douglasPeucker(pts, tol);
  while (out.length > maxPoints && tol < 1e6) { tol *= 2; out = douglasPeucker(pts, tol); }
  if (out.length > maxPoints) {
    // Pathological input (e.g. all points collinear but > max after rounding):
    // fall back to an even stride that still keeps the endpoints.
    const step = (out.length - 1) / (maxPoints - 1);
    out = Array.from({ length: maxPoints }, (_, i) => out[Math.round(i * step)]);
  }
  return { points: out, toleranceM: tol };
}

/** Max distance (m) from any original point to the simplified polyline. */
export function maxDeviationM(orig: { lat: number; lng: number }[], simp: { lat: number; lng: number }[]): number {
  if (!orig.length || !simp.length) return 0;
  const proj = projector(orig[0]);
  const sxy = simp.map((p) => proj.toXY(p));
  let worst = 0;
  for (const p of orig) {
    const q = proj.toXY(p);
    let best = Infinity;
    for (let i = 1; i < sxy.length; i++) best = Math.min(best, segDist(q, sxy[i - 1], sxy[i]));
    if (sxy.length === 1) best = Math.hypot(q.x - sxy[0].x, q.y - sxy[0].y);
    worst = Math.max(worst, best);
  }
  return worst;
}

// ---------------------------------------------------------------- formatting

export function formatDuration(totalS: number): string {
  const s = Math.max(0, Math.floor(isNum(totalS) ? totalS : 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0'), ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDistance(m: number, units: UnitSystem): { value: string; unit: string } {
  const v = Math.max(0, isNum(m) ? m : 0);
  return units === 'imperial'
    ? { value: (v / MILE_M).toFixed(2), unit: 'mi' }
    : { value: (v / 1000).toFixed(2), unit: 'km' };
}

/** Pace from seconds-per-km; '--:--' when there is no meaningful pace yet. */
export function formatPace(sPerKm: number, units: UnitSystem): { value: string; unit: string } {
  const unit = units === 'imperial' ? '/mi' : '/km';
  if (!isNum(sPerKm) || sPerKm <= 0 || sPerKm > 3600) return { value: '--:--', unit };
  const s = Math.round(units === 'imperial' ? sPerKm * (MILE_M / 1000) : sPerKm);
  return { value: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, unit };
}

export function formatSpeed(mps: number, units: UnitSystem): { value: string; unit: string } {
  const v = Math.max(0, isNum(mps) ? mps : 0) * 3.6;
  return units === 'imperial' ? { value: (v / 1.609344).toFixed(1), unit: 'mph' } : { value: v.toFixed(1), unit: 'km/h' };
}

/** Fit points into a w×h box (with padding) as an SVG polyline `points` string. */
export function routeToSvgPoints(pts: { lat: number; lng: number }[], w: number, h: number, pad = 8): string {
  if (pts.length < 2) return '';
  const proj = projector(pts[0]);
  const xy = pts.map((p) => proj.toXY(p));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of xy) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  // At least 20 m of span so a stationary blob is not blown up to fill the box.
  const scale = Math.min((w - 2 * pad) / Math.max(maxX - minX, 20), (h - 2 * pad) / Math.max(maxY - minY, 20));
  const s = isNum(scale) && scale > 0 ? scale : 1;
  const ox = (w - (maxX - minX) * s) / 2, oy = (h - (maxY - minY) * s) / 2;
  return xy.map((p) => `${(ox + (p.x - minX) * s).toFixed(1)},${(h - oy - (p.y - minY) * s).toFixed(1)}`).join(' ');
}
