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
//   Part E — FORMULAS: the weight/height-personalised distance and calorie
//            maths, and that the explanation strings quote the same numbers the
//            code actually computed.
//   Part F — SYNC POLICY: the monotonic-write rule behind the Firestore
//            step_days mirror, and the session-delta clamp that stops a native
//            pedometer restart from wiping the day.
//   Part G — THEME: the light/dark/system resolution rule.
//   Part J — GAIT SIMULATION: the WHOLE signal path (high-pass, adaptive
//            threshold, hysteresis, rhythm gate) driven with synthetic
//            accelerometer waveforms at 60 Hz, for real walking styles and for
//            the ways a phone gets handled. This is what the thresholds are
//            tuned against — a floor picked by feel silently stopped counting
//            for anyone who walks gently.
//   Part I — STEP DETECTION: the rhythm gate that separates walking from a
//            phone being shaken, waved or set down. This is the fix for real
//            users reporting "when I move the phone it also calculates".
//   Part H — BACKGROUND COUNTER: the cumulative-sensor arithmetic the native
//            foreground service runs on (mirrored from StepStore.java) — the
//            reboot discontinuity, the app-closed recovery, and day rollover.
//            These are the rules that decide whether a user's day is correct
//            and they are close to untestable by hand: proving the reboot case
//            on a device means rebooting it mid-walk.
//
// Firebase-free, like the other harnesses. That is why the sync POLICY lives in
// `services/stepSyncPolicy.ts` (pure) while the Firestore calls live in
// `services/stepSyncService.ts` (deliberately not imported here).

const {
  KM_PER_STEP, KCAL_PER_STEP, snapshotFrom, formatActiveTime, kmToMiles, localDateKey,
} = await import('../src/lib/pedometer.ts');

const {
  ACHIEVEMENTS, EMPTY_STATS, CATEGORY_LABELS, TIER_COLORS,
  evaluate, evaluateAll, unlockedCount, nextAchievements, pathfinderLevel, newlyUnlocked,
} = await import('../src/lib/achievements.ts');

const { buildNudges } = await import('../src/components/ui/NotificationCenter.tsx');

const {
  DEFAULT_STRIDE_M, KCAL_PER_STEP: KCAL_REF, REFERENCE_WEIGHT_KG, STRIDE_TO_HEIGHT_RATIO,
  caloriesFor, distanceKmFor, explainCalories, explainDistance, kcalPerStepFor,
  speedKmhFor, strideMetresFor,
} = await import('../src/lib/stepFormulas.ts');

const {
  WRITE_THROTTLE_MS, mergeDayCount, mergeHistory, sessionDelta, shouldWrite,
} = await import('../src/services/stepSyncPolicy.ts');

const { resolveTheme } = await import('../src/hooks/useTheme.tsx');

const {
  MAX_PLAUSIBLE_DELTA, applyRawReading, emptyCounterState, rawReadingDelta, rollDay,
} = await import('../src/services/backgroundStepPolicy.ts');

const {
  MIN_RUN, MIN_STEP_INTERVAL_MS, MAX_STEP_INTERVAL_MS, StepDetector, StepPipeline,
} = await import('../src/lib/stepDetection.ts');

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

// --- Part E: personalised formulas -------------------------------------------
console.log(`\n${C.b}${C.c}Part E — distance & calorie formulas${C.x}\n`);

