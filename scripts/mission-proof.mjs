// Today's Mission + XP/Level proof harness.
//
//   npm run proof:mission
//
// Proves the PURE deterministic engine (src/services/missionUtils.ts) that
// powers the Home hero widget and the XP bar:
//   Part A — the LEVEL CURVE: exact thresholds, monotonicity, progressive
//            costs, curve/threshold consistency, garbage tolerance, the
//            Centurion badge (1,000 XP) landing exactly on Level 6, and the
//            Level-99 cap.
//   Part B — TODAY'S MISSION: ~16 realistic scenarios (next-task selection,
//            over-calories feedback, quick-workout evenings, streak-risk
//            urgency, Health Connect connected/disconnected states) plus a
//            2,000-case fuzz proving it never throws and never returns garbage.
//
// Success bar ("100% success, zero errors"):
//   • Every assertion passes  • Zero thrown errors anywhere

const {
  computeLevel, xpForLevel, xpToNext, buildMission, XP_AWARDS, STEPS_GOAL,
} = await import('../src/services/missionUtils.ts');
const { computeTargets } = await import('../src/services/coachBriefing.ts');

const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', c: '\x1b[36m', x: '\x1b[0m' };
const PASS = `${C.g}PASS${C.x}`;
const FAIL = `${C.r}FAIL${C.x}`;

let passCount = 0, failCount = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passCount++; console.log(`  ${PASS} ${name}`); }
  else { failCount++; console.log(`  ${FAIL} ${name}${detail ? ` ${C.d}— ${detail}${C.x}` : ''}`); }
};

// ─── Part A: level curve ──────────────────────────────────────────────────────
console.log(`\n${C.b}${C.c}Part A — level curve (computeLevel / xpForLevel / xpToNext)${C.x}\n`);

check('0 XP is Level 1 with 0/100', (() => {
  const i = computeLevel(0);
  return i.level === 1 && i.intoLevel === 0 && i.toNext === 100 && i.pct === 0;
})());
check('99 XP still Level 1', computeLevel(99).level === 1);
check('100 XP hits Level 2 (onboarding instant win)', computeLevel(100).level === 2);
check('249 XP still Level 2', computeLevel(249).level === 2);
check('250 XP hits Level 3', computeLevel(250).level === 3);
check('450 XP hits Level 4', computeLevel(450).level === 4);
check('700 XP hits Level 5 (level_5 badge reachable)', computeLevel(700).level === 5);
check('1,000 XP hits Level 6 — Centurion badge lands on a level-up', computeLevel(1000).level === 6 && xpForLevel(6) === 1000);

check('costs are progressive: xpToNext strictly increases L1..L98', (() => {
  for (let l = 1; l < 98; l++) if (xpToNext(l + 1) <= xpToNext(l)) return false;
  return true;
})());
check('curve consistency: xpForLevel(l+1) − xpForLevel(l) === xpToNext(l)', (() => {
  for (let l = 1; l < 98; l++) if (xpForLevel(l + 1) - xpForLevel(l) !== xpToNext(l)) return false;
  return true;
})());
check('round-trip: computeLevel(xpForLevel(l)).level === l for L1..L99', (() => {
  for (let l = 1; l <= 99; l++) if (computeLevel(xpForLevel(l)).level !== l) return false;
  return true;
})());
check('level is monotonic and sane over 0..20,000 XP', (() => {
  let prev = 1;
  for (let p = 0; p <= 20000; p += 13) {
    const i = computeLevel(p);
    if (i.level < prev || i.level > 99) return false;
    if (i.pct < 0 || i.pct > 100 || i.intoLevel < 0 || i.intoLevel > i.toNext) return false;
    prev = i.level;
  }
  return true;
})());
check('caps at Level 99 for absurd XP', computeLevel(10_000_000).level === 99 && computeLevel(10_000_000).pct === 100);
check('garbage in → Level 1, never throws', (() => {
  for (const g of [NaN, -50, Infinity, -Infinity, '100', null, undefined, {}, [], true]) {
    let i;
    try { i = computeLevel(g); } catch { return false; }
    if (i.level !== 1) return false;
  }
  return true;
})());
check('XP awards are positive integers (meal, workout)',
  Number.isInteger(XP_AWARDS.meal) && XP_AWARDS.meal > 0 &&
  Number.isInteger(XP_AWARDS.workout) && XP_AWARDS.workout > 0);

// ─── Part B: today's mission ─────────────────────────────────────────────────
console.log(`\n${C.b}${C.c}Part B — buildMission scenarios${C.x}\n`);

