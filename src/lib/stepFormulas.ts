/**
 * The step maths, in one place.
 *
 * Distance and calories were previously computed in two files with two
 * different constants (`pedometer.ts` used a 0.78 m stride, `healthService.ts`
 * used 0.73 m, and the calorie estimate was a bare `steps * 0.04` in both).
 * That is how a user ends up seeing two different distances for the same walk
 * on two different screens. Everything now derives from here.
 *
 * Both formulas are ESTIMATES from a step count. They are stated in full in the
 * UI (see `/steps`, "How these numbers are worked out") because a fitness app
 * that presents a modelled number as a measured one is lying to its user.
 *
 * ## DISTANCE
 *
 *     stride_m     = heightCm * 0.414 / 100          (when height is known)
 *     distance_km  = steps * stride_m / 1000
 *
 * The 0.414 coefficient is the standard walking-stride-to-height ratio used in
 * gait research. With no height on the profile this falls back to
 * DEFAULT_STRIDE_M (0.78 m), the population-average adult walking stride the
 * app already shipped with.
 *
 * Assumptions, and where they break: level ground and a steady walking gait.
 * Running lengthens the stride (this under-reads); stairs or shuffling shorten
 * it (this over-reads). It is not GPS. When Health Connect reports a distance
 * that a phone or watch actually measured, that number wins over this one.
 *
 * ## CALORIES
 *
 * Derived from the standard MET equation rather than invented:
 *
 *     kcal_per_min  = MET * 3.5 * weightKg / 200
 *     kcal_per_step = kcal_per_min / cadence_spm
 *
 * With WALKING_MET = 3.5 (Ainsworth Compendium, "walking, level, moderate
 * pace") and WALKING_CADENCE_SPM = 110 steps/min, a 70 kg adult works out at:
 *
 *     3.5 * 3.5 * 70 / 200 / 110 = 0.0390 kcal/step
 *
 * which is where KCAL_PER_STEP = 0.04 comes from: that figure rounded, not a
 * guess. Weight is then applied linearly, because weight enters the MET
 * equation linearly:
 *
 *     kcal_per_step = 0.04 * (weightKg / 70)
 *
 * Assumptions, and where they break: this models ACTIVE calories for walking
 * only, so it excludes BMR. It is "calories burned walking today", not
 * "calories burned today". It assumes a moderate pace, so running the same step
 * count burns more than this reports. Bodyweight is the only personalisation;
 * body composition, incline and fitness level are not modelled.
 */

/** Walking stride as a fraction of standing height: standard gait-research ratio. */
export const STRIDE_TO_HEIGHT_RATIO = 0.414;

/** Fallback stride in metres when the profile carries no height. */
export const DEFAULT_STRIDE_M = 0.78;

/**
 * Kilometres per step at the default stride. Kept as a named export because
 * achievements and older call sites already reason in "km per step".
 */
export const KM_PER_STEP = DEFAULT_STRIDE_M / 1000;

/** Metabolic equivalent for level walking at a moderate pace. */
export const WALKING_MET = 3.5;

/** Assumed cadence, steps per minute, for turning a step count into minutes. */
export const WALKING_CADENCE_SPM = 110;

/** The bodyweight the default rate is quoted for. */
export const REFERENCE_WEIGHT_KG = 70;

/** Active kcal per step for a REFERENCE_WEIGHT_KG adult (the MET figure, rounded). */
export const KCAL_PER_STEP = 0.04;

/** Heights outside this range are data-entry errors, not people. */
const MIN_HEIGHT_CM = 100;
const MAX_HEIGHT_CM = 250;

/** Likewise for bodyweight, in kilograms. */
const MIN_WEIGHT_KG = 25;
const MAX_WEIGHT_KG = 300;

/** A profile number is only usable if it is finite and physically plausible. */
const usable = (value: unknown, min: number, max: number): number | null => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
};

/**
 * The most steps a human can plausibly take in one day.
 *
 * The 24-hour treadmill world record is a shade over 250 k; ~200 k is already
 * far beyond anything a real user will produce, so a day above this is a
 * corrupt reading, not an athlete. Matches the clamp in the native
 * StepStore.applyRawReading so both sides agree on what "impossible" means.
 */
export const MAX_PLAUSIBLE_DAILY_STEPS = 200_000;

/**
 * Steps that are not a real, non-negative count contribute nothing.
 *
 * The upper clamp matters as much as the lower one: a cumulative counter
 * adopted without a baseline produces six-figure days, and every derived
 * number inherits it — 701,754 steps rendered as 511 km walked and 36,090 kcal
 * burned. Clamping here keeps one bad reading from poisoning the whole card.
 */
const usableSteps = (steps: unknown): number => {
  const n = Number(steps);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, MAX_PLAUSIBLE_DAILY_STEPS);
};