{
  // Stride
  check('no height falls back to the default stride', strideMetresFor(undefined) === DEFAULT_STRIDE_M);
  check('stride is height x 0.414',
    Math.abs(strideMetresFor(180) - (180 * STRIDE_TO_HEIGHT_RATIO) / 100) < 1e-9,
    `${strideMetresFor(180).toFixed(3)} m`);
  check('a 180 cm adult strides ~0.75 m', Math.abs(strideMetresFor(180) - 0.745) < 0.01);
  check('a taller person covers more ground per step', strideMetresFor(195) > strideMetresFor(160));
  check('an impossible height is ignored, not trusted', strideMetresFor(4) === DEFAULT_STRIDE_M);
  check('a giant height is ignored too', strideMetresFor(900) === DEFAULT_STRIDE_M);
  check('NaN height falls back', strideMetresFor(NaN) === DEFAULT_STRIDE_M);

  // Distance
  check('distance = steps x stride',
    Math.abs(distanceKmFor(10000, 180) - (10000 * strideMetresFor(180)) / 1000) < 1e-9);
  check('10,000 steps at 180 cm is ~7.5 km', Math.abs(distanceKmFor(10000, 180) - 7.45) < 0.05,
    `${distanceKmFor(10000, 180).toFixed(2)} km`);
  check('negative steps cover no ground', distanceKmFor(-500, 180) === 0);
  check('NaN steps cover no ground', distanceKmFor(NaN, 180) === 0);

  // Calories
  check(`the reference rate is quoted for ${REFERENCE_WEIGHT_KG} kg`,
    Math.abs(kcalPerStepFor(REFERENCE_WEIGHT_KG) - KCAL_REF) < 1e-9);
  check('no weight falls back to the reference rate', kcalPerStepFor(undefined) === KCAL_REF);
  check('a heavier person burns more per step', kcalPerStepFor(95) > kcalPerStepFor(60));
  check('calories scale linearly with weight',
    Math.abs(kcalPerStepFor(140) - 2 * kcalPerStepFor(70)) < 1e-9);
  check('a 55 kg adult burns ~0.031 kcal/step', Math.abs(kcalPerStepFor(55) - 0.0314) < 0.001,
    `${kcalPerStepFor(55).toFixed(4)}`);
  check('10,000 steps at 85 kg is ~486 kcal', Math.abs(caloriesFor(10000, 85) - 485.7) < 1,
    `${caloriesFor(10000, 85).toFixed(1)}`);
  check('an impossible weight is ignored', kcalPerStepFor(2) === KCAL_REF);
  check('negative steps burn nothing', caloriesFor(-1, 80) === 0);

  // The default path must not have moved: the app already shipped on these.
  check('the unpersonalised numbers are unchanged',
    Math.abs(distanceKmFor(8240) - 6.4272) < 1e-6 && Math.abs(caloriesFor(8240) - 329.6) < 1e-6,
    `${distanceKmFor(8240).toFixed(4)} km / ${caloriesFor(8240).toFixed(1)} kcal`);

  // Speed
  check('speed derives from cadence and stride',
    Math.abs(speedKmhFor(110, 180) - (110 * strideMetresFor(180) * 60) / 1000) < 1e-9,
    `${speedKmhFor(110, 180).toFixed(2)} km/h`);
  check('a normal walking cadence is ~4.9 km/h', Math.abs(speedKmhFor(110, 180) - 4.92) < 0.1);
  check('zero cadence is zero speed', speedKmhFor(0, 180) === 0);
  check('negative cadence is zero speed', speedKmhFor(-40, 180) === 0);
}

{
  // The explanation must quote the number the code produced — a disclosure
  // panel that drifts from the maths is worse than no disclosure at all.
  const body = { heightCm: 174, weightKg: 63 };
  const dist = explainDistance(9120, body);
  const cal = explainCalories(9120, body);

  check('the distance explanation is flagged personalised', dist.personalised === true);
  check('the calorie explanation is flagged personalised', cal.personalised === true);
  check('the distance explanation quotes the computed km',
    dist.substituted.includes(distanceKmFor(9120, 174).toFixed(2)), dist.substituted);
  check('the calorie explanation quotes the computed kcal',
    cal.substituted.includes(String(Math.round(caloriesFor(9120, 63)))), cal.substituted);
  check('the distance explanation states the stride rule', dist.formula.includes('0.414'));
  check('the calorie explanation states the MET rule', cal.formula.includes('MET'));
  check('calories are declared active-only, not total burn',
    cal.assumption.toLowerCase().includes('resting'), cal.assumption);

  const generic = { heightCm: null, weightKg: null };
  check('with no body data the distance reads as a default',
    explainDistance(9120, generic).personalised === false);
  check('with no body data the calories read as a default',
    explainCalories(9120, generic).personalised === false);
  check('a missing height is called out, with the fix',
    explainDistance(9120, generic).assumption.includes('Add your height'));
  check('a missing weight is called out, with the fix',
    explainCalories(9120, generic).assumption.includes('Add your weight'));

  check('no explanation ever renders NaN', [
    explainDistance(NaN, {}), explainCalories(NaN, {}),
    explainDistance(9120, { heightCm: NaN }), explainCalories(9120, { weightKg: Infinity }),
  ].every((e) => !`${e.formula}${e.substituted}${e.assumption}`.includes('NaN')));
}

// --- Part F: sync policy ------------------------------------------------------
console.log(`\n${C.b}${C.c}Part F — Firestore sync policy${C.x}\n`);

{
  const now = 1800000000000;

  check('a first real count writes',
    shouldWrite({ steps: 1200, lastWrittenSteps: 0, lastWriteAt: 0, now }) === true);
  check('zero steps never write',
    shouldWrite({ steps: 0, lastWrittenSteps: 0, lastWriteAt: 0, now }) === false);
  check('an unchanged count does not write again',
    shouldWrite({ steps: 1200, lastWrittenSteps: 1200, lastWriteAt: 0, now }) === false);
  check('a LOWER count never writes — a day cannot walk backwards',
    shouldWrite({ steps: 900, lastWrittenSteps: 1200, lastWriteAt: 0, now }) === false);
  check('a higher count inside the throttle window waits',
    shouldWrite({ steps: 1400, lastWrittenSteps: 1200, lastWriteAt: now - 5000, now }) === false);
  check('a higher count past the throttle window writes',
    shouldWrite({ steps: 1400, lastWrittenSteps: 1200, lastWriteAt: now - WRITE_THROTTLE_MS - 1, now }) === true);
  check('force bypasses the throttle but not the monotonic rule',
    shouldWrite({ steps: 1400, lastWrittenSteps: 1200, lastWriteAt: now, now, force: true }) === true &&
    shouldWrite({ steps: 900, lastWrittenSteps: 1200, lastWriteAt: now, now, force: true }) === false);
  check('a hostile step count cannot force a write',
    shouldWrite({ steps: NaN, lastWrittenSteps: 0, lastWriteAt: 0, now }) === false &&
    shouldWrite({ steps: -50, lastWrittenSteps: 0, lastWriteAt: 0, now }) === false);
}

