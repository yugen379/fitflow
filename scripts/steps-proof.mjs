// Steps, achievements and nudge-engine proof harness.
//
//   npm run proof:steps
//
// Covers the three pure engines behind the step system:
//   Part A — PEDOMETER MATHS: distance, calories, cadence, active-time
//            formatting, and the date-key boundary that decides which day a
//            step belongs to.
//   Part B — ACHIEVEMENTS: all 52 badges, threshold correctness, progress
//            monotonicity, the "next up" queue, level curve, and the
//            newly-unlocked diff that drives the confetti.
//   Part C — NUDGE RULES: that each rule fires only when it should, that the
//            copy quotes the real numbers, and that ordering is by urgency.
//   Part D — FUZZ: 4,000 hostile snapshots — zero throws, zero NaN, zero
//            impossible output.
//
// Firebase-free, like the other harnesses.

const {
  KM_PER_STEP, KCAL_PER_STEP, snapshotFrom, formatActiveTime, kmToMiles, localDateKey,
} = await import('../src/lib/pedometer.ts');

const {
  ACHIEVEMENTS, EMPTY_STATS, CATEGORY_LABELS, TIER_COLORS,
  evaluate, evaluateAll, unlockedCount, nextAchievements, pathfinderLevel, newlyUnlocked,
} = await import('../src/lib/achievements.ts');

const { buildNudges } = await import('../src/components/ui/NotificationCenter.tsx');

const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', c: '\x1b[36m', x: '\x1b[0m' };
const PASS = `${C.g}PASS${C.x}`;
const FAIL = `${C.r}FAIL${C.x}`;

let passCount = 0, failCount = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passCount++; console.log(`  ${PASS} ${name}`); }
  else { failCount++; console.log(`  ${FAIL} ${name}${detail ? ` ${C.d}— ${detail}${C.x}` : ''}`); }
};
const finite = (n) => typeof n === 'number' && Number.isFinite(n);

// ─── Part A: pedometer maths ─────────────────────────────────────────────────
console.log(`\n${C.b}${C.c}Part A — pedometer maths${C.x}\n`);

{
  const s = snapshotFrom('2026-08-22', 8240, 4680000, 104);
  check('distance is steps x stride', Math.abs(s.distanceKm - 8240 * KM_PER_STEP) < 1e-9,
    `${s.distanceKm.toFixed(3)} km`);
  check('8,240 steps reads as ~6.4 km', Math.abs(s.distanceKm - 6.4) < 0.1, `${s.distanceKm.toFixed(2)} km`);
  check('calories are steps x rate', Math.abs(s.calories - 8240 * KCAL_PER_STEP) < 1e-9);
  check('8,240 steps reads as ~330 kcal', Math.abs(s.calories - 329.6) < 1, `${s.calories.toFixed(1)}`);
  check('speed derives from cadence and stride', Math.abs(s.speedKmh - 104 * KM_PER_STEP * 60) < 1e-9,
    `${s.speedKmh.toFixed(2)} km/h`);
  check('a stopped walker has zero speed', snapshotFrom('d', 5000, 0, 0).speedKmh === 0);
  check('zero steps yields zero everything', (() => {
    const z = snapshotFrom('d', 0, 0, 0);
    return z.distanceKm === 0 && z.calories === 0 && z.speedKmh === 0;
  })());
}

{
  check('active time formats hours and minutes', formatActiveTime(4680000) === '1h 18m', formatActiveTime(4680000));
  check('under an hour omits the hour', formatActiveTime(1080000) === '18m', formatActiveTime(1080000));
  check('zero is 0m', formatActiveTime(0) === '0m');
  check('negative time cannot go backwards', formatActiveTime(-5000) === '0m');
  check('miles conversion is right', Math.abs(kmToMiles(6.4) - 3.977) < 0.01, `${kmToMiles(6.4).toFixed(3)}`);
}

