/**
 * Adaptive calorie target and trend weight. Pure: no Firebase, no React, so
 * scripts/adaptive-proof.mjs can test every rule.
 *
 * The idea: a person's real daily burn is what they ate plus what their body
 * gave up. Over a few weeks,
 *
 *     burn  =  average logged intake  -  (trend weight change per day x 7700 kcal/kg)
 *
 * Losing 0.5 kg a week on 1,800 logged kcal means a burn of about 2,350.
 * Because the burn is worked out FROM the logged intake, someone who always
 * under-logs by 15% gets a burn that is 15% low too, and the target built on
 * it is right for them anyway: the scale is the referee.
 *
 * Daily weights jump around with water and salt, so the maths uses a trend
 * (an exponentially smoothed weight, the "Hacker's Diet" method) rather than
 * raw weigh-ins. The same trend is what the chart shows.
 */

export interface WeighIn { date: string; kg: number }     // date = local YYYY-MM-DD
export interface DayIntake { date: string; kcal: number }  // total logged that day
export interface TrendPoint { date: string; kg: number | null; trend: number }

export type Goal = 'fat_loss' | 'muscle_gain' | 'maintenance' | 'athletic_performance' | undefined;

/** kcal stored in 1 kg of body-weight change (mixed fat and lean tissue). */
export const KCAL_PER_KG = 7700;
/** Smoothing per day. 0.1 = the trend moves 10% of the way to each new weigh-in. */
export const TREND_ALPHA = 0.1;
/** Days of history the estimate looks back over. */
export const WINDOW_DAYS = 28;
/** Minimum evidence before the app suggests anything. */
export const MIN_LOGGED_DAYS = 10;
export const MIN_WEIGH_INS = 3;
export const MIN_SPAN_DAYS = 14;
/** A day under this many kcal is treated as "not fully logged" and left out. */
export const PARTIAL_DAY_KCAL = 800;
/** Never suggest below this, whatever the maths says. */
export const MIN_TARGET = 1200;
/** Largest change to the target in one suggestion, so it never lurches. */
export const MAX_STEP = 200;

const DAY_MS = 86_400_000;
const toDayNum = (d: string): number => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY_MS);
const fromDayNum = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10);
const isDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(`${d}T00:00:00Z`));

