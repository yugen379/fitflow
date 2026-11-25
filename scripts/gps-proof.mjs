// GPS maths proof — npm run proof:gps
//
// Synthetic tracks with KNOWN answers go through src/lib/gpsMath.ts. Every
// family of checks has a CONTROL that must FAIL (the same check against a
// pipeline with the relevant gate switched off), which proves the check is
// able to fail at all.

import {
  haversineM, summarize, simplifyForStorage, maxDeviationM, douglasPeucker, elevationGain,
  formatPace, formatDistance, formatSpeed, formatDuration, caloriesFor, routeToSvgPoints, metFor,
} from '../src/lib/gpsMath.ts';

const C = { g: '\x1b[32m', r: '\x1b[31m', b: '\x1b[1m', d: '\x1b[2m', x: '\x1b[0m' };
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`  ${ok ? C.g + 'PASS' : C.r + 'FAIL'}${C.x} ${name}${detail ? `  ${C.d}${detail}${C.x}` : ''}`);
};
/** A control: the assertion must be FALSE for the control to pass. */
const control = (name, assertionHolds, detail = '') => check(`CONTROL ${name}`, !assertionHolds, detail);
const section = (t) => console.log(`\n${C.b}${t}${C.x}`);

// --- deterministic noise -----------------------------------------------------
let seed = Number(process.env.GPS_SEED) || 12345;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const gauss = () => { let u = 0; while (!u) u = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); };

const LAT0 = 3.139, LNG0 = 101.6869; // Kuala Lumpur
const M_LAT = 1 / 111_195; // degrees per metre north
const M_LNG = 1 / (111_195 * Math.cos((LAT0 * Math.PI) / 180));
const at = (xm, ym) => ({ lat: LAT0 + ym * M_LAT, lng: LNG0 + xm * M_LNG });
const T0 = 1_700_000_000_000;

/** Sample a path (fn(distance m) -> {x,y}) at 1 Hz and constant speed. */
function track({ lengthM, speed, path, sigma = 0, acc = 5, alt, startT = T0, seg = 0 }) {
  const pts = [];
  const n = Math.round(lengthM / speed);
  for (let i = 0; i <= n; i++) {
    const s = Math.min(lengthM, i * speed);
    const { x, y } = path(s);
    const p = { ...at(x + sigma * gauss(), y + sigma * gauss()), t: startT + i * 1000, acc, seg };
    if (alt) p.alt = alt(s, i);
    pts.push(p);
  }
  return pts;
}
const straight = (s) => ({ x: s, y: 0 });
const pct = (a, b) => (Math.abs(a - b) / b) * 100;
const fmt = (n, d = 1) => Number(n).toFixed(d);