{
  // The date key decides which day a step is filed under. An off-by-one here
  // silently merges or splits days, which no user would ever debug.
  const d = new Date(2026, 7, 22, 23, 59, 59);
  check('date key is local, not UTC', localDateKey(d) === '2026-08-22', localDateKey(d));
  const midnight = new Date(2026, 7, 23, 0, 0, 1);
  check('one second past midnight is the next day', localDateKey(midnight) === '2026-08-23', localDateKey(midnight));
  check('single-digit months and days are padded', localDateKey(new Date(2026, 0, 5)) === '2026-01-05');
}

// ─── Part B: achievements ────────────────────────────────────────────────────
console.log(`\n${C.b}${C.c}Part B — achievements${C.x}\n`);

check('the catalogue holds 52 badges', ACHIEVEMENTS.length === 52, `${ACHIEVEMENTS.length}`);
check('every id is unique', new Set(ACHIEVEMENTS.map((a) => a.id)).size === ACHIEVEMENTS.length);
check('every name is unique', new Set(ACHIEVEMENTS.map((a) => a.name)).size === ACHIEVEMENTS.length);
check('every badge has a positive threshold', ACHIEVEMENTS.every((a) => a.threshold > 0));
check('every badge measures a real stat',
  ACHIEVEMENTS.every((a) => Object.prototype.hasOwnProperty.call(EMPTY_STATS, a.metric)));
check('every badge has a known category',
  ACHIEVEMENTS.every((a) => CATEGORY_LABELS[a.category] !== undefined));
check('every badge has a known tier',
  ACHIEVEMENTS.every((a) => TIER_COLORS[a.tier] !== undefined));
check('every badge has a description worth reading',
  ACHIEVEMENTS.every((a) => typeof a.description === 'string' && a.description.length > 12));
check('all five categories are populated', (() => {
  const seen = new Set(ACHIEVEMENTS.map((a) => a.category));
  return seen.size === Object.keys(CATEGORY_LABELS).length;
})());

{
  // Thresholds inside a category must ascend, or the "next up" queue proposes
  // a harder badge before an easier one.
  let ordered = true;
  for (const category of Object.keys(CATEGORY_LABELS)) {
    const group = ACHIEVEMENTS.filter((a) => a.category === category);
    const byMetric = {};
    for (const a of group) (byMetric[a.metric] ||= []).push(a.threshold);
    for (const list of Object.values(byMetric)) {
      for (let i = 1; i < list.length; i++) if (list[i] <= list[i - 1]) ordered = false;
    }
  }
  check('thresholds ascend within each category and metric', ordered);
}

{
  check('an empty athlete has unlocked nothing', unlockedCount(EMPTY_STATS) === 0);
  const beginner = { ...EMPTY_STATS, bestDaySteps: 3200, totalSteps: 3200, totalDistanceKm: 2.5 };
  check('3,200 steps unlocks exactly the 1k and 3k badges', (() => {
    const unlocked = evaluateAll(beginner).filter((e) => e.unlocked).map((e) => e.achievement.id);
    return unlocked.includes('steps-1k') && unlocked.includes('steps-3k') && !unlocked.includes('steps-5k');
  })());

  const perfect = {
    bestDaySteps: 40000, todaySteps: 40000, totalSteps: 6000000, totalDistanceKm: 12000,
    stepStreak: 200, activityStreak: 200, daysOver10k: 400, totalWorkouts: 500,
    activeMinutes: 20000, activeDays: 500,
  };
  check('a maxed athlete unlocks all 52', unlockedCount(perfect) === 52, `${unlockedCount(perfect)}`);
  check('every progress ratio is capped at 1', evaluateAll(perfect).every((e) => e.ratio <= 1));
  check('unlocked badges report zero remaining', evaluateAll(perfect).every((e) => e.remaining === 0));
}

{
  // Progress must never go down as a stat goes up.
  let monotonic = true;
  const badge = ACHIEVEMENTS.find((a) => a.id === 'steps-10k');
  let previous = -1;
  for (let steps = 0; steps <= 12000; steps += 250) {
    const ratio = evaluate(badge, { ...EMPTY_STATS, bestDaySteps: steps }).ratio;
    if (ratio < previous) monotonic = false;
    previous = ratio;
  }
  check('progress is monotonic as the stat climbs', monotonic);
  check('progress is exactly 0.5 at half the threshold',
    Math.abs(evaluate(badge, { ...EMPTY_STATS, bestDaySteps: 5000 }).ratio - 0.5) < 1e-9);
}