/** Local calendar date of a timestamp, as YYYY-MM-DD. */
export const localDate = (t: Date): string => {
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, '0');
  const d = String(t.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/** Clean weigh-ins: valid dates, 25-400 kg, one per day (the last one wins). */
export const cleanWeighIns = (raw: WeighIn[]): WeighIn[] => {
  const byDay = new Map<string, number>();
  for (const w of raw || []) {
    if (!w || !isDate(w.date)) continue;
    const kg = Number(w.kg);
    if (!Number.isFinite(kg) || kg < 25 || kg > 400) continue;
    byDay.set(w.date, kg);
  }
  return [...byDay.entries()].map(([date, kg]) => ({ date, kg })).sort((a, b) => toDayNum(a.date) - toDayNum(b.date));
};

/**
 * One point per day from the first weigh-in to `until`: the raw weight where
 * there was one, and the smoothed trend every day (carried flat across gaps).
 */
export const trendSeries = (raw: WeighIn[], until?: string): TrendPoint[] => {
  const w = cleanWeighIns(raw);
  if (!w.length) return [];
  const byDay = new Map(w.map((x) => [toDayNum(x.date), x.kg]));
  const start = toDayNum(w[0].date);
  const lastWeigh = toDayNum(w[w.length - 1].date);
  const end = until && isDate(until) ? Math.max(lastWeigh, toDayNum(until)) : lastWeigh;
  const out: TrendPoint[] = [];
  let trend = w[0].kg;
  for (let d = start; d <= end; d++) {
    const kg = byDay.get(d) ?? null;
    if (kg != null) trend = trend + TREND_ALPHA * (kg - trend);
    out.push({ date: fromDayNum(d), kg, trend: Math.round(trend * 100) / 100 });
  }
  return out;
};

/** Sum meals into one intake figure per local day. */
export const dailyIntake = (meals: { date: string; kcal: number }[]): DayIntake[] => {
  const m = new Map<string, number>();
  for (const x of meals || []) {
    if (!x || !isDate(x.date)) continue;
    const k = Number(x.kcal);
    if (!Number.isFinite(k) || k <= 0) continue;
    m.set(x.date, (m.get(x.date) || 0) + k);
  }
  return [...m.entries()].map(([date, kcal]) => ({ date, kcal: Math.round(kcal) })).sort((a, b) => toDayNum(a.date) - toDayNum(b.date));
};

/** How far below (or above) maintenance each goal aims, in kcal a day. */
export const goalOffset = (goal: Goal, trendKg: number): number => {
  if (goal === 'fat_loss') {
    // About 0.5% of body weight a week, kept between 300 and 750 kcal a day.
    const perDay = (0.005 * trendKg * KCAL_PER_KG) / 7;
    return -Math.round(Math.min(750, Math.max(300, perDay)));
  }
  if (goal === 'muscle_gain') return 250;
  return 0;
};

export type AdaptiveResult =
  | {
      status: 'need_data';
      loggedDays: number;
      weighIns: number;
      spanDays: number;
      /** Plain-language next step for the user. */
      message: string;
    }
  | {
      status: 'ready';
      /** Estimated real daily burn, kcal. */
      burn: number;
      /** Suggested daily target, kcal (already limited to MAX_STEP from the current one). */
      target: number;
      /** target - currentTarget */
      change: number;
      /** Trend change in kg per week (negative = losing). */
      kgPerWeek: number;
      /** Average fully-logged intake in the window. */
      avgIntake: number;
      loggedDays: number;
      weighIns: number;
      /** 0..1: how much the estimate leans on this person's data vs the starting guess. */
      confidence: number;
      message: string;
    };

const round10 = (n: number) => Math.round(n / 10) * 10;

/**
 * Estimate the real burn and a new target from the last WINDOW_DAYS of data.
 *
 * `currentTarget` is the user's present daily target. Until there is enough
 * data the result is `need_data`; with some data the estimate is blended with
 * the burn the current target implies, leaning more on the data as it grows.
 */
export const adaptiveTarget = (input: {
  weighIns: WeighIn[];
  intake: DayIntake[];
  today: string;
  goal: Goal;
  currentTarget: number;
}): AdaptiveResult => {
  const today = isDate(input.today) ? toDayNum(input.today) : toDayNum(localDate(new Date()));
  const from = today - WINDOW_DAYS;
  const inWindow = (d: string) => { const n = toDayNum(d); return n > from && n <= today; };

  const weighs = cleanWeighIns(input.weighIns).filter((w) => inWindow(w.date));
  // Today is usually still being logged, so it never counts.
  const days = (input.intake || []).filter((d) => isDate(d.date) && inWindow(d.date) && toDayNum(d.date) < today
    && Number.isFinite(d.kcal) && d.kcal >= PARTIAL_DAY_KCAL && d.kcal <= 10_000);
  const spanDays = weighs.length >= 2 ? toDayNum(weighs[weighs.length - 1].date) - toDayNum(weighs[0].date) : 0;

  if (days.length < MIN_LOGGED_DAYS || weighs.length < MIN_WEIGH_INS || spanDays < MIN_SPAN_DAYS) {
    const needs: string[] = [];
    if (days.length < MIN_LOGGED_DAYS) needs.push(`${MIN_LOGGED_DAYS - days.length} more fully logged day${MIN_LOGGED_DAYS - days.length === 1 ? '' : 's'}`);
    if (weighs.length < MIN_WEIGH_INS) needs.push(`${MIN_WEIGH_INS - weighs.length} more weigh-in${MIN_WEIGH_INS - weighs.length === 1 ? '' : 's'}`);
    else if (spanDays < MIN_SPAN_DAYS) needs.push(`weigh-ins spread over ${MIN_SPAN_DAYS} days (now ${spanDays})`);
    return {
      status: 'need_data',
      loggedDays: days.length,
      weighIns: weighs.length,
      spanDays,
      message: `Your smart target needs ${needs.join(' and ')}.`,
    };
  }

  // Rate of change: a least-squares line through the window's weigh-ins. The
  // smoothed trend is right for the chart but lags ~10 days, which made the
  // first version read a 0.45 kg/week loss as 0.31 and the burn 170 kcal low.
  const xs = weighs.map((w) => toDayNum(w.date));
  const ys = weighs.map((w) => w.kg);
  const mx = xs.reduce((s, x) => s + x, 0) / xs.length;
  const my = ys.reduce((s, y) => s + y, 0) / ys.length;
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  const slopePerDay = den > 0 ? num / den : 0;
  // Fitted weight at the latest weigh-in, for the goal offset.
  const t1 = my + slopePerDay * (xs[xs.length - 1] - mx);
  // How unsure the slope is (its standard error), in kcal a day. Daily water
  // swings make a truly steady person's estimate wobble by ~100 kcal; a change
  // smaller than this is noise, so it is not suggested.
  let rss = 0;
  for (let i = 0; i < xs.length; i++) rss += (ys[i] - (my + slopePerDay * (xs[i] - mx))) ** 2;
  const slopeSe = den > 0 && xs.length > 2 ? Math.sqrt(rss / (xs.length - 2) / den) : 0;
  const noiseKcal = slopeSe * KCAL_PER_KG;

  const avgIntake = days.reduce((s, d) => s + d.kcal, 0) / days.length;
  const measured = avgIntake - slopePerDay * KCAL_PER_KG;

  const trendNow = t1;
  const offset = goalOffset(input.goal, trendNow);
  const current = Number.isFinite(input.currentTarget) && input.currentTarget > 0 ? input.currentTarget : 2000;
  const prior = current - offset; // the burn the current target assumes

  const confidence = Math.min(1, days.length / 21) * Math.min(1, weighs.length / 6);
  const burnRaw = prior + confidence * (measured - prior);
  const burn = Math.round(Math.min(5000, Math.max(1200, burnRaw)));

  const ideal = Math.max(MIN_TARGET, burn + offset);
  const deadBand = Math.max(75, 2.5 * noiseKcal);
  const wanted = Math.abs(ideal - current) < deadBand ? current : ideal;
  const stepped = Math.min(current + MAX_STEP, Math.max(current - MAX_STEP, wanted));
  const target = Math.max(MIN_TARGET, round10(stepped));
  const change = target - round10(current);
  const kgPerWeek = Math.round(slopePerDay * 7 * 100) / 100;

  const message = adaptiveMessage({ kgPerWeek, avgIntake, burn, target, change });

  return { status: 'ready', burn, target, change, kgPerWeek, avgIntake: Math.round(avgIntake), loggedDays: days.length, weighIns: weighs.length, confidence: Math.round(confidence * 100) / 100, message };
};

/**
 * The plain-language line for a ready result. The maths is metric (kg, kcal);
 * a screen passes formatters so the person reads it in their own units
 * (src/lib/units.ts). With no formatters it is the kg / kcal sentence.
 */
export const adaptiveMessage = (
  r: { kgPerWeek: number; avgIntake: number; burn: number; target: number; change: number },
  fmt: {
    /** A body-weight change, unsigned, with unit: "0.5 kg" | "1.1 lb". */
    weightChange?: (kg: number) => string;
    /** Energy with unit: "1,800 kcal" | "7,531 kJ". */
    energy?: (kcal: number) => string;
    /** Energy as a bare number in the same unit: "2,350". */
    energyNumber?: (kcal: number) => string;
  } = {},
): string => {
  const change = fmt.weightChange ?? ((kg: number) => `${Math.abs(kg).toFixed(1)} kg`);
  const energy = fmt.energy ?? ((kcal: number) => `${Math.round(kcal)} kcal`);
  const bare = fmt.energyNumber ?? ((kcal: number) => String(kcal));
  const dir = r.kgPerWeek < -0.05 ? `losing ${change(r.kgPerWeek)} a week` : r.kgPerWeek > 0.05 ? `gaining ${change(r.kgPerWeek)} a week` : 'holding steady';
  return Math.abs(r.change) < 50
    ? `You're ${dir} on about ${energy(r.avgIntake)}. Your target is right; keep it.`
    : `You're ${dir} on about ${energy(r.avgIntake)}, so your real burn is about ${bare(r.burn)}. ${r.change < 0 ? 'Lower' : 'Raise'} your target to ${bare(r.target)}.`;
};