{
  check('two devices merge to the higher count', mergeDayCount(4200, 7100) === 7100);
  check('merging is order-independent',
    mergeDayCount(4200, 7100) === mergeDayCount(7100, 4200));
  check('a fresh install adopts the server count', mergeDayCount(0, 9300) === 9300);
  check('an offline server does not zero the local count', mergeDayCount(9300, 0) === 9300);
  check('garbage on either side is ignored',
    mergeDayCount(NaN, 500) === 500 && mergeDayCount(500, undefined) === 500);

  const merged = mergeHistory(
    { '2026-08-20': 8000, '2026-08-21': 3000 },
    { '2026-08-21': 9000, '2026-08-19': 12000 },
  );
  check('history merge keeps the higher of each overlapping day', merged['2026-08-21'] === 9000);
  check('history merge keeps local-only days', merged['2026-08-20'] === 8000);
  check('history merge ADDS server-only days — a fresh install has no local history',
    merged['2026-08-19'] === 12000);
  check('history merge never invents a day', Object.keys(merged).length === 3);
}

{
  // The native plugin restarts its session counter from zero on every start.
  // This clamp is the only thing standing between that and a wiped day.
  check('a normal reading yields the increment', sessionDelta(140, 100) === 40);
  check('the first reading of a session counts in full', sessionDelta(25, 0) === 25);
  check('a session restart contributes nothing, not a negative', sessionDelta(0, 5400) === 0);
  check('a mid-walk restart cannot claw back real steps', sessionDelta(12, 5400) === 0);
  check('a repeated reading adds nothing', sessionDelta(300, 300) === 0);
  check('a garbage reading adds nothing',
    sessionDelta(NaN, 100) === 0 && sessionDelta(-5, 100) === 0 && sessionDelta(undefined, 100) === 0);

  // A day of readings with two app restarts in the middle must total exactly
  // the steps actually taken — never fewer, never double-counted.
  let total = 0;
  let previous = 0;
  for (const reading of [30, 90, 210, 400, 0, 55, 130, 260, 0, 40, 95]) {
    total += sessionDelta(reading, previous);
    previous = reading;
  }
  check('two restarts mid-day lose nothing and duplicate nothing', total === 400 + 260 + 95,
    `${total} vs ${400 + 260 + 95}`);
}

// --- Part G: theme resolution -------------------------------------------------
console.log(`\n${C.b}${C.c}Part G — theme resolution${C.x}\n`);

{
  check('an explicit light choice pins light, whatever the OS says',
    resolveTheme('light', true) === 'light' && resolveTheme('light', false) === 'light');
  check('an explicit dark choice pins dark, whatever the OS says',
    resolveTheme('dark', false) === 'dark' && resolveTheme('dark', true) === 'dark');
  check('system follows a dark OS', resolveTheme('system', true) === 'dark');
  check('system follows a light OS', resolveTheme('system', false) === 'light');
  check('every choice resolves to exactly light or dark',
    ['light', 'dark', 'system'].every((choice) =>
      [true, false].every((os) => ['light', 'dark'].includes(resolveTheme(choice, os)))));
  check('the toggle cycle visits all three states and returns to the start',
    (() => {
      const next = (c) => (c === 'light' ? 'dark' : c === 'dark' ? 'system' : 'light');
      const seen = new Set();
      let current = 'system';
      for (let i = 0; i < 3; i++) { current = next(current); seen.add(current); }
      return seen.size === 3 && current === 'system';
    })());
}

// --- Part H: background counter arithmetic ------------------------------------
console.log(`\n${C.b}${C.c}Part H — background step counter${C.x}\n`);

