// Tests for turning Health Connect records into FitFlow data (src/lib/healthImport.ts).
import fs from 'node:fs';
import path from 'node:path';
import { massToKg, weightsToImport, importedWeightId, latestRestingHr, summarizeLastNight, sleepQuality, importedSleepId } from '../src/lib/healthImport.ts';
import { localDate } from '../src/lib/adaptiveTarget.ts';

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); };

// --- Units -------------------------------------------------------------------
ok('kg stays kg', massToKg({ value: 72.4, unit: 'kilograms' }) === 72.4);
ok('grams -> kg', massToKg({ value: 72400, unit: 'grams' }) === 72.4);
ok('pounds -> kg (160 lb = 72.57 kg)', Math.abs(massToKg({ value: 160, unit: 'pounds' }) - 72.5748) < 0.001);
ok('ounces -> kg', Math.abs(massToKg({ value: 2560, unit: 'ounces' }) - 72.5748) < 0.001);
ok('plugin unit names (singular): pound / gram / kilogram', Math.abs(massToKg({ value: 160, unit: 'pound' }) - 72.5748) < 0.001 && massToKg({ value: 72400, unit: 'gram' }) === 72.4 && massToKg({ value: 72.4, unit: 'kilogram' }) === 72.4);
ok('no unit = kg', massToKg({ value: 70 }) === 70);
ok('junk -> null', massToKg(null) === null && massToKg({ value: 'x' }) === null && massToKg({ value: -3 }) === null);

// --- Which weigh-ins to import --------------------------------------------------
const NOW = new Date(2026, 10, 26, 20, 0);            // local time
const at = (d, h) => new Date(2026, 10, d, h, 0).toISOString();
const recs = [
  { time: at(20, 7), kg: 80.2 },
  { time: at(20, 21), kg: 80.9 },                      // later the same day -> this one
  { time: at(22, 7), kg: 79.8 },
  { time: at(24, 7), kg: 79.5 },                      // user typed a weight on the 24th
  { time: at(25, 7), kg: 900 },                       // scale glitch
  { time: at(25, 8), kg: 12 },                        // a child on the scale
  { time: at(27, 7), kg: 79.0 },                      // in the future
  { time: 'nonsense', kg: 79 },
];
const typed = [localDate(new Date(2026, 10, 24, 9))];
const out = weightsToImport(recs, typed, NOW);
ok('one per day, latest that day (20th -> 80.9)', out.find((w) => w.date === localDate(new Date(2026, 10, 20)))?.kg === 80.9);
ok('a day the user typed a weight is left alone', !out.some((w) => w.date === typed[0]));
ok('impossible weights (900 kg, 12 kg) dropped', !out.some((w) => w.kg > 400 || w.kg < 25));
ok('future and unparseable times dropped', out.length === 2);
ok('newest first', out[0].at > out[1].at);
ok('rounded to 0.1 kg', out.every((w) => Math.round(w.kg * 10) === w.kg * 10));
ok('max respected', weightsToImport(Array.from({ length: 100 }, (_, i) => ({ time: new Date(2026, 5, 1 + i, 7).toISOString(), kg: 80 })), [], NOW, 60).length === 60);
ok('nothing in, nothing out', weightsToImport([], [], NOW).length === 0 && weightsToImport(null, [], NOW).length === 0);

// --- Ids -------------------------------------------------------------------------
ok('import id is deterministic', importedWeightId('abc', '2026-11-20') === importedWeightId('abc', '2026-11-20'));
ok('import id fits the Firestore id rule', /^[a-zA-Z0-9_-]+$/.test(importedWeightId('a.b/c', '2026-11-20')));
ok('different days -> different ids', importedWeightId('abc', '2026-11-20') !== importedWeightId('abc', '2026-11-21'));

// --- Resting heart rate ----------------------------------------------------------------
ok('latest plausible resting HR', latestRestingHr([{ time: at(25, 7), bpm: 62 }, { time: at(26, 7), bpm: 58 }, { time: at(26, 8), bpm: 250 }]) === 58);
ok('no data -> null', latestRestingHr([]) === null && latestRestingHr([{ time: 'x', bpm: 60 }]) === null);

