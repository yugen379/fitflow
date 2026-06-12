// Proactive Coach Briefing proof harness.
//
//   npm run proof:briefing
//
// Two parts, mirroring the barcode/coach harnesses:
//   Part A — the PURE deterministic engine (src/services/coachBriefing.ts).
//            Asserts the right nudges surface for ~14 realistic scenarios, that
//            EVERY briefing is structurally valid, and fuzzes 1,000 random
//            contexts to prove it never throws and never returns garbage.
//   Part B — the SHIPPED getCoachBriefing (src/services/geminiService.ts), which
//            adds the Gemini copy-polish. Asserts it never throws, always returns
//            a valid briefing, and PRESERVES the engine's structure (same nudge
//            ids) — the model only rewrites words. Reports live-AI vs engine.
//
// Success bar ("100% success, zero errors"):
//   • Every Part A assertion passes
//   • Every briefing (A and B) is structurally valid
//   • Zero thrown errors anywhere

import fs from 'node:fs';

// Load .env so the live AI path can run (same approach as coach-proof.mjs).
try {
  const envFile = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i === -1) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
} catch { /* no .env — Part B runs in engine-only mode */ }

const hasKey = !!process.env.GEMINI_API_KEY;

const { buildBriefing, computeTargets } = await import('../src/services/coachBriefing.ts');
const { getCoachBriefing } = await import('../src/services/geminiService.ts');

const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', c: '\x1b[36m', x: '\x1b[0m' };
const PASS = `${C.g}PASS${C.x}`;
const FAIL = `${C.r}FAIL${C.x}`;

let passCount = 0, failCount = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passCount++; console.log(`  ${PASS} ${name}`); }
  else { failCount++; console.log(`  ${FAIL} ${name}${detail ? ` ${C.d}— ${detail}${C.x}` : ''}`); }
};

// ---- structural validator ----------------------------------------------------
const TONES = ['push', 'nudge', 'care', 'celebrate'];
function validity(b) {
  if (!b || typeof b !== 'object') return 'not an object';
  if (typeof b.headline !== 'string' || !b.headline.trim()) return 'bad headline';
  if (typeof b.subtitle !== 'string' || !b.subtitle.trim()) return 'bad subtitle';
  if (!Array.isArray(b.nudges) || b.nudges.length < 1 || b.nudges.length > 3) return `nudge count ${b.nudges && b.nudges.length}`;
  const ids = new Set();
  for (const n of b.nudges) {
    if (!n || typeof n !== 'object') return 'nudge not object';
    for (const f of ['id', 'icon', 'title', 'message', 'tone']) {
      if (typeof n[f] !== 'string' || !n[f].trim()) return `nudge.${f} empty`;
    }
    if (!TONES.includes(n.tone)) return `bad tone ${n.tone}`;
    if (!n.action || typeof n.action.label !== 'string' || !n.action.label.trim()) return 'bad action.label';
    if (typeof n.action.route !== 'string' || !n.action.route.startsWith('/')) return `bad action.route ${n.action && n.action.route}`;
    if (typeof n.priority !== 'number' || !Number.isFinite(n.priority)) return 'bad priority';
    if (ids.has(n.id)) return `duplicate id ${n.id}`;
    ids.add(n.id);
  }
  return null; // valid
}
const hasNudge = (b, id) => b.nudges.some(n => n.id === id);
const topId = (b) => b.nudges[0].id;
const idsOf = (b) => b.nudges.map(n => n.id).sort().join(',');

// ---- Part A: deterministic scenarios -----------------------------------------
console.log(`\n${C.b}── Proactive Coach Briefing proof ──${C.x}`);
console.log(`${C.d}Gemini key: ${hasKey ? C.g + 'present (live AI expected in Part B)' : C.y + 'absent (engine-only)'}${C.x}`);
console.log(`\n${C.b}Part A · Deterministic engine${C.x}`);
console.log(`${C.d}78kg muscle_gain → protein target ${computeTargets('muscle_gain', 78).proteinG}g, water ${computeTargets('muscle_gain', 78).waterMl}ml${C.x}`);