{
  const stats = { ...EMPTY_STATS, bestDaySteps: 9200, totalSteps: 46000, totalDistanceKm: 36, stepStreak: 2 };
  const next = nextAchievements(stats, 3);
  check('the next-up queue returns three', next.length === 3, `${next.length}`);
  check('the queue excludes anything already unlocked', next.every((e) => !e.unlocked));
  check('the queue excludes badges at zero progress', next.every((e) => e.ratio > 0));
  check('the queue is sorted closest-first', next.every((e, i) => i === 0 || next[i - 1].ratio >= e.ratio));
  check('the closest badge really is the closest', (() => {
    const all = evaluateAll(stats).filter((e) => !e.unlocked && e.ratio > 0);
    const best = Math.max(...all.map((e) => e.ratio));
    return Math.abs(next[0].ratio - best) < 1e-9;
  })());
}

{
  const level0 = pathfinderLevel(EMPTY_STATS);
  check('an empty athlete is level 1', level0.level === 1, `level ${level0.level}`);
  check('the level reports the catalogue total', level0.total === 52);
  const maxed = pathfinderLevel({
    bestDaySteps: 40000, todaySteps: 40000, totalSteps: 6000000, totalDistanceKm: 12000,
    stepStreak: 200, activityStreak: 200, daysOver10k: 400, totalWorkouts: 500,
    activeMinutes: 20000, activeDays: 500,
  });
  check('a maxed athlete reaches the final title', maxed.title === 'Eternal Nomad', maxed.title);
  check('the level never exceeds the title list', maxed.level <= 12, `${maxed.level}`);
  check('the level curve never goes backwards', (() => {
    let previous = 0;
    for (let steps = 0; steps <= 2000000; steps += 50000) {
      const l = pathfinderLevel({ ...EMPTY_STATS, totalSteps: steps, bestDaySteps: 10000 }).level;
      if (l < previous) return false;
      previous = l;
    }
    return true;
  })());
}

{
  const before = { ...EMPTY_STATS, bestDaySteps: 9800 };
  const after = { ...EMPTY_STATS, bestDaySteps: 10500 };
  const fresh = newlyUnlocked(before, after);
  check('crossing 10k newly unlocks Daily Master',
    fresh.some((a) => a.id === 'steps-10k'), fresh.map((a) => a.id).join(','));
  check('nothing already held is reported as new', newlyUnlocked(after, after).length === 0);
  check('going backwards unlocks nothing', newlyUnlocked(after, before).length === 0);
}

// ─── Part C: nudge rules ─────────────────────────────────────────────────────
console.log(`\n${C.b}${C.c}Part C — proactive nudge rules${C.x}\n`);

const baseContext = {
  name: 'Guru', hour: 12, steps: 5000, stepGoal: 10000,
  caloriesConsumed: 1600, calorieTarget: 2100,
  proteinG: 100, proteinTargetG: 180,
  recovery: 70, workoutsToday: 0, sedentaryMinutes: 10,
};

{
  const evening = buildNudges({ ...baseContext, hour: 19, steps: 8240 });
  const steps = evening.find((n) => n.id === 'steps-close');
  check('an evening step gap produces a nudge', Boolean(steps));
  check('the step nudge quotes the exact remainder',
    Boolean(steps && steps.body.includes('1,760')), steps?.body);
  check('the step nudge routes to /steps', steps?.action.route === '/steps');
  check('the step nudge is addressed to the athlete', Boolean(steps && steps.title.includes('Guru')));
}

{
  const done = buildNudges({ ...baseContext, hour: 19, steps: 10500 });
  check('a completed step goal produces no step nudge', !done.some((n) => n.id === 'steps-close'));
  const morning = buildNudges({ ...baseContext, hour: 9, steps: 800 });
  check('a morning with the day ahead does not nag about steps',
    !morning.some((n) => n.id === 'steps-close'));
}