// --- Sleep -------------------------------------------------------------------------
const T = (d, h, m = 0) => new Date(2026, 10, d, h, m).toISOString();
const morning = new Date(2026, 10, 26, 9, 0);
const night = { start: T(25, 23), end: T(26, 7), stages: [
  { stage: 4, start: T(25, 23), end: T(26, 2) },      // light 180
  { stage: 5, start: T(26, 2), end: T(26, 3, 30) },   // deep 90
  { stage: 7, start: T(26, 3, 30), end: T(26, 4) },   // awake 30
  { stage: 6, start: T(26, 4), end: T(26, 7) },       // REM 180
] };
const n1 = summarizeLastNight([night], morning);
ok('8 h in bed with 30 min awake = 450 min asleep', n1?.minutes === 450);
ok('stages split: deep 90, REM 180, light 180, awake 30', n1?.deepMin === 90 && n1?.remMin === 180 && n1?.lightMin === 180 && n1?.awakeMin === 30);
ok('no stages: whole session counts', summarizeLastNight([{ start: T(25, 23), end: T(26, 6) }], morning)?.minutes === 420);
ok('split night (woke 2 h in the middle) counts as the sum', summarizeLastNight([{ start: T(25, 22), end: T(26, 1) }, { start: T(26, 3), end: T(26, 7) }], morning)?.minutes === 420);
ok("the night before last is not last night", summarizeLastNight([{ start: T(24, 23), end: T(25, 7) }], morning) === null);
ok('a 20 min blip is not a night', summarizeLastNight([{ start: T(26, 5), end: T(26, 5, 20) }], morning) === null);
ok('a watch left recording 30 h is ignored', summarizeLastNight([{ start: T(24, 22), end: T(26, 4) }], morning) === null);
ok('junk times ignored', summarizeLastNight([{ start: 'x', end: T(26, 7) }], morning) === null && summarizeLastNight(null, morning) === null);
ok('quality: 7.5 h with 60% deep+REM = 5', sleepQuality(n1) === 5);
ok('quality: 5.5 h = 2, 4 h = 1', sleepQuality({ minutes: 330, deepMin: 0, remMin: 0, lightMin: 0 }) === 2 && sleepQuality({ minutes: 240, deepMin: 0, remMin: 0, lightMin: 0 }) === 1);
ok('sleep id fixed per day and valid', importedSleepId('u1', '2026-11-26') === importedSleepId('u1', '2026-11-26') && /^[a-zA-Z0-9_-]+$/.test(importedSleepId('u.1', '2026-11-26')));

// --- CONTROLS (must fail if the rule they guard were missing) -------------------
const noGuard = recs.filter((r) => r.kg <= 1000).length;
ok('CONTROL: counting awake stages as sleep would give 480, not 450', summarizeLastNight([night], morning).minutes !== 480);
ok('CONTROL: without the plausibility rule the 900 kg glitch would get through', noGuard > out.length + 1);

// --- Regression: a Capacitor plugin must never be returned from async code ------
// A plugin is a Proxy that answers to `then`; `await` on it waits forever. This
// kept Health Connect from ever connecting (and the pedometer loader had it too).
const THENABLE_TRAP = /(\b[a-zA-Z_]*[cC]ached?\s*=\s*mod\.[A-Z]\w*\s*;)|(\breturn\s+mod\.[A-Z]\w*\s*;)|(\breturn\s+\(await import\([^)]*\)\)\.[A-Z]\w*)/;
const walkSrc = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkSrc(path.join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(d, e.name)] : []));
const offenders = walkSrc('src').filter((f) => THENABLE_TRAP.test(fs.readFileSync(f, 'utf8'))).map((f) => f.split(path.sep).join('/'));
ok(`no source file returns a Capacitor plugin from async code (${offenders.join(', ') || 'none'})`, offenders.length === 0);
const oldHealth = "const mod: any = await import('capacitor-health-connect');\n      nativePluginCache = mod.HealthConnect;\n      return nativePluginCache;";
const oldPedo = "const mod = await import('@capgo/capacitor-pedometer');\n    cached = mod.CapacitorPedometer;\n    return cached;";
ok('CONTROL: the scan flags the old Health Connect and pedometer code', THENABLE_TRAP.test(oldHealth) && THENABLE_TRAP.test(oldPedo));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