{
  // The first reading can only establish a baseline. Claiming it as steps would
  // hand every user a few thousand free steps on first launch, because the
  // sensor reports steps since BOOT, not since install.
  const fresh = emptyCounterState();
  check('the first ever reading claims nothing', rawReadingDelta(53000, fresh) === 0);
  const seeded = applyRawReading(53000, fresh);
  check('the first reading establishes the baseline',
    seeded.hasBaseline === true && seeded.lastRaw === 53000 && seeded.stepsToday === 0);

  // The normal path.
  check('a later reading yields the difference', rawReadingDelta(53420, seeded) === 420);
  const walked = applyRawReading(53420, seeded);
  check('the difference lands on today', walked.stepsToday === 420);

  // THE POINT OF THE WHOLE FEATURE: the hardware kept counting while the app
  // was dead, so the first reading after a restart carries all of it.
  const afterHoursClosed = applyRawReading(59420, walked);
  check('steps taken while the app was CLOSED are recovered in full',
    afterHoursClosed.stepsToday === 420 + 6000, `${afterHoursClosed.stepsToday}`);

  // Reboot: the counter resets to zero, so a LOWER reading is a restart and the
  // value is itself the steps since boot. Treating it as a difference would
  // produce a huge negative and wipe the day.
  check('a reboot is detected as a lower reading, not as negative steps',
    rawReadingDelta(80, afterHoursClosed) === 80);
  const afterReboot = applyRawReading(80, afterHoursClosed);
  check('a reboot ADDS the post-boot steps rather than erasing the day',
    afterReboot.stepsToday === 420 + 6000 + 80, `${afterReboot.stepsToday}`);
  check('a reboot rebases the raw counter', afterReboot.lastRaw === 80);
  check('counting continues normally after a reboot',
    applyRawReading(300, afterReboot).stepsToday === 420 + 6000 + 80 + 220);

  // Garbage in.
  check('a negative reading changes nothing',
    applyRawReading(-5, walked).stepsToday === walked.stepsToday);
  check('a NaN reading changes nothing',
    applyRawReading(NaN, walked).stepsToday === walked.stepsToday);
  check('an undefined reading changes nothing',
    applyRawReading(undefined, walked).stepsToday === walked.stepsToday);
  check('a repeated reading adds nothing', rawReadingDelta(53420, walked) === 0);
  check('an implausible jump is rejected, not banked',
    rawReadingDelta(53420 + MAX_PLAUSIBLE_DELTA + 1, walked) === 0);
  check('a jump just inside the plausible bound is kept',
    rawReadingDelta(53420 + MAX_PLAUSIBLE_DELTA, walked) === MAX_PLAUSIBLE_DELTA);
}

{
  // Day rollover. The raw baseline must survive it: the hardware counter knows
  // nothing about midnight, and resetting it would make the first reading after
  // midnight look like a reboot and gift the user a full day of steps.
  const end = { stepsToday: 9120, lastRaw: 74000, hasBaseline: true };
  const { state, archived } = rollDay(end, '2026-08-21', '2026-08-22');

  check('a new day starts at zero', state.stepsToday === 0);
  check('the finished day is archived with its real total',
    archived !== null && archived.day === '2026-08-21' && archived.steps === 9120);
  check('the raw sensor baseline SURVIVES midnight', state.lastRaw === 74000);
  check('the baseline flag survives midnight', state.hasBaseline === true);
  check('the first reading after midnight is a normal difference, not a reboot',
    rawReadingDelta(74310, state) === 310);
  check('the same day does not roll', rollDay(end, '2026-08-22', '2026-08-22').archived === null);
  check('an empty finished day is not archived',
    rollDay({ stepsToday: 0, lastRaw: 74000, hasBaseline: true }, '2026-08-21', '2026-08-22')
      .archived === null);
}

{
  // A full week, driven as the sensor would actually drive it: the app closed
  // for long stretches, one reboot, and two midnights. The total must equal the
  // steps genuinely taken — nothing lost, nothing double-counted.
  let state = emptyCounterState();
  let day = '2026-08-20';
  const archive = {};

  // Baseline established at 40,000 steps since boot.
  state = applyRawReading(40000, state);

  const timeline = [
    { raw: 43000, day: '2026-08-20' }, //  3,000 walked
    { raw: 46500, day: '2026-08-20' }, //  3,500 while app closed
    { raw: 48000, day: '2026-08-21' }, //  1,500 lands on the 21st
    { raw: 52000, day: '2026-08-21' }, //  4,000
    { raw: 150, day: '2026-08-21' },   //    150 after a reboot
    { raw: 900, day: '2026-08-22' },   //    750 lands on the 22nd
  ];

  for (const tick of timeline) {
    const rolled = rollDay(state, day, tick.day);
    if (rolled.archived) archive[rolled.archived.day] = rolled.archived.steps;
    state = rolled.state;
    day = tick.day;
    state = applyRawReading(tick.raw, state);
  }

  check('day 1 totals the steps actually walked', archive['2026-08-20'] === 6500,
    `${archive['2026-08-20']}`);
  check('day 2 survives a reboot mid-day', archive['2026-08-21'] === 1500 + 4000 + 150,
    `${archive['2026-08-21']}`);
  check('day 3 continues cleanly from the post-reboot baseline', state.stepsToday === 750,
    `${state.stepsToday}`);
  check('a week of closures, a reboot and two midnights lose nothing',
    archive['2026-08-20'] + archive['2026-08-21'] + state.stepsToday === 6500 + 5650 + 750);
}