{
  const hungry = buildNudges({ ...baseContext, hour: 13, caloriesConsumed: 1200, proteinG: 90 });
  const fuel = hungry.find((n) => n.id === 'fuel-gap');
  check('an under-target day produces a fuel nudge', Boolean(fuel));
  check('the fuel nudge quotes kcal and protein',
    Boolean(fuel && fuel.body.includes('900') && fuel.body.includes('90g')), fuel?.body);
  check('the fuel nudge routes to /track', fuel?.action.route === '/track');

  const over = buildNudges({ ...baseContext, caloriesConsumed: 2600 });
  check('going over target produces the coral over-eat nudge',
    over.some((n) => n.id === 'fuel-over' && n.tone === 'coral'));
  const onTarget = buildNudges({ ...baseContext, caloriesConsumed: 2050, proteinG: 175 });
  check('being on target produces no fuel nudge',
    !onTarget.some((n) => n.id === 'fuel-gap' || n.id === 'fuel-over'));
}

{
  const ready = buildNudges({ ...baseContext, recovery: 78 });
  check('high recovery invites a session', ready.some((n) => n.id === 'ready'));
  check('the readiness nudge routes to the workout HUD',
    ready.find((n) => n.id === 'ready')?.action.route === '/workout');
  const tired = buildNudges({ ...baseContext, recovery: 30 });
  check('low recovery advises backing off', tired.some((n) => n.id === 'recover'));
  check('the two readiness nudges are mutually exclusive',
    !(ready.some((n) => n.id === 'recover') || tired.some((n) => n.id === 'ready')));
  const trained = buildNudges({ ...baseContext, recovery: 78, workoutsToday: 1 });
  check('having already trained suppresses the readiness nudge',
    !trained.some((n) => n.id === 'ready'));
  const unknown = buildNudges({ ...baseContext, recovery: null });
  check('no recovery signal produces no recovery claim',
    !unknown.some((n) => n.id === 'ready' || n.id === 'recover'));
}

{
  const still = buildNudges({ ...baseContext, sedentaryMinutes: 120 });
  check('a long sedentary stretch produces a posture nudge', still.some((n) => n.id === 'mobility'));
  const moving = buildNudges({ ...baseContext, sedentaryMinutes: 20 });
  check('recent movement produces no posture nudge', !moving.some((n) => n.id === 'mobility'));
  const night = buildNudges({ ...baseContext, hour: 3, sedentaryMinutes: 300 });
  check('the middle of the night never nags about posture',
    !night.some((n) => n.id === 'mobility'));
}

{
  const many = buildNudges({
    ...baseContext, hour: 19, steps: 8240, caloriesConsumed: 1200, proteinG: 90,
    recovery: 80, sedentaryMinutes: 150,
  });
  check('multiple rules can fire together', many.length >= 3, `${many.length}`);
  check('nudges are ordered by urgency',
    many.every((n, i) => i === 0 || many[i - 1].urgency >= n.urgency));
  check('every nudge carries exactly one route', many.every((n) => typeof n.action.route === 'string'));
  check('every nudge has a distinct id', new Set(many.map((n) => n.id)).size === many.length);

  // Being 90% of the way there is worth saying at any hour — that is
  // encouragement, not nagging, and the rule fires on "nearly there" OR
  // "evening" precisely so it can.
  const nearly = buildNudges({ ...baseContext, hour: 10, steps: 9000 });
  check('being nearly at goal is worth saying even mid-morning',
    nearly.some((n) => n.id === 'steps-close' && n.title.startsWith('Almost there')));

  // A genuinely quiet day: nothing is close, nothing is off target, nothing to say.
  const quiet = buildNudges({
    ...baseContext, hour: 10, steps: 4000, stepGoal: 10000,
    caloriesConsumed: 2050, proteinG: 176, recovery: 55, workoutsToday: 1, sedentaryMinutes: 5,
  });
  check('a day with nothing to flag produces no nudges at all', quiet.length === 0,
    quiet.map((n) => n.id).join(',') || '0 fired');
}