const STATES = ['done', 'next', 'pending', 'over'];
function validity(m) {
  if (!m || typeof m !== 'object') return 'not an object';
  if (!Array.isArray(m.tasks) || m.tasks.length !== 3) return `task count ${m.tasks && m.tasks.length}`;
  const ids = m.tasks.map((t) => t.id);
  if (ids[0] !== 'workout' || ids[1] !== 'calories' || ids[2] !== 'steps') return `bad order ${ids}`;
  for (const t of m.tasks) {
    if (typeof t.label !== 'string' || !t.label) return 'bad label';
    if (!STATES.includes(t.state)) return `bad state ${t.state}`;
    if (!Number.isFinite(t.pct) || t.pct < 0 || t.pct > 100) return `pct ${t.pct}`;
    if (!Number.isFinite(t.current) || t.current < 0) return `current ${t.current}`;
    if (!Number.isFinite(t.target) || t.target <= 0) return `target ${t.target}`;
    if (!t.action || typeof t.action.label !== 'string' || !t.action.label) return 'bad action label';
    if (typeof t.action.route !== 'string' || !t.action.route.startsWith('/')) return `bad route ${t.action && t.action.route}`;
  }
  const doneCount = m.tasks.filter((t) => t.state === 'done').length;
  if (m.done !== doneCount) return `done ${m.done} != ${doneCount}`;
  if (m.total !== 3) return `total ${m.total}`;
  if (m.complete !== (doneCount === 3)) return 'complete flag wrong';
  if (m.complete && m.next !== null) return 'complete but next set';
  const nextTasks = m.tasks.filter((t) => t.state === 'next');
  if (m.next === null && nextTasks.length !== 0) return 'null next but a row is next';
  if (m.next !== null && (nextTasks.length !== 1 || nextTasks[0].id !== m.next)) return 'next/state mismatch';
  if (!['normal', 'streak-risk'].includes(m.urgency)) return `urgency ${m.urgency}`;
  if (typeof m.headline !== 'string' || !m.headline.trim()) return 'bad headline';
  return null;
}

const scenario = (name, snap, asserts) => {
  let m;
  try { m = buildMission(snap); } catch (e) { check(name, false, `threw: ${e.message}`); return; }
  const v = validity(m);
  if (v) { check(name, false, `invalid: ${v}`); return; }
  const why = asserts(m);
  check(name, !why, why || '');
};

scenario('fresh morning → breakfast first', { hour: 7 }, (m) =>
  m.next !== 'calories' ? `next=${m.next}` :
  m.headline !== "Today's mission — calories first." ? `headline "${m.headline}"` : null);

scenario('morning, breakfast logged → workout next', { hour: 9, mealsLogged: 1, caloriesConsumed: 420 }, (m) =>
  m.next !== 'workout' ? `next=${m.next}` : null);

scenario('midday, nothing logged → workout leads', { hour: 13 }, (m) =>
  m.next !== 'workout' ? `next=${m.next}` : null);

scenario('all three done → complete, no next', {
  hour: 18, workoutsToday: 1, mealsLogged: 3, caloriesConsumed: 2200, steps: 9500,
}, (m) =>
  !m.complete ? `done=${m.done}` :
  m.headline !== 'Mission complete — recover well.' ? `headline "${m.headline}"` : null);

scenario('over calories → coral row, corrective action, never "next"', {
  hour: 15, mealsLogged: 4, caloriesConsumed: 2600, workoutsToday: 0, steps: 3000,
}, (m) => {
  const cal = m.tasks[1];
  return cal.state !== 'over' ? `state=${cal.state}` :
    cal.action.label !== 'Review meals' ? `action=${cal.action.label}` :
    m.next === 'calories' ? 'over row promoted to next' : null;
});

scenario('over calories + everything else done → corrective headline', {
  hour: 20, mealsLogged: 5, caloriesConsumed: 3400, workoutsToday: 1, steps: 12000, streak: 2,
}, (m) =>
  m.complete ? 'should not be complete' :
  m.next !== null ? `next=${m.next}` :
  !m.headline.includes('rein the calories') ? `headline "${m.headline}"` : null);

scenario('evening untrained → quick 15-min suggestion', { hour: 19, mealsLogged: 2, caloriesConsumed: 1500 }, (m) =>
  m.tasks[0].action.label !== 'Quick 15-min' ? `label=${m.tasks[0].action.label}` : null);

scenario('daytime untrained → full "Start workout"', { hour: 10, mealsLogged: 1, caloriesConsumed: 500 }, (m) =>
  m.tasks[0].action.label !== 'Start workout' ? `label=${m.tasks[0].action.label}` : null);

scenario('streak at risk: evening, streak 5, empty board', { hour: 20, streak: 5 }, (m) =>
  m.urgency !== 'streak-risk' ? `urgency=${m.urgency}` :
  m.headline !== 'Protect your 5-day streak.' ? `headline "${m.headline}"` : null);

scenario('no streak risk when meal logged', { hour: 20, streak: 5, mealsLogged: 1, caloriesConsumed: 600 }, (m) =>
  m.urgency !== 'normal' ? `urgency=${m.urgency}` : null);