// =============================================================================
section('Haversine');
{
  const d = haversineM(at(0, 0), at(1000, 0));
  check('1000 m east measures 1000 m ± 1 m', Math.abs(d - 1000) < 1, `${fmt(d, 2)} m`);
  const eq = haversineM({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
  check('1° of longitude at the equator = 111.195 km ± 50 m', Math.abs(eq - 111_195) < 50, `${fmt(eq, 0)} m`);
}

section('Straight 5.00 km at 5:00/km');
const five = track({ lengthM: 5000, speed: 1000 / 300, path: straight, sigma: 2, acc: 5 });
{
  const s = summarize(five, 'run', { weightKg: 70 });
  check('distance within 1%', pct(s.distanceM, 5000) < 1, `${fmt(s.distanceM)} m (${fmt(pct(s.distanceM, 5000), 2)}%)`);
  check('pace 5:00 ± 5 s', Math.abs(s.paceSPerKm - 300) <= 5, `${fmt(s.paceSPerKm)} s/km = ${formatPace(s.paceSPerKm, 'metric').value}`);
  check('5 splits', s.splits.length === 5, `${s.splits.length} splits: ${s.splits.map((x) => `${fmt(x.distanceM, 0)}m/${fmt(x.seconds, 0)}s${x.partial ? '*' : ''}`).join(', ')}`);
  check('first 4 splits are full km at 300 ± 10 s', s.splits.slice(0, 4).every((x) => !x.partial && Math.abs(x.seconds - 300) <= 10));
  check('moving time ≈ elapsed (no stops)', Math.abs(s.movingS - s.elapsedS) <= 5, `${fmt(s.movingS)} / ${fmt(s.elapsedS)} s`);
  // ACSM: VO2 = 3.5 + 0.2*200 = 43.5 -> 12.43 MET * 70 kg * 0.4167 h = 362 kcal
  check('calories match ACSM running (362 ± 15 kcal)', Math.abs(s.calories - 362) <= 15, `${fmt(s.calories, 0)} kcal`);
  const imp = summarize(five, 'run', { units: 'imperial' });
  check('imperial: 3 full mile splits + partial', imp.splits.filter((x) => !x.partial).length === 3 && imp.splits.at(-1).partial, imp.splits.map((x) => fmt(x.distanceM, 0)).join(', '));
  control('a 10% short distance is NOT within 1%', pct(s.distanceM * 0.9, 5000) < 1);
}

section('Loop with ±8 m Gaussian GPS noise (per-axis σ = 8 m), 2 laps of r=300 m');
{
  const R = 300, L = 2 * 2 * Math.PI * R;
  const loop = (s) => ({ x: R * Math.cos(s / R), y: R * Math.sin(s / R) });
  const errs = [], rawErrs = [];
  for (let rep = 0; rep < 5; rep++) {
    const pts = track({ lengthM: L, speed: 3.2, path: loop, sigma: 8, acc: 12 });
    errs.push(pct(summarize(pts, 'run').distanceM, L));
    rawErrs.push(pct(summarize(pts, 'run', { skipJitter: true, skipSmoothing: true, skipAutoPause: true }).distanceM, L));
  }
  const worst = Math.max(...errs);
  check('distance within 3% on every one of 5 noisy tracks', worst < 3, `errors ${errs.map((e) => fmt(e, 2)).join('%, ')}% (true ${fmt(L, 0)} m)`);
  control('raw (unfiltered, unsmoothed) noisy distance is NOT within 3%', Math.min(...rawErrs) < 3, `raw errors ${rawErrs.map((e) => fmt(e, 0)).join('%, ')}%`);
}

section('Injected 300 m teleport spike');
{
  const pts = track({ lengthM: 3000, speed: 3.3, path: straight, sigma: 1, acc: 5 });
  const i = 400;
  pts[i] = { ...pts[i], ...at(400 * 3.3, 300) };
  const s = summarize(pts, 'run');
  check('spike removed: distance within 1%', pct(s.distanceM, 3000) < 1, `${fmt(s.distanceM)} m, spike drops ${s.dropped.spike}`);
  check('spike gate fired', s.dropped.spike >= 1);
  const raw = summarize(pts, 'run', { skipSpike: true });
  control('unfiltered spike track is NOT within 1%', pct(raw.distanceM, 3000) < 1, `${fmt(raw.distanceM)} m`);
  // Bad first fix: the anchor itself is the spike — must re-anchor, not lose the run.
  const bad = track({ lengthM: 2000, speed: 3.3, path: straight, sigma: 1, acc: 5 });
  bad[0] = { ...bad[0], ...at(0, 2000) };
  const sb = summarize(bad, 'run');
  check('a bad FIRST fix does not swallow the whole track', pct(sb.distanceM, 2000) < 2, `${fmt(sb.distanceM)} m`);
  // Cycling at 12 m/s must NOT be treated as spikes.
  const bike = summarize(track({ lengthM: 6000, speed: 12, path: straight, sigma: 1, acc: 5 }), 'cycle');
  check('cycle at 12 m/s keeps its distance', pct(bike.distanceM, 6000) < 1, `${fmt(bike.distanceM)} m, ${formatSpeed(bike.speedMps, 'metric').value} km/h`);
  // Accuracy gate
  const fuzzy = track({ lengthM: 1000, speed: 1.4, path: straight, sigma: 1, acc: 5 }).map((p, k) => (k % 3 === 1 ? { ...p, ...at(0, 50), acc: 60 } : p));
  const sf = summarize(fuzzy, 'walk');
  check('fixes with accuracy > 25 m are dropped', sf.dropped.accuracy > 200 && pct(sf.distanceM, 1000) < 2, `${sf.dropped.accuracy} dropped, ${fmt(sf.distanceM)} m`);
  control('with the accuracy gate off those fixes corrupt the distance', pct(summarize(fuzzy, 'walk', { skipAccuracy: true, skipSpike: true, skipJitter: true, skipSmoothing: true }).distanceM, 1000) < 2);
}

section('Standing still 5 min with ±10 m jitter (95% of fixes inside 10 m: per-axis σ = 4 m)');
{
  const still = [];
  for (let i = 0; i <= 300; i++) still.push({ ...at(4 * gauss(), 4 * gauss()), t: T0 + i * 1000, acc: 10 });
  const s = summarize(still, 'walk');
  check('distance < 30 m', s.distanceM < 30, `${fmt(s.distanceM)} m`);
  check('moving time ≈ 0 (< 15 s)', s.movingS < 15, `${fmt(s.movingS)} s moving of ${fmt(s.elapsedS)} s`);
  const raw = summarize(still, 'walk', { skipJitter: true, skipSmoothing: true, skipAutoPause: true });
  control('with jitter gate, smoothing and auto-pause off, distance is NOT < 30 m', raw.distanceM < 30, `${fmt(raw.distanceM)} m`);
  // Harsher: RMS 10 m radial white noise, with and without the chip's Doppler speed.
  const harsh = [];
  for (let i = 0; i <= 300; i++) harsh.push({ ...at(7.07 * gauss(), 7.07 * gauss()), t: T0 + i * 1000, acc: 10, spd: Math.abs(0.15 * gauss()) });
  const h = summarize(harsh, 'walk');
  check('RMS-10 m jitter WITH Doppler speed: distance < 30 m, moving < 15 s', h.distanceM < 30 && h.movingS < 15, `${fmt(h.distanceM)} m, ${fmt(h.movingS)} s`);
  const hNoDoppler = summarize(harsh.map(({ spd, ...p }) => p), 'walk');
  // Position-only data this noisy cannot be called a standstill inside every
  // 10 s window, so the bound on moving time is looser here (stated, not hidden).
  check('same RMS-10 m track with NO Doppler (position only): distance < 30 m, moving < 60 s', hNoDoppler.distanceM < 30 && hNoDoppler.movingS < 60, `${fmt(hNoDoppler.distanceM)} m, ${fmt(hNoDoppler.movingS)} s`);
  control('auto-pause off: Doppler track is NOT < 30 m', summarize(harsh, 'walk', { skipAutoPause: true }).distanceM < 30);
  // Doppler must not pause a real walk.
  const walk = track({ lengthM: 500, speed: 1.4, path: straight, sigma: 2, acc: 5 }).map((p) => ({ ...p, spd: 1.4 + 0.2 * gauss() }));
  const sw = summarize(walk, 'walk');
  check('Doppler 1.4 m/s walk is never auto-paused', Math.abs(sw.movingS - sw.elapsedS) <= 2 && pct(sw.distanceM, 500) < 2, `${fmt(sw.movingS)} / ${fmt(sw.elapsedS)} s, ${fmt(sw.distanceM)} m`);
}

section('Square 4 × 250 m with corners, σ = 4 m — smoothing must not cut corners');
{
  const sq = (s) => { const e = s % 1000, k = Math.floor(e / 250), r = e - k * 250; return [{ x: r, y: 0 }, { x: 250, y: r }, { x: 250 - r, y: 250 }, { x: 0, y: 250 - r }][k]; };
  for (const [act, v] of [['walk', 1.4], ['run', 3.3], ['cycle', 8]]) {
    const s = summarize(track({ lengthM: 2000, speed: v, path: sq, sigma: 4, acc: 6 }), act);
    check(`${act} square: distance within 3%`, pct(s.distanceM, 2000) < 3, `${fmt(s.distanceM)} m (${fmt(pct(s.distanceM, 2000), 2)}%)`);
  }
}

section('Auto-pause: run 1 km, stop 60 s, run 1 km');
{
  const a = track({ lengthM: 1000, speed: 1000 / 300, path: straight, sigma: 1, acc: 5 });
  const tStop = a.at(-1).t;
  const stop = [];
  for (let i = 1; i <= 60; i++) stop.push({ ...at(1000 + 2 * gauss(), 2 * gauss()), t: tStop + i * 1000, acc: 5 });
  const b = track({ lengthM: 1000, speed: 1000 / 300, path: (s) => ({ x: 1000 + s, y: 0 }), sigma: 1, acc: 5, startT: tStop + 61_000 });
  const pts = [...a, ...stop, ...b];
  const s = summarize(pts, 'run');
  check('moving time ≈ 600 s (± 15)', Math.abs(s.movingS - 600) <= 15, `moving ${fmt(s.movingS)} s, elapsed ${fmt(s.elapsedS)} s`);
  check('elapsed ≈ 661 s', Math.abs(s.elapsedS - 661) <= 2);
  check('distance within 1% of 2000 m', pct(s.distanceM, 2000) < 1, `${fmt(s.distanceM)} m`);
  const noPause = summarize(pts, 'run', { skipAutoPause: true });
  control('without auto-pause moving time is NOT ≈ 600 s', Math.abs(noPause.movingS - 600) <= 15, `${fmt(noPause.movingS)} s`);
  // A 6 s stop at a crossing is shorter than the 10 s threshold and must count as moving.
  const brief = [...a, ...stop.slice(0, 6), ...track({ lengthM: 1000, speed: 1000 / 300, path: (x) => ({ x: 1000 + x, y: 0 }), sigma: 1, acc: 5, startT: tStop + 7_000 })];
  const sb = summarize(brief, 'run');
  check('a 6 s stop (< 10 s) is NOT auto-paused', Math.abs(sb.movingS - sb.elapsedS) <= 2, `${fmt(sb.movingS)} / ${fmt(sb.elapsedS)} s`);
  // User pause = new segment; the gap is neither elapsed nor distance.
  const seg2 = track({ lengthM: 1000, speed: 1000 / 300, path: (x) => ({ x: 5000 + x, y: 0 }), sigma: 1, acc: 5, startT: tStop + 3_600_000, seg: 1 });
  const su = summarize([...a, ...seg2], 'run');
  check('a user pause never bridges distance or time', pct(su.distanceM, 2000) < 1 && Math.abs(su.elapsedS - 600) <= 2, `${fmt(su.distanceM)} m, ${fmt(su.elapsedS)} s`);
}

section('Elevation gain, 3 m hysteresis');
{
  // Peak-to-peak strictly under the 3 m band: ±1.2 m sine + up to ±0.25 m noise.
  const flat = Array.from({ length: 600 }, (_, i) => 50 + 1.2 * Math.sin(i / 3) + 0.5 * (rand() - 0.5));
  check('flat with ±1.45 m wobble gains 0 m', elevationGain(flat) === 0, `${fmt(elevationGain(flat))} m`);
  control('with no hysteresis the wobble counts as climbing', elevationGain(flat, 0) === 0, `${fmt(elevationGain(flat, 0))} m`);
  const climb = Array.from({ length: 600 }, (_, i) => 50 + (i / 600) * 50 + 1.2 * Math.sin(i / 2));
  const g = elevationGain(climb);
  check('a 50 m climb with wobble gains 50 ± 4 m', Math.abs(g - 50) <= 4, `${fmt(g)} m`);
  const s = summarize(track({ lengthM: 1000, speed: 3, path: straight, sigma: 1, acc: 5, alt: (d) => 10 + d * 0.03 }), 'run');
  check('summarize reports a 30 m climb', Math.abs(s.elevationGainM - 30) <= 4, `${fmt(s.elevationGainM)} m`);
}

section('Douglas-Peucker simplification for storage');
{
  const R = 400;
  const big = track({ lengthM: 3 * 2 * Math.PI * R, speed: 1.0, path: (s) => ({ x: R * Math.cos(s / R) + 30 * Math.sin(s / 37), y: R * Math.sin(s / R) }), sigma: 0.5 });
  const { points, toleranceM } = simplifyForStorage(big);
  check('≤ 500 points', points.length <= 500, `${big.length} -> ${points.length} at ${toleranceM} m tolerance`);
  check('keeps both endpoints', points[0] === big[0] && points.at(-1) === big.at(-1));
  const dev = maxDeviationM(big, points);
  check('every original point within tolerance', dev <= toleranceM + 1e-6, `max deviation ${fmt(dev, 2)} m ≤ ${toleranceM} m`);
  const crude = [big[0], big.at(-1)];
  control('a 2-point "simplification" is NOT within tolerance', maxDeviationM(big, crude) <= toleranceM, `${fmt(maxDeviationM(big, crude), 0)} m`);
  const routeBytes = JSON.stringify(points.map((p) => ({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) }))).length;
  check('stored route < 40 KB (doc limit 1 MB)', routeBytes < 40_000, `${routeBytes} bytes`);
  check('short tracks are left alone', douglasPeucker(big.slice(0, 2), 5).length === 2);
}

section('Formatters & calories');
{
  check('formatPace metric 300 s/km = 5:00', formatPace(300, 'metric').value === '5:00');
  check('formatPace imperial 300 s/km = 8:03 /mi', formatPace(300, 'imperial').value === '8:03' && formatPace(300, 'imperial').unit === '/mi');
  check('formatDistance 5000 m = 5.00 km / 3.11 mi', formatDistance(5000, 'metric').value === '5.00' && formatDistance(5000, 'imperial').value === '3.11');
  check('formatSpeed 10 m/s = 36.0 km/h / 22.4 mph', formatSpeed(10, 'metric').value === '36.0' && formatSpeed(10, 'imperial').value === '22.4');
  check('formatDuration 3725 s = 1:02:05', formatDuration(3725) === '1:02:05' && formatDuration(65) === '1:05');
  check('no pace yet renders --:--', formatPace(0, 'metric').value === '--:--' && formatPace(NaN, 'metric').value === '--:--');
  check('walk 1 h at 70 kg = 245 kcal (MET 3.5)', Math.round(caloriesFor('walk', 70, 3600, 1.4)) === 245);
  check('cycle 1 h at 80 kg = 600 kcal (MET 7.5)', Math.round(caloriesFor('cycle', 80, 3600, 6)) === 600);
  check('faster running burns more (ACSM)', metFor('run', 4) > metFor('run', 3));
  check('svg polyline fits a 300×200 box', routeToSvgPoints(five, 300, 200).split(' ').every((xy) => { const [x, y] = xy.split(',').map(Number); return x >= 0 && x <= 300 && y >= 0 && y <= 200; }));
}

section('Fuzz: 1000 random tracks');
{
  let bad = 0, firstBad = '';
  for (let k = 0; k < 1000; k++) {
    const n = Math.floor(rand() * 300);
    const acts = ['walk', 'run', 'cycle'];
    const act = acts[k % 3];
    const pts = [];
    let t = T0, x = 0, y = 0;
    for (let i = 0; i < n; i++) {
      t += Math.floor(rand() * 5000) - (rand() < 0.02 ? 3000 : 0); // occasional time going backwards
      x += (rand() - 0.5) * 40; y += (rand() - 0.5) * 40;
      const p = { ...at(x, y), t, acc: rand() * 60, seg: rand() < 0.02 ? 1 : 0 };
      if (rand() < 0.3) p.alt = rand() * 100;
      if (rand() < 0.01) p.lat = NaN;
      if (rand() < 0.005) p.lng = 999;
      if (rand() < 0.01) delete p.acc;
      pts.push(p);
    }
    const s = summarize(pts, act, { weightKg: rand() < 0.1 ? NaN : 30 + rand() * 100, units: rand() < 0.5 ? 'metric' : 'imperial' });
    const nums = [s.distanceM, s.elapsedS, s.movingS, s.paceSPerKm, s.speedMps, s.elevationGainM, s.calories, ...s.splits.flatMap((x) => [x.distanceM, x.seconds])];
    const simp = simplifyForStorage(s.cleaned);
    const ok = nums.every((v) => Number.isFinite(v) && v >= 0) && s.movingS <= s.elapsedS + 1e-6 && simp.points.length <= 500 &&
      s.cleaned.every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (!ok) { bad++; if (!firstBad) firstBad = JSON.stringify(nums); }
  }
  check('all 1000 summaries finite and non-negative, moving ≤ elapsed, route ≤ 500', bad === 0, bad ? `${bad} bad, e.g. ${firstBad}` : '1000/1000');
  control('the fuzz validator rejects a NaN', [NaN].every((v) => Number.isFinite(v) && v >= 0));
  control('the fuzz validator rejects a negative', [-1].every((v) => Number.isFinite(v) && v >= 0));
}

// =============================================================================
const total = results.length, ok = results.filter((r) => r.ok).length;
const controls = results.filter((r) => r.name.startsWith('CONTROL')).length;
console.log(`\n${C.b}Result: ${ok === total ? C.g : C.r}${ok}/${total}${C.x}${C.b} checks passed${C.x} ${C.d}(${controls} of them controls that must fail)${C.x}`);
if (ok === total) console.log(`${C.g}${C.b}100% success, zero errors${C.x}\n`);
else { console.log(`${C.r}${C.b}${total - ok} FAILED${C.x}\n`); process.exit(1); }