const P = { goal: 'muscle_gain', weightKg: 78 };
const scenarios = [
  ['new user, morning → log breakfast',
    { ...P, hour: 8 }, b => hasNudge(b, 'fuel-start')],
  ['nothing logged, midday → log a meal',
    { ...P, hour: 13 }, b => hasNudge(b, 'fuel-start')],
  ['eating but protein short, evening → protein-gap',
    { ...P, hour: 19, caloriesConsumed: 1800, proteinConsumed: 80, mealsLogged: 3, waterMl: 2500, trainedToday: true }, b => hasNudge(b, 'protein-gap')],
  ['not trained, past preferred hour, evening → train-window',
    { ...P, hour: 19, preferredWorkoutHour: 18, trainedToday: false, caloriesConsumed: 1500, mealsLogged: 2 }, b => hasNudge(b, 'train-window')],
  ['not trained, 3-day gap, midday → train-gap',
    { ...P, hour: 14, preferredWorkoutHour: null, daysSinceLastWorkout: 3, caloriesConsumed: 800, mealsLogged: 1 }, b => hasNudge(b, 'train-gap')],
  ['water far behind, midday → hydrate',
    { ...P, hour: 13, waterMl: 200, caloriesConsumed: 600, proteinConsumed: 20, mealsLogged: 1, trainedToday: true }, b => hasNudge(b, 'hydrate')],
  ['low sleep, morning → recover-lowsleep (top)',
    { ...P, hour: 7, sleepHours: 4 }, b => topId(b) === 'recover-lowsleep'],
  ['everything in range, evening → all-good (top)',
    { ...P, hour: 20, trainedToday: true, caloriesConsumed: 2000, proteinConsumed: 150, waterMl: 2600, mealsLogged: 3 }, b => topId(b) === 'all-good'],
  ['streak at risk, night → streak-risk (top)',
    { ...P, hour: 21, streak: 10, caloriesConsumed: 0, mealsLogged: 0, trainedToday: false, waterMl: 0 }, b => topId(b) === 'streak-risk'],
  ['active day, late night → winddown present',
    { ...P, hour: 23, trainedToday: true, caloriesConsumed: 2000, proteinConsumed: 150, waterMl: 2600, mealsLogged: 3 }, b => hasNudge(b, 'winddown')],
  ['preferred hour later today, morning → train-plan',
    { ...P, hour: 8, preferredWorkoutHour: 18, trainedToday: false, caloriesConsumed: 400, mealsLogged: 1 }, b => hasNudge(b, 'train-plan')],
  ['trained, mid-progress, no urgent issue → default fallback',
    { ...P, hour: 9, trainedToday: true, caloriesConsumed: 500, proteinConsumed: 40, waterMl: 500, mealsLogged: 1 }, b => hasNudge(b, 'default')],
  ['empty context → valid, never empty',
    {}, b => b.nudges.length >= 1],
  ['garbage values → valid, never throws',
    { hour: 99, weightKg: -5, caloriesConsumed: NaN, proteinConsumed: Infinity, streak: -3, preferredWorkoutHour: 47 }, b => b.nudges.length >= 1],
];

for (const [name, ctx, expect] of scenarios) {
  let b, err = null, ok = false;
  try { b = buildBriefing(ctx); } catch (e) { err = String(e?.message || e); }
  if (err) { check(name, false, `threw: ${err}`); continue; }
  const v = validity(b);
  if (v) { check(name, false, `invalid: ${v}`); continue; }
  try { ok = expect(b); } catch (e) { check(name, false, `assert threw: ${e?.message || e}`); continue; }
  check(name, ok, ok ? '' : `top=${topId(b)} ids=[${idsOf(b)}]`);
}