scenario('no streak risk on short streak', { hour: 20, streak: 2 }, (m) =>
  m.urgency !== 'normal' ? `urgency=${m.urgency}` : null);

scenario('steps not connected → Connect action, 0% bar', { hour: 12, steps: null }, (m) => {
  const s = m.tasks[2];
  return s.action.kind !== 'steps-connect' ? `kind=${s.action.kind}` : s.pct !== 0 ? `pct=${s.pct}` : null;
});

scenario('steps connected at 0 → real value, walk action', { hour: 12, steps: 0 }, (m) => {
  const s = m.tasks[2];
  return s.action.kind === 'steps-connect' ? 'shows connect while connected' :
    s.action.label !== 'Take a walk' ? `label=${s.action.label}` : null;
});

scenario(`steps goal (${STEPS_GOAL}) exactly → done`, { hour: 12, steps: STEPS_GOAL }, (m) =>
  m.tasks[2].state !== 'done' ? `state=${m.tasks[2].state}` : null);

scenario('calorie band lower edge (85%) counts as done', {
  hour: 14, goal: 'general', mealsLogged: 3, caloriesConsumed: Math.ceil(computeTargets('general').calories * 0.85),
}, (m) => (m.tasks[1].state !== 'done' ? `state=${m.tasks[1].state}` : null));

scenario('two workouts clamp to 1/1', { hour: 18, workoutsToday: 2 }, (m) =>
  m.tasks[0].current !== 1 || m.tasks[0].state !== 'done' ? `current=${m.tasks[0].current} state=${m.tasks[0].state}` : null);

scenario('mission targets match the coach (muscle_gain, 82kg)', {
  hour: 12, goal: 'muscle_gain', weightKg: 82, caloriesConsumed: 900, mealsLogged: 2,
}, (m) => {
  const want = computeTargets('muscle_gain', 82).calories;
  return m.tasks[1].target !== want ? `target ${m.tasks[1].target} != ${want}` : null;
});

scenario('empty snapshot never breaks', {}, () => null);
scenario('garbage snapshot never breaks', {
  hour: NaN, goal: 42, weightKg: -3, caloriesConsumed: Infinity, mealsLogged: -1,
  workoutsToday: NaN, steps: -100, streak: 'nine',
}, () => null);

// ─── Fuzz ─────────────────────────────────────────────────────────────────────
console.log(`\n${C.b}${C.c}Fuzz — 2,000 random snapshots${C.x}\n`);

let rngState = 0xF17F70;
const rnd = () => {
  // deterministic LCG so failures are reproducible
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 0xFFFFFFFF;
};
const weird = (r) =>
  r < 0.08 ? NaN : r < 0.14 ? -1 * Math.floor(rnd() * 1000) : r < 0.2 ? Infinity :
  r < 0.26 ? undefined : r < 0.3 ? null : Math.floor(rnd() * 20000);

let fuzzFails = 0;
for (let i = 0; i < 2000; i++) {
  const snap = {
    hour: weird(rnd()),
    goal: rnd() < 0.5 ? ['fat_loss', 'muscle_gain', 'general', undefined, 7][Math.floor(rnd() * 5)] : undefined,
    weightKg: weird(rnd()),
    caloriesConsumed: weird(rnd()),
    mealsLogged: weird(rnd()),
    workoutsToday: weird(rnd()),
    steps: rnd() < 0.3 ? null : weird(rnd()),
    streak: weird(rnd()),
  };
  try {
    const v = validity(buildMission(snap));
    if (v) { fuzzFails++; if (fuzzFails <= 3) console.log(`  ${FAIL} fuzz #${i}: ${v} ${C.d}${JSON.stringify(snap)}${C.x}`); }
  } catch (e) {
    fuzzFails++;
    if (fuzzFails <= 3) console.log(`  ${FAIL} fuzz #${i} threw: ${e.message} ${C.d}${JSON.stringify(snap)}${C.x}`);
  }
}
check('fuzz: 2,000 snapshots — zero throws, zero invalid missions', fuzzFails === 0, `${fuzzFails} failures`);

// determinism: same snapshot twice → identical result
{
  const snap = { hour: 19, streak: 4, mealsLogged: 1, caloriesConsumed: 1200, steps: 5200 };
  check('determinism: identical snapshots → identical missions',
    JSON.stringify(buildMission(snap)) === JSON.stringify(buildMission(snap)));
}

// ─── Summary ──────────────────────────────────────────────────────────────────
const total = passCount + failCount;
console.log(`\n${C.b}Result: ${passCount}/${total} checks passed${C.x}`);
if (failCount > 0) { console.log(`${C.r}${C.b}PROOF FAILED${C.x}`); process.exit(1); }
console.log(`${C.g}${C.b}100% success, zero errors${C.x}`);