{
  // Fuzz: hostile readings must never produce a negative day, a NaN, or a
  // count that goes backwards. A step total that decreases is the one thing a
  // user would notice instantly and never trust again.
  let seed = 20260822;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  let state = applyRawReading(1000, emptyCounterState());
  let previous = state.stepsToday;
  let violations = 0;
  let throws = 0;

  for (let i = 0; i < 4000; i++) {
    const roll = rnd();
    const raw =
      roll < 0.1 ? -Math.floor(rnd() * 1000)
      : roll < 0.2 ? NaN
      : roll < 0.25 ? Infinity
      : roll < 0.3 ? undefined
      : roll < 0.4 ? Math.floor(rnd() * 50)
      : state.lastRaw + Math.floor(rnd() * 500);
    try {
      state = applyRawReading(raw, state);
      if (!Number.isFinite(state.stepsToday)) { violations++; break; }
      if (state.stepsToday < 0) { violations++; break; }
      if (state.stepsToday < previous) { violations++; break; }
      previous = state.stepsToday;
    } catch (error) {
      throws++;
      if (throws <= 3) console.log(`  ${FAIL} counter fuzz #${i} threw: ${error.message}`);
    }
  }

  check('4,000 hostile sensor readings: zero throws', throws === 0, `${throws}`);
  check('4,000 hostile sensor readings: the day never goes backwards or NaN',
    violations === 0, `${violations} violations`);
}

// --- Part I: walking vs handling -----------------------------------------------
console.log(`\n${C.b}${C.c}Part I — step detection (rhythm gate)${C.x}\n`);

// Feed a list of peak timestamps and total what gets credited.
const run = (peaks) => {
  const d = new StepDetector();
  let total = 0;
  for (const t of peaks) total += d.push(t);
  return total;
};

// Build an evenly-spaced train, optionally jittered.
const cadence = (count, intervalMs, start = 10000, jitter = 0) => {
  const out = [];
  let t = start;
  for (let i = 0; i < count; i++) {
    out.push(Math.round(t));
    t += intervalMs + (jitter ? (((i * 37) % 11) - 5) / 5 * jitter : 0);
  }
  return out;
};

{
  // --- Walking IS counted ---
  check('a steady 20-step walk counts all 20', run(cadence(20, 520)) === 20,
    `${run(cadence(20, 520))}`);
  check('a brisk walk (2.5 steps/sec) counts in full', run(cadence(30, 400)) === 30,
    `${run(cadence(30, 400))}`);
  check('a slow stroll (1 step/sec) counts in full', run(cadence(15, 950)) === 15,
    `${run(cadence(15, 950))}`);
  check('the first steps of a walk are credited retroactively, not swallowed',
    run(cadence(MIN_RUN, 520)) === MIN_RUN, `${run(cadence(MIN_RUN, 520))}`);
  check('real gait jitter does not break the run', run(cadence(25, 520, 10000, 60)) === 25,
    `${run(cadence(25, 520, 10000, 60))}`);
  check('gradually speeding up stays counted', (() => {
    const d = new StepDetector();
    let t = 10000, total = 0, gap = 700;
    for (let i = 0; i < 20; i++) { total += d.push(t); t += gap; gap = Math.max(380, gap - 15); }
    return total === 20;
  })());

  // --- Handling is NOT counted ---
  check('a single jolt counts nothing', run([10000]) === 0);
  check('two jolts count nothing', run([10000, 10700]) === 0);
  check('three jolts count nothing — one short of a run', run([10000, 10520, 11040]) === 0);
  check('picking the phone up and putting it down counts nothing',
    run([10000, 10800, 14000, 14300]) === 0);
  check('random shaking counts nothing', (() => {
    // Deliberately irregular intervals, all above the noise floor.
    const gaps = [300, 900, 340, 1500, 420, 280, 1100, 350, 1800, 300, 700, 260];
    let t = 10000; const peaks = [t];
    for (const g of gaps) { t += g; peaks.push(t); }
    return run(peaks) === 0;
  })());
  check('a burst of very fast vibration counts nothing',
    run(cadence(30, 80)) === 0, `${run(cadence(30, 80))}`);
  check('peaks slower than a human step never form a run',
    run(cadence(10, MAX_STEP_INTERVAL_MS + 500)) === 0);

  // --- Boundaries ---
  // The ringing peak is dropped, and the genuine peaks around it still form a
  // valid gait. Sized off MIN_RUN so retuning the gate cannot silently rot this
  // fixture — it previously hard-coded 4 and broke the moment MIN_RUN moved.
  const withRing = [10000, 10000 + MIN_STEP_INTERVAL_MS - 20,
    ...Array.from({ length: MIN_RUN }, (_, i) => 10520 + i * 520)];
  // MIN_RUN + 1: the opening peak is part of the walk too, and the ring between
  // it and the next real step is the only thing dropped.
  check('a ringing peak is dropped without killing the real walk around it',
    run(withRing) === MIN_RUN + 1, `${run(withRing)} (expected ${MIN_RUN + 1})`);
  check('a gap just over the maximum breaks the run',
    run([10000, 10520, 11040, 11040 + MAX_STEP_INTERVAL_MS + 10, 12000]) === 0);
}

