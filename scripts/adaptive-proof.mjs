// Tests for the adaptive calorie target and trend weight (src/lib/adaptiveTarget.ts).
// Simulated people with a KNOWN real burn: the app must recover it from their
// logs and weigh-ins, including when they under-log. Controls must fail.
import {
  adaptiveTarget, trendSeries, dailyIntake, cleanWeighIns, goalOffset, localDate,
  KCAL_PER_KG, MIN_TARGET, MAX_STEP,
} from '../src/lib/adaptiveTarget.ts';

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const DAY = 86_400_000;
const day = (n) => new Date(Date.UTC(2026, 9, 1) + n * DAY).toISOString().slice(0, 10);
const TODAY = day(35);

// Deterministic noise so runs are repeatable.
let seed = 7;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

/**
 * A person whose real burn is `burn` and who really eats `eat` a day, but logs
 * only `logShare` of it. Weight follows energy balance plus daily water noise.
 */
const simulate = ({ burn, eat, logShare = 1, days = 35, startKg = 80, noiseKg = 0.6, weighEvery = 1, logEvery = 1 }) => {
  const weighIns = [], meals = [];
  let kg = startKg;
  for (let i = 0; i < days; i++) {
    kg += (eat - burn) / KCAL_PER_KG;
    if (i % weighEvery === 0) weighIns.push({ date: day(i), kg: Math.round((kg + (rand() - 0.5) * 2 * noiseKg) * 10) / 10 });
    if (i % logEvery === 0) {
      // Three meals that add up to the logged share of what was eaten.
      const logged = eat * logShare * (0.95 + rand() * 0.1);
      meals.push({ date: day(i), kcal: logged * 0.3 }, { date: day(i), kcal: logged * 0.4 }, { date: day(i), kcal: logged * 0.3 });
    }
  }
  return { weighIns, intake: dailyIntake(meals) };
};

// --- 1. Trend weight -------------------------------------------------------
const flat = trendSeries([{ date: day(0), kg: 80 }, { date: day(1), kg: 82 }, { date: day(2), kg: 79 }, { date: day(3), kg: 81 }]);
ok('trend: a 2 kg water spike moves the trend only ~0.2 kg', near(flat[1].trend, 80.2, 0.01));
ok('trend: daily line stays within 0.3 kg of 80 while raw swings 3 kg', flat.every((p) => near(p.trend, 80, 0.3)));
ok('trend: one point per day, raw kept', flat.length === 4 && flat[2].kg === 79);
const gap = trendSeries([{ date: day(0), kg: 80 }, { date: day(5), kg: 79 }]);
ok('trend: gaps are carried flat (6 points, days 1-4 = no raw weight)', gap.length === 6 && gap.slice(1, 5).every((p) => p.kg === null && p.trend === 80));
ok('trend: extends to "until" date', trendSeries([{ date: day(0), kg: 80 }], day(3)).length === 4);
ok('trend: empty in, empty out', trendSeries([]).length === 0);
ok('weigh-ins: junk dropped (0 kg, 900 kg, bad date, NaN)', cleanWeighIns([{ date: day(0), kg: 0 }, { date: day(1), kg: 900 }, { date: 'x', kg: 80 }, { date: day(2), kg: NaN }, { date: day(3), kg: 70 }]).length === 1);
ok('weigh-ins: two on one day -> the last one wins', cleanWeighIns([{ date: day(0), kg: 80 }, { date: day(0), kg: 79 }])[0].kg === 79);