// ---- Part A fuzz: 1,000 random contexts, all must be valid -------------------
let fuzzBad = 0, fuzzThrew = 0;
const rnd = (n) => Math.floor(Math.random() * n);
const goals = ['muscle_gain', 'fat_loss', 'general', undefined, 'recomp'];
for (let i = 0; i < 1000; i++) {
  const ctx = {
    hour: rnd(30) - 3,                       // includes out-of-range
    goal: goals[rnd(goals.length)],
    weightKg: rnd(160) - 20,                 // includes negatives
    caloriesConsumed: rnd(4000),
    proteinConsumed: rnd(250),
    waterMl: rnd(4000),
    trainedToday: Math.random() < 0.5,
    mealsLogged: rnd(8),
    sleepHours: rnd(12),
    streak: rnd(400) - 5,
    preferredWorkoutHour: Math.random() < 0.3 ? null : rnd(30),
    daysSinceLastWorkout: Math.random() < 0.3 ? null : rnd(20) - 2,
  };
  try {
    const b = buildBriefing(ctx);
    if (validity(b)) fuzzBad++;
  } catch { fuzzThrew++; }
}
check('fuzz · 1,000 random contexts never throw', fuzzThrew === 0, `${fuzzThrew} threw`);
check('fuzz · 1,000 random contexts all valid', fuzzBad === 0, `${fuzzBad} invalid`);

// ---- Part B: live getCoachBriefing -------------------------------------------
console.log(`\n${C.b}Part B · Live getCoachBriefing (engine + AI polish)${C.x}`);
console.log(`  ${'SCENARIO'.padEnd(34)}${'VALID'.padEnd(7)}${'STRUCT'.padEnd(8)}${'SRC'.padEnd(10)}TIME`);
console.log('  ' + '─'.repeat(78));

const liveScenarios = [
  ['morning, fresh start', { ...P, hour: 8 }],
  ['evening, protein short', { ...P, hour: 19, caloriesConsumed: 1800, proteinConsumed: 80, mealsLogged: 3, waterMl: 2500, trainedToday: true }],
  ['training window open', { ...P, hour: 18, preferredWorkoutHour: 18, trainedToday: false, mealsLogged: 2, caloriesConsumed: 1500 }],
  ['streak at risk', { ...P, hour: 21, streak: 10, trainedToday: false, waterMl: 0 }],
  ['all in range', { ...P, hour: 20, trainedToday: true, caloriesConsumed: 2000, proteinConsumed: 150, waterMl: 2600, mealsLogged: 3 }],
  ['low sleep morning', { ...P, hour: 7, sleepHours: 4 }],
  ['empty context', {}],
];

let liveErrors = 0, aiCount = 0, engineCount = 0;
for (const [name, ctx] of liveScenarios) {
  const t0 = Date.now();
  let live, threw = null;
  try { live = await getCoachBriefing(ctx); } catch (e) { threw = String(e?.message || e); }
  const ms = Date.now() - t0;
  if (threw) {
    liveErrors++;
    console.log(`  ${name.padEnd(34)}${FAIL.padEnd(7)}${'-'.padEnd(8)}${(C.r + 'THREW' + C.x).padEnd(10)}${ms}ms ${C.d}${threw}${C.x}`);
    continue;
  }
  const v = validity(live);
  const engine = buildBriefing(ctx);
  const structOk = idsOf(live) === idsOf(engine);   // AI must not change which nudges show
  if (v) liveErrors++;
  if (!structOk) liveErrors++;
  if (live.source === 'AI') aiCount++; else engineCount++;
  const validTag = v ? FAIL : PASS;
  const structTag = structOk ? PASS : FAIL;
  const srcCol = live.source === 'AI' ? `${C.c}AI${C.x}      ` : `${C.d}engine${C.x}  `;
  console.log(`  ${name.padEnd(34)}${validTag.padEnd(7)}${structTag.padEnd(8)}${srcCol}${ms}ms`);
  if (v) console.log(`       ${C.r}invalid: ${v}${C.x}`);
}

// ---- summary -----------------------------------------------------------------
console.log(`\n${C.b}── Summary ──${C.x}`);
const aPass = failCount === 0;
console.log(`  Part A assertions : ${aPass ? C.g : C.r}${passCount}/${passCount + failCount} (${Math.round(passCount / (passCount + failCount) * 100)}%)${C.x}`);
console.log(`  Part B live errors: ${liveErrors === 0 ? C.g : C.r}${liveErrors}${C.x}`);
console.log(`  Part B source     : ${C.c}${aiCount} AI${C.x} / ${C.d}${engineCount} engine${C.x}`);

const green = failCount === 0 && liveErrors === 0;
console.log(`\n  ${green ? C.g + C.b + '✓ 100% — proactive coach briefing verified' : C.r + '✗ see failures above'}${C.x}\n`);
process.exit(green ? 0 : 1);