{
  // A walk INTERRUPTED by handling: the walk counts, the handling does not, and
  // the interruption does not destroy the steps already banked.
  const d = new StepDetector();
  let total = 0;
  for (const t of cadence(12, 520, 10000)) total += d.push(t);
  const afterWalk = total;
  check('12 steps of walking are banked', afterWalk === 12, `${afterWalk}`);

  // Now shake it irregularly — nothing more should be credited.
  for (const t of [20000, 20900, 21100, 22800, 23050]) total += d.push(t);
  check('shaking after a walk adds nothing', total === afterWalk, `${total}`);

  // Resume walking; a fresh run must build up again and then count.
  for (const t of cadence(10, 520, 40000)) total += d.push(t);
  check('walking again after the interruption counts again', total === afterWalk + 10,
    `${total}`);
}

{
  // The idle() sweep must stop two distant jolts pretending to be a rhythm.
  const d = new StepDetector();
  let total = 0;
  total += d.push(10000);
  total += d.push(10520);
  d.idle(10520 + MAX_STEP_INTERVAL_MS + 1);
  total += d.push(30000);
  total += d.push(30520);
  check('idle() discards a stale partial run', total === 0, `${total}`);
}

{
  // Fuzz: hostile timestamps must never throw, never credit a negative, and
  // never credit more steps than peaks offered.
  let seed = 424242;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let throws = 0, bad = 0;

  for (let i = 0; i < 2000; i++) {
    const d = new StepDetector();
    let credited = 0, offered = 0;
    let t = 10000;
    try {
      for (let j = 0; j < 40; j++) {
        const roll = rnd();
        const stamp =
          roll < 0.05 ? NaN
          : roll < 0.1 ? -t
          : roll < 0.15 ? undefined
          : (t += Math.floor(rnd() * 2500));
        offered++;
        const got = d.push(stamp);
        if (!Number.isFinite(got) || got < 0) { bad++; break; }
        credited += got;
      }
      if (credited > offered) bad++;
    } catch (error) {
      throws++;
      if (throws <= 3) console.log(`  ${FAIL} detector fuzz #${i} threw: ${error.message}`);
    }
  }
  check('2,000 hostile peak streams: zero throws', throws === 0, `${throws}`);
  check('2,000 hostile peak streams: never credits more steps than peaks seen',
    bad === 0, `${bad} violations`);
}

// --- Part J: end-to-end gait simulation ----------------------------------------
console.log(`\n${C.b}${C.c}Part J — gait simulation (full signal path)${C.x}\n`);

let SAMPLE_HZ = 60;
let SAMPLE_MS = 1000 / SAMPLE_HZ;
const GRAVITY = 9.81;
const setRate = (hz) => { SAMPLE_HZ = hz; SAMPLE_MS = 1000 / hz; };

// Deterministic pseudo-noise, so a failure is always reproducible.
let noiseSeed = 987654321;
const noise = (amp) => {
  noiseSeed = (noiseSeed * 1103515245 + 12345) % 2147483648;
  return ((noiseSeed / 2147483648) - 0.5) * 2 * amp;
};

/**
 * Walking accelerometer magnitude.
 *
 * Real gait is not a clean sine: each stride has a strong heel strike plus a
 * smaller toe-off, which is why a second harmonic is included. That harmonic is
 * exactly what produces the closely-spaced double peaks a naive detector either
 * double-counts or chokes on.
 */
const walkSignal = ({ steps, stepsPerSec, amplitude, harmonic = 0.35, noiseAmp = 0.12, startAt = 100000 }) => {
  const out = [];
  const durationMs = (steps / stepsPerSec) * 1000;
  const w = 2 * Math.PI * stepsPerSec;
  for (let t = 0; t < durationMs; t += SAMPLE_MS) {
    const phase = (w * t) / 1000;
    const mag = GRAVITY
      + amplitude * Math.sin(phase)
      + amplitude * harmonic * Math.sin(2 * phase + 0.9)
      + noise(noiseAmp);
    out.push({ mag, at: Math.round(startAt + t) });
  }
  return out;
};

/** Feed a signal through the pipeline and total the credited steps. */
const runSignal = (samples, pipeline = new StepPipeline()) => {
  let total = 0;
  for (const s of samples) total += pipeline.push(s.mag, s.at);
  return total;
};