// --- 2. Daily intake --------------------------------------------------------
const di = dailyIntake([{ date: day(0), kcal: 500 }, { date: day(0), kcal: 700 }, { date: day(1), kcal: -5 }, { date: day(1), kcal: 'x' }, { date: day(2), kcal: 300 }]);
ok('intake: meals summed per day, junk ignored', di.length === 2 && di[0].kcal === 1200 && di[1].kcal === 300);
ok('localDate formats local YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(localDate(new Date())));

// --- 3. Recovering the real burn ------------------------------------------------
const honest = simulate({ burn: 2500, eat: 2000 });
const r1 = adaptiveTarget({ ...honest, today: TODAY, goal: 'fat_loss', currentTarget: 2000 });
ok(`honest logger, real burn 2500: estimate within 120 (got ${r1.burn})`, r1.status === 'ready' && near(r1.burn, 2500, 120));
ok(`  ...and sees the loss (~-0.45 kg/wk, got ${r1.kgPerWeek})`, r1.kgPerWeek < -0.3 && r1.kgPerWeek > -0.6);

const under = simulate({ burn: 2500, eat: 2000, logShare: 0.85 });
const r2 = adaptiveTarget({ ...under, today: TODAY, goal: 'maintenance', currentTarget: 1700 });
// Logs 1700 a day while losing 0.45 kg/week: "burn" in LOGGED kcal is about 2200,
// so maintaining on logged numbers means a 2200 target. That is right for them.
ok(`under-logger (logs 85%): burn is in their own logged units (~2200, got ${r2.burn})`, r2.status === 'ready' && near(r2.burn, 2200, 130));

const gainer = simulate({ burn: 2200, eat: 2700 });
const r3 = adaptiveTarget({ ...gainer, today: TODAY, goal: 'fat_loss', currentTarget: 2700 });
ok(`gaining on 2700 when trying to lose: target goes DOWN (change ${r3.change})`, r3.status === 'ready' && r3.change < 0);
ok('  ...by at most one step', r3.change >= -MAX_STEP);

const steady = simulate({ burn: 2300, eat: 2300 });
const r4 = adaptiveTarget({ ...steady, today: TODAY, goal: 'maintenance', currentTarget: 2300 });
ok(`steady weight on 2300, goal maintain: no change suggested (change ${r4.change})`, r4.status === 'ready' && Math.abs(r4.change) < 50);
ok('  ...message says keep it', /keep it/.test(r4.message));

const noisy = simulate({ burn: 2600, eat: 2100, noiseKg: 1.5 });
const r5 = adaptiveTarget({ ...noisy, today: TODAY, goal: 'fat_loss', currentTarget: 2100 });
ok(`very noisy scale (+-1.5 kg/day): still within 300 of 2600 (got ${r5.burn})`, r5.status === 'ready' && near(r5.burn, 2600, 300));

// --- 3b. Over many people, not one lucky draw ------------------------------------
let falseAlarms = 0, caught = 0, errSum = 0;
for (let i = 0; i < 100; i++) {
  const b = 1800 + Math.floor(rand() * 1400);
  const st = simulate({ burn: b, eat: b });
  const rs = adaptiveTarget({ ...st, today: TODAY, goal: 'maintenance', currentTarget: b });
  if (rs.status === 'ready' && rs.change !== 0) falseAlarms++;
  const off = simulate({ burn: b, eat: b + 500 });             // eating 500 over, told to maintain
  const ro = adaptiveTarget({ ...off, today: TODAY, goal: 'maintenance', currentTarget: b + 500 });
  if (ro.status === 'ready' && ro.change < 0) caught++;
  const hl = simulate({ burn: b, eat: b - 500 });
  const rh = adaptiveTarget({ ...hl, today: TODAY, goal: 'fat_loss', currentTarget: b - 500 });
  if (rh.status === 'ready') errSum += Math.abs(rh.burn - b);
}
ok(`100 steady people at the right target: <= 10 told to change (got ${falseAlarms})`, falseAlarms <= 10);
ok(`100 people eating 500 over maintenance: >= 90 told to lower (got ${caught})`, caught >= 90);
ok(`100 dieters: average burn error <= 100 kcal (got ${Math.round(errSum / 100)})`, errSum / 100 <= 100);

// --- 4. Safety ------------------------------------------------------------------
const crash = simulate({ burn: 1500, eat: 1500, startKg: 50 });
const r6 = adaptiveTarget({ ...crash, today: TODAY, goal: 'fat_loss', currentTarget: 1250 });
ok(`never below ${MIN_TARGET} (got ${r6.target})`, r6.status === 'ready' && r6.target >= MIN_TARGET);
ok('target is a round 10', r1.status === 'ready' && r1.target % 10 === 0);
let lurch = 0;
for (let i = 0; i < 200; i++) {
  const p = simulate({ burn: 1500 + Math.floor(rand() * 2500), eat: 1300 + Math.floor(rand() * 2500), noiseKg: rand() * 2 });
  const cur = 1300 + Math.floor(rand() * 2500);
  const r = adaptiveTarget({ ...p, today: TODAY, goal: ['fat_loss', 'muscle_gain', 'maintenance', undefined][i % 4], currentTarget: cur });
  if (r.status !== 'ready' || Math.abs(r.target - Math.round(cur / 10) * 10) > MAX_STEP + 10 || r.target < MIN_TARGET || !Number.isFinite(r.burn)) lurch++;
}
ok('fuzz 200 random people: always ready, finite, >= floor, never moves more than one step', lurch === 0);

// --- 5. Not enough data ---------------------------------------------------------
const few = simulate({ burn: 2500, eat: 2000, days: 6 });
const r7 = adaptiveTarget({ ...few, today: day(7), goal: 'fat_loss', currentTarget: 2000 });
ok('6 days of data: asks for more, suggests nothing', r7.status === 'need_data' && /more fully logged day/.test(r7.message));
const noWeigh = simulate({ burn: 2500, eat: 2000, weighEvery: 100 });
const r8 = adaptiveTarget({ ...noWeigh, today: TODAY, goal: 'fat_loss', currentTarget: 2000 });
ok('logs every day but weighed once: asks for weigh-ins', r8.status === 'need_data' && /weigh-in/.test(r8.message));
const partial = simulate({ burn: 2500, eat: 2000, logShare: 0.3 });
const r9 = adaptiveTarget({ ...partial, today: TODAY, goal: 'fat_loss', currentTarget: 2000 });
ok('only snacks logged (600 kcal days): partial days ignored -> need data', r9.status === 'need_data');
const todayOnly = adaptiveTarget({ weighIns: honest.weighIns, intake: [...honest.intake.filter((d) => d.date < day(20)), { date: TODAY, kcal: 900 }], today: TODAY, goal: 'fat_loss', currentTarget: 2000 });
ok('today (still being logged) never counts', todayOnly.status === 'ready' ? todayOnly.loggedDays === honest.intake.filter((d) => d.date < day(20) && d.date > day(7)).length : true);

// Weekly logger: weighs twice a week, logs most days.
const sparse = simulate({ burn: 2400, eat: 1900, weighEvery: 3 });
const r10 = adaptiveTarget({ ...sparse, today: TODAY, goal: 'fat_loss', currentTarget: 1900 });
ok(`weighs every 3rd day: still works (burn ${r10.burn})`, r10.status === 'ready' && near(r10.burn, 2400, 200));

// --- 6. Goal offsets ------------------------------------------------------------
ok('fat loss at 80 kg: about 440 kcal under (0.5%/week)', near(-goalOffset('fat_loss', 80), 440, 5));
ok('fat loss at 200 kg: capped at 750', goalOffset('fat_loss', 200) === -750);
ok('fat loss at 45 kg: at least 300', goalOffset('fat_loss', 45) === -300);
ok('muscle gain: +250, maintenance: 0', goalOffset('muscle_gain', 80) === 250 && goalOffset('maintenance', 80) === 0);

// --- 7. CONTROLS: these must fail, proving the checks can catch a wrong answer ----
const controlBurn = near(r1.burn, 3200, 120);
ok('CONTROL: a wrong expected burn (3200) does NOT match', !controlBurn);
const wrongSign = r1.status === 'ready' && r1.avgIntake + (r1.kgPerWeek / 7) * KCAL_PER_KG; // sign error version
ok('CONTROL: the sign-flipped formula would give a burn far from 2500', !near(wrongSign, 2500, 200));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