/**
 * True when a step total is a physically plausible single day.
 *
 * Deliberately strict about the TYPE, not just the range: `Number(null)` is 0,
 * so a coercing check would wave `null` through as a valid zero-step day. This
 * guards a persistence path, where "absent" and "zero" must not be confused.
 */
export const isPlausibleDailySteps = (steps: unknown): boolean =>
  typeof steps === 'number' &&
  Number.isFinite(steps) &&
  steps >= 0 &&
  steps <= MAX_PLAUSIBLE_DAILY_STEPS;

/**
 * Walking stride in metres: height-derived when the profile has a usable
 * height, otherwise the population-average default.
 */
export const strideMetresFor = (heightCm?: number | null): number => {
  const h = usable(heightCm, MIN_HEIGHT_CM, MAX_HEIGHT_CM);
  return h === null ? DEFAULT_STRIDE_M : (h * STRIDE_TO_HEIGHT_RATIO) / 100;
};

/**
 * Active kilocalories per step. Scales linearly with bodyweight because weight
 * enters the MET equation linearly; falls back to the 70 kg reference rate.
 */
export const kcalPerStepFor = (weightKg?: number | null): number => {
  const w = usable(weightKg, MIN_WEIGHT_KG, MAX_WEIGHT_KG);
  if (w === null) return KCAL_PER_STEP;
  return KCAL_PER_STEP * (w / REFERENCE_WEIGHT_KG);
};

/** Kilometres covered by `steps`, personalised by height when available. */
export const distanceKmFor = (steps: number, heightCm?: number | null): number =>
  (usableSteps(steps) * strideMetresFor(heightCm)) / 1000;

/** Active kilocalories burned by `steps`, personalised by weight when available. */
export const caloriesFor = (steps: number, weightKg?: number | null): number =>
  usableSteps(steps) * kcalPerStepFor(weightKg);

/** Km/h implied by a cadence, at this user's stride. */
export const speedKmhFor = (cadenceSpm: number, heightCm?: number | null): number => {
  const c = Number(cadenceSpm);
  if (!Number.isFinite(c) || c <= 0) return 0;
  return (c * strideMetresFor(heightCm) * 60) / 1000;
};

export const kmToMiles = (km: number): number => (Number.isFinite(km) ? km * 0.621371 : 0);

/** The user's body data, as far as these formulas care about it. */
export interface StepBody {
  weightKg?: number | null;
  heightCm?: number | null;
}

/**
 * A human-readable statement of exactly what was computed, for the disclosure
 * panel in the UI. Built here so the explanation can never drift from the code
 * that produced the number: both read the same constants.
 */
export interface FormulaExplanation {
  label: string;
  formula: string;
  substituted: string;
  assumption: string;
  /** True when the user's own body data was used rather than a default. */
  personalised: boolean;
}

export const explainDistance = (steps: number, body: StepBody = {}): FormulaExplanation => {
  const height = usable(body.heightCm, MIN_HEIGHT_CM, MAX_HEIGHT_CM);
  const stride = strideMetresFor(body.heightCm);
  const n = Math.round(usableSteps(steps));
  return {
    label: 'Distance',
    formula: 'distance = steps x stride,  stride = height x 0.414',
    substituted: `${n.toLocaleString()} x ${stride.toFixed(2)} m = ${distanceKmFor(steps, body.heightCm).toFixed(2)} km`,
    assumption:
      height === null
        ? `No height on your profile, so this uses the ${DEFAULT_STRIDE_M} m average adult stride. Add your height to personalise it.`
        : `Your ${height} cm height gives a ${stride.toFixed(2)} m stride. Assumes level ground at a walking gait. This is an estimate, not GPS.`,
    personalised: height !== null,
  };
};

export const explainCalories = (steps: number, body: StepBody = {}): FormulaExplanation => {
  const weight = usable(body.weightKg, MIN_WEIGHT_KG, MAX_WEIGHT_KG);
  const rate = kcalPerStepFor(body.weightKg);
  const n = Math.round(usableSteps(steps));
  return {
    label: 'Calories',
    formula: `kcal/min = MET x 3.5 x weight / 200,  at ${WALKING_MET} MET and ${WALKING_CADENCE_SPM} steps/min`,
    substituted: `${n.toLocaleString()} x ${rate.toFixed(4)} kcal = ${Math.round(caloriesFor(steps, body.weightKg))} kcal`,
    assumption:
      weight === null
        ? `No weight on your profile, so this uses the ${REFERENCE_WEIGHT_KG} kg reference rate of ${KCAL_PER_STEP} kcal/step. Add your weight to personalise it.`
        : `Your ${weight} kg gives ${rate.toFixed(4)} kcal/step. Active calories from walking only, so it excludes your resting burn.`,
    personalised: weight !== null,
  };
};