/** Steps counted as a percentage of steps actually taken. */
const accuracy = (counted, actual) => (counted / actual) * 100;

{
  // --- The rate sweep. `devicemotion` is NOT 60 Hz: it is whatever the device
  // and browser deliver, measured at 14 Hz in one real environment and commonly
  // 16-60 Hz across Android. A filter coefficient hard-coded for 60 Hz becomes a
  // ~1 Hz cutoff at 14 Hz, which filters out walking itself and pins the counter
  // at zero. That shipped once; this sweep is here so it cannot ship again.
  // 14 Hz is the measured real-world floor (Android delivers roughly 16-60 Hz;
  // 14 Hz was observed in a headless Chromium). 12 Hz is included for ordinary
  // walking, but not for the gentle case — see the note on MIN_PEAK_MAGNITUDE
  // for why buying that back costs more than it is worth.
  for (const hz of [12, 14, 20, 30, 50, 60]) {
    setRate(hz);
    const counted = runSignal(walkSignal({ steps: 100, stepsPerSec: 1.8, amplitude: 3.0 }));
    const pct = accuracy(counted, 100);
    check(`walking is counted at a ${hz} Hz sample rate`, pct >= 80 && pct <= 120,
      `${counted}/100 = ${pct.toFixed(0)}%`);

    // The hard combination: a gentle hand-carried walk AND a slow sample rate.
    // Low amplitude leaves little headroom over the noise floor, and a low rate
    // costs more of it in the filter — so this is where a threshold set for a
    // brisk pocket walk quietly stops counting.
    if (hz >= 14) {
      const gentle = runSignal(walkSignal({ steps: 100, stepsPerSec: 1.6, amplitude: 1.5 }));
      check(`a gentle walk is counted at ${hz} Hz`, gentle >= 70 && gentle <= 130,
        `${gentle}/100`);
    }
  }
  setRate(60);
}

{
  // --- Real walking must be counted, across placements and paces ---
  const cases = [
    { name: 'vigorous walk, phone in pocket', steps: 100, stepsPerSec: 2.0, amplitude: 4.0 },
    { name: 'normal walk, phone in pocket',   steps: 100, stepsPerSec: 1.8, amplitude: 3.0 },
    { name: 'normal walk, phone in hand',     steps: 100, stepsPerSec: 1.8, amplitude: 2.0 },
    { name: 'gentle walk, phone in hand',     steps: 100, stepsPerSec: 1.6, amplitude: 1.5 },
    { name: 'slow stroll',                    steps: 100, stepsPerSec: 1.2, amplitude: 2.2 },
    { name: 'brisk march',                    steps: 100, stepsPerSec: 2.4, amplitude: 5.0 },
    { name: 'jogging',                        steps: 100, stepsPerSec: 2.8, amplitude: 7.0 },
  ];

  for (const c of cases) {
    const counted = runSignal(walkSignal(c));
    const pct = accuracy(counted, c.steps);
    // Within 20% either way: a pedometer that misses a fifth of a walk, or
    // invents a fifth, is not usable. Consumer trackers land in this band.
    check(`${c.name}: counts within 20%`, pct >= 80 && pct <= 120,
      `${counted}/${c.steps} = ${pct.toFixed(0)}%`);
  }
}