// ─── Part D: fuzz ────────────────────────────────────────────────────────────
console.log(`\n${C.b}${C.c}Part D — fuzz${C.x}\n`);

{
  let seed = 0x6d2b79f5;
  const rnd = () => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed / 0xffffffff;
  };
  const weird = (r) => {
    if (r < 0.05) return Number.NaN;
    if (r < 0.1) return Infinity;
    if (r < 0.15) return -Infinity;
    if (r < 0.2) return -50000;
    return r * 1e6;
  };

  let throws = 0, bad = 0;
  for (let i = 0; i < 2000; i++) {
    const stats = {
      bestDaySteps: weird(rnd()), todaySteps: weird(rnd()), totalSteps: weird(rnd()),
      totalDistanceKm: weird(rnd()), stepStreak: weird(rnd()), activityStreak: weird(rnd()),
      daysOver10k: weird(rnd()), totalWorkouts: weird(rnd()),
      activeMinutes: weird(rnd()), activeDays: weird(rnd()),
    };
    try {
      const all = evaluateAll(stats);
      for (const entry of all) {
        if (!finite(entry.ratio) || entry.ratio < 0 || entry.ratio > 1) { bad++; break; }
        if (!finite(entry.remaining) || entry.remaining < 0) { bad++; break; }
      }
      const level = pathfinderLevel(stats);
      if (!finite(level.level) || level.level < 1 || typeof level.title !== 'string') bad++;
      nextAchievements(stats, 3);
    } catch (error) {
      throws++;
      if (throws <= 3) console.log(`  ${FAIL} achievements fuzz #${i} threw: ${error.message}`);
    }
  }
  check('2,000 hostile stat snapshots: zero throws', throws === 0, `${throws}`);
  check('2,000 hostile stat snapshots: ratios stay in 0..1', bad === 0, `${bad} violations`);
}

{
  let seed = 0x1c9e6a5b;
  const rnd = () => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed / 0xffffffff;
  };
  const weird = (r) => (r < 0.08 ? Number.NaN : r < 0.14 ? Infinity : (r - 0.4) * 40000);

  let throws = 0, bad = 0;
  for (let i = 0; i < 2000; i++) {
    const context = {
      name: rnd() < 0.5 ? 'Guru' : undefined,
      hour: Math.floor(rnd() * 30) - 3,
      steps: weird(rnd()), stepGoal: weird(rnd()),
      caloriesConsumed: weird(rnd()), calorieTarget: weird(rnd()),
      proteinG: weird(rnd()), proteinTargetG: weird(rnd()),
      recovery: rnd() < 0.2 ? null : weird(rnd()),
      workoutsToday: Math.floor(rnd() * 4),
      sedentaryMinutes: rnd() < 0.2 ? null : weird(rnd()),
    };
    try {
      const nudges = buildNudges(context);
      for (const nudge of nudges) {
        if (typeof nudge.title !== 'string' || typeof nudge.body !== 'string') { bad++; break; }
        if (nudge.body.includes('NaN') || nudge.title.includes('NaN')) { bad++; break; }
        if (!finite(nudge.urgency)) { bad++; break; }
      }
    } catch (error) {
      throws++;
      if (throws <= 3) console.log(`  ${FAIL} nudge fuzz #${i} threw: ${error.message}`);
    }
  }
  check('2,000 hostile nudge contexts: zero throws', throws === 0, `${throws}`);
  check('2,000 hostile nudge contexts: no NaN ever reaches the copy', bad === 0, `${bad} violations`);
}

// ─── Summary ─────────────────────────────────────────────────────────────────
const total = passCount + failCount;
console.log(`\n${C.b}Result: ${passCount}/${total} checks passed${C.x}`);
if (failCount > 0) { console.log(`${C.r}${C.b}PROOF FAILED${C.x}`); process.exit(1); }
console.log(`${C.g}${C.b}100% success, zero errors${C.x}`);