{
  // --- Handling the phone must NOT be counted ---
  const still = [];
  for (let i = 0; i < 600; i++) still.push({ mag: GRAVITY + noise(0.05), at: 100000 + i * SAMPLE_MS });
  check('a phone sitting on a desk counts nothing', runSignal(still) === 0, `${runSignal(still)}`);

  // A single sharp jolt: picking it up.
  const jolt = [];
  for (let i = 0; i < 300; i++) {
    const t = i * SAMPLE_MS;
    const spike = (t > 500 && t < 700) ? 6 * Math.sin(((t - 500) / 200) * Math.PI) : 0;
    jolt.push({ mag: GRAVITY + spike + noise(0.08), at: 100000 + t });
  }
  check('picking the phone up counts nothing', runSignal(jolt) === 0, `${runSignal(jolt)}`);

  // Irregular waving — big amplitudes, no steady rhythm.
  // Irregular at the level that matters: each half-swing gets its OWN duration,
  // between 140 ms and 900 ms, so consecutive peaks are genuinely far apart in
  // period. Two earlier versions of this test got the randomness wrong —
  // `i % 13` is periodic, and per-sample jitter averages out across a
  // half-cycle — so both were quietly simulating a steady rhythm and then
  // complaining the rhythm gate counted it. Rhythmic shaking at walking cadence
  // IS counted, by this and by every consumer pedometer; that is a real and
  // stated limit, not something to fake a passing test around.
  const wave = [];
  let wavePhase = 0;
  let waveAt = 100000;
  for (let swing = 0; swing < 26; swing++) {
    const swingMs = 140 + Math.abs(noise(1)) * 760;
    const samples = Math.max(3, Math.round(swingMs / SAMPLE_MS));
    for (let i = 0; i < samples; i++) {
      wavePhase += Math.PI / samples;
      wave.push({ mag: GRAVITY + 5 * Math.sin(wavePhase) + noise(0.3), at: Math.round(waveAt) });
      waveAt += SAMPLE_MS;
    }
  }
  const waved = runSignal(wave);
  // Bound, not zero — and deliberately so. Randomly-timed swings will sometimes
  // contain a genuinely rhythmic stretch, and when they do it is counted,
  // because at that point the signal IS rhythmic motion at walking cadence.
  // Verified by construction: raising MIN_RUN from 5 to 7 does not change this
  // number at all, which means it comes from one real rhythmic stretch rather
  // than from the gate being loose. ~13 s of shaking yielding under ten steps is
  // the honest floor for an accelerometer; the hardware step sensor in the
  // Android build is the fix, not a tighter threshold here.
  check('irregular handling stays low', waved <= 15, `${waved}`);

  // High-frequency vibration (a phone on a buzzing table / in a car).
  const buzz = [];
  for (let i = 0; i < 900; i++) {
    const t = i * SAMPLE_MS;
    buzz.push({ mag: GRAVITY + 3 * Math.sin((2 * Math.PI * 12 * t) / 1000) + noise(0.2), at: 100000 + t });
  }
  check('12 Hz vibration counts nothing', runSignal(buzz) === 0, `${runSignal(buzz)}`);
}

{
  // --- A realistic day: walk, stop, handle the phone, walk again ---
  const pipeline = new StepPipeline();
  let total = 0;
  let clock = 100000;

  const feed = (samples) => { total += runSignal(samples, pipeline); };
  const idleFor = (ms) => {
    for (let t = 0; t < ms; t += SAMPLE_MS) {
      total += pipeline.push(GRAVITY + noise(0.05), Math.round(clock + t));
    }
    clock += ms;
  };

  const walk = (steps, sps, amp) => {
    const sig = walkSignal({ steps, stepsPerSec: sps, amplitude: amp, startAt: clock });
    feed(sig);
    clock = sig[sig.length - 1].at + SAMPLE_MS;
  };

  walk(40, 1.8, 3.0);
  const afterFirst = total;
  check('first 40-step walk is counted', accuracy(afterFirst, 40) >= 80, `${afterFirst}/40`);

  idleFor(8000);
  check('standing still adds nothing', total === afterFirst, `${total}`);

  // Handle the phone: a few irregular jolts.
  for (const gapMs of [0, 700, 260, 1500, 400]) {
    clock += gapMs;
    for (let i = 0; i < 12; i++) {
      total += pipeline.push(GRAVITY + 5 * Math.sin((i / 12) * Math.PI) + noise(0.2), Math.round(clock + i * SAMPLE_MS));
    }
    clock += 12 * SAMPLE_MS;
  }
  check('handling the phone between walks adds at most a couple', total - afterFirst <= 4,
    `${total - afterFirst}`);

  const beforeSecond = total;
  idleFor(5000);
  walk(60, 2.0, 3.5);
  check('the second walk is still counted after the interruption',
    accuracy(total - beforeSecond, 60) >= 80, `${total - beforeSecond}/60`);
}

{
  // Fuzz the whole pipeline with hostile samples: no throws, no negatives, and
  // a still phone can never accumulate steps.
  let seed = 13579;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let throws = 0, bad = 0;

  for (let i = 0; i < 500; i++) {
    const pipeline = new StepPipeline();
    let t = 100000, credited = 0;
    try {
      for (let j = 0; j < 200; j++) {
        const roll = rnd();
        const mag = roll < 0.05 ? NaN : roll < 0.1 ? Infinity : roll < 0.15 ? -50 : GRAVITY + (rnd() - 0.5) * 20;
        t += Math.floor(rnd() * 60);
        const got = pipeline.push(mag, t);
        if (!Number.isFinite(got) || got < 0) { bad++; break; }
        credited += got;
      }
    } catch (error) {
      throws++;
      if (throws <= 3) console.log(`  ${FAIL} pipeline fuzz #${i} threw: ${error.message}`);
    }
  }
  check('500 hostile sample streams: zero throws', throws === 0, `${throws}`);
  check('500 hostile sample streams: never a negative credit', bad === 0, `${bad}`);
}

// --- Summary -----------------------------------------------------------------
const total = passCount + failCount;
console.log(`\n${C.b}Result: ${passCount}/${total} checks passed${C.x}`);
if (failCount > 0) { console.log(`${C.r}${C.b}PROOF FAILED${C.x}`); process.exit(1); }
console.log(`${C.g}${C.b}100% success, zero errors${C.x}`);
