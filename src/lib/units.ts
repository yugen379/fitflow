/**
 * Units — metric / US / UK display, kcal / kJ energy.
 *
 * THE RULE: storage is METRIC, always. Firestore, the step engine, the AI
 * prompts and every calculation work in kg, cm, km, ml, g and kcal. This file
 * only changes what a person SEES and what they may TYPE. Parsers hand back
 * canonical metric (or null); formatters take canonical metric. Nothing here
 * ever produces an imperial number for storage.
 *
 * Pure on purpose: no React, no Firebase, no imports at all. It is safe to
 * pull into any screen, the lazy chunks, and the tsx proof harness
 * (scripts/units-proof.mjs — `npm run proof:units`).
 *
 * Rounding rules (all "round half away from zero" on the DISPLAY value):
 *   weight   kg, lb      1 decimal, a trailing ".0" dropped        72.5 kg, 160 lb
 *            st          TOTAL pounds rounded to a whole lb FIRST, then split,
 *                        so 13.99 lb over a stone rolls to the next stone
 *                        (never "10 st 14 lb")                       11 st 6 lb
 *   height   cm          whole cm                                   175 cm
 *            ft/in       TOTAL inches rounded first, then split    5′ 9″ (never 5′ 12″)
 *   distance km, mi      2 decimals under 10, 1 decimal from 10     5.00 km, 13.1 mi
 *   pace     /km, /mi    total seconds rounded first, then m:ss    8:03 /mi (never 7:60)
 *   energy   kcal, kJ    whole number, thousands grouped           1,883 kJ
 *   volume   ml / L      whole ml under 1000, else L to 2 dp trimmed   250 ml, 1.5 L
 *            fl oz (US)  1 decimal, trailing ".0" dropped          8.5 fl oz
 *   Parsers return kg rounded to 0.01 and cm rounded to 0.1. That is finer than
 *   any display step (0.01 kg = 0.022 lb), so what a person types in lb or st
 *   always reads back exactly as typed.
 */

export type UnitSystem = 'metric' | 'imperial';
export type WeightUnit = 'kg' | 'lb' | 'st';
export type EnergyUnit = 'kcal' | 'kJ';

/** Stored on the user doc as `units` (see firestore.rules isValidUnits). */
export interface UnitPrefs {
  /** Height, distance, pace and volume. */
  system: UnitSystem;
  /** Body weight, chosen separately: the UK is metric but weighs people in stones. */
  weight: WeightUnit;
  energy: EnergyUnit;
}

export const UNIT_SYSTEMS: readonly UnitSystem[] = ['metric', 'imperial'];
export const WEIGHT_UNITS: readonly WeightUnit[] = ['kg', 'lb', 'st'];
export const ENERGY_UNITS: readonly EnergyUnit[] = ['kcal', 'kJ'];

// ── Exact factors (international yard and pound, 1959; thermochemical calorie)
export const KG_PER_LB = 0.45359237;
export const LB_PER_STONE = 14;
export const CM_PER_IN = 2.54;
export const IN_PER_FT = 12;
export const KM_PER_MI = 1.609344;
export const M_PER_FT = 0.3048;
/** US customary fluid ounce (128 per US gallon of 231 in³). Not the UK 28.41 ml. */
export const ML_PER_US_FL_OZ = 29.5735295625;
export const G_PER_OZ = 28.349523125;
export const KJ_PER_KCAL = 4.184;

// ── Conversions ─────────────────────────────────────────────────────────────
export const kgToLb = (kg: number) => kg / KG_PER_LB;
export const lbToKg = (lb: number) => lb * KG_PER_LB;
export const stLbToKg = (st: number, lb = 0) => lbToKg(st * LB_PER_STONE + lb);
/** Whole stones + whole pounds; total pounds rounded first (see header). */
export const kgToStLb = (kg: number): { st: number; lb: number } => {
  const total = Math.round(kgToLb(kg));
  return { st: Math.floor(total / LB_PER_STONE), lb: total % LB_PER_STONE };
};
export const cmToIn = (cm: number) => cm / CM_PER_IN;
export const inToCm = (inches: number) => inches * CM_PER_IN;
export const ftInToCm = (ft: number, inches = 0) => inToCm(ft * IN_PER_FT + inches);
/** Whole feet + whole inches; total inches rounded first. */
export const cmToFtIn = (cm: number): { ft: number; in: number } => {
  const total = Math.round(cmToIn(cm));
  return { ft: Math.floor(total / IN_PER_FT), in: total % IN_PER_FT };
};
export const kmToMi = (km: number) => km / KM_PER_MI;
export const miToKm = (mi: number) => mi * KM_PER_MI;
export const mToFt = (m: number) => m / M_PER_FT;
export const ftToM = (ft: number) => ft * M_PER_FT;
export const mlToFlOz = (ml: number) => ml / ML_PER_US_FL_OZ;
export const flOzToMl = (oz: number) => oz * ML_PER_US_FL_OZ;
export const gToOz = (g: number) => g / G_PER_OZ;
export const ozToG = (oz: number) => oz * G_PER_OZ;
export const kcalToKj = (kcal: number) => kcal * KJ_PER_KCAL;
export const kjToKcal = (kj: number) => kj / KJ_PER_KCAL;

// ── Preferences ─────────────────────────────────────────────────────────────
/** Regions that live in US customary units. Everyone else is metric. */
const IMPERIAL_REGIONS = new Set(['US', 'LR', 'MM']);
/** Regions whose food labels lead with kilojoules. */
const KJ_REGIONS = new Set(['AU', 'NZ']);

export const METRIC_DEFAULTS: UnitPrefs = { system: 'metric', weight: 'kg', energy: 'kcal' };

/** Region subtag of a BCP-47 tag ("en-US" → "US", "zh-Hant-TW" → "TW"), or ''. */
export const regionOf = (locale: string | null | undefined): string => {
  if (!locale || typeof locale !== 'string') return '';
  const parts = locale.trim().replace(/_/g, '-').split('-').slice(1);
  const r = parts.find((p) => /^[A-Za-z]{2}$/.test(p));
  return r ? r.toUpperCase() : '';
};

/**
 * First-run default from the device language. US, Liberia and Myanmar get US
 * units; everyone else metric. The UK defaults to metric kg as well; stones are
 * one tap away in Settings (the "UK" preset), because plenty of Britons weigh
 * in kg and guessing stones for them would be the worse mistake. Australia and
 * New Zealand default to kJ, as on their food labels.
 */
export const defaultUnitsForLocale = (locale: string | null | undefined): UnitPrefs => {
  const region = regionOf(locale);
  const imperial = IMPERIAL_REGIONS.has(region);
  return {
    system: imperial ? 'imperial' : 'metric',
    weight: imperial ? 'lb' : 'kg',
    energy: KJ_REGIONS.has(region) ? 'kJ' : 'kcal',
  };
};

/** Mirrors the firestore.rules check: exactly these three keys, known values. */
export const isValidUnitPrefs = (v: unknown): v is UnitPrefs => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  return keys.length === 3 &&
    keys.every((k) => k === 'system' || k === 'weight' || k === 'energy') &&
    (UNIT_SYSTEMS as readonly unknown[]).includes(o.system) &&
    (WEIGHT_UNITS as readonly unknown[]).includes(o.weight) &&
    (ENERGY_UNITS as readonly unknown[]).includes(o.energy);
};

/**
 * What the app should show: the saved prefs, key by key, falling back to the
 * legacy `weightUnit` ('kg' | 'lbs', the old Settings toggle) and then to the
 * device locale. A half-written or tampered map never breaks a screen; each
 * bad key just falls back.
 */
export const resolveUnitPrefs = (
  stored: unknown,
  legacyWeightUnit: unknown,
  locale: string | null | undefined,
): UnitPrefs => {
  const base = defaultUnitsForLocale(locale);
  if (legacyWeightUnit === 'lbs') base.weight = 'lb';
  else if (legacyWeightUnit === 'kg') base.weight = 'kg';
  const o = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  return {
    system: (UNIT_SYSTEMS as readonly unknown[]).includes(o.system) ? (o.system as UnitSystem) : base.system,
    weight: (WEIGHT_UNITS as readonly unknown[]).includes(o.weight) ? (o.weight as WeightUnit) : base.weight,
    energy: (ENERGY_UNITS as readonly unknown[]).includes(o.energy) ? (o.energy as EnergyUnit) : base.energy,
  };
};

/** The three choices Settings offers. Energy is a separate toggle. */
export type UnitPreset = 'metric' | 'us' | 'uk';
export const UNIT_PRESETS: Record<UnitPreset, Pick<UnitPrefs, 'system' | 'weight'>> = {
  metric: { system: 'metric', weight: 'kg' },
  us: { system: 'imperial', weight: 'lb' },
  uk: { system: 'metric', weight: 'st' },
};
export const presetOf = (p: UnitPrefs): UnitPreset | null =>
  (Object.keys(UNIT_PRESETS) as UnitPreset[]).find(
    (k) => UNIT_PRESETS[k].system === p.system && UNIT_PRESETS[k].weight === p.weight,
  ) ?? null;
/** The value the pre-units app versions read (Settings' old kg/lbs toggle). */
export const legacyWeightUnitFor = (p: UnitPrefs): 'kg' | 'lbs' => (p.weight === 'lb' ? 'lbs' : 'kg');

// ── Number helpers ──────────────────────────────────────────────────────────
const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
/** Round half away from zero to `dp` places (toFixed alone mis-rounds 1.005). */
const roundTo = (n: number, dp: number) => {
  const f = 10 ** dp;
  return (Math.sign(n) * Math.round(Math.abs(n) * f + Number.EPSILON * f)) / f;
};
const fixed = (n: number, dp: number, trimZeros: boolean) => {
  const s = roundTo(n, dp).toFixed(dp);
  return trimZeros && dp > 0 ? s.replace(/\.?0+$/, '') : s;
};
/** Thousands grouping with commas, independent of the device locale. */
const group = (n: number) => {
  const neg = n < 0;
  const s = String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return neg ? `-${s}` : s;
};
const DASH = '–';

// ── Formatters (input: canonical metric) ────────────────────────────────────
type WeightPrefs = Pick<UnitPrefs, 'weight'>;
type SystemPrefs = Pick<UnitPrefs, 'system'>;
type EnergyPrefs = Pick<UnitPrefs, 'energy'>;

/** Value and unit separately, for big-number cards. Stones put everything in `value`. */
export const weightParts = (kg: number | null | undefined, p: WeightPrefs): { value: string; unit: string } => {
  if (!ok(kg) || kg <= 0) return { value: DASH, unit: '' };
  if (p.weight === 'st') {
    const { st, lb } = kgToStLb(kg);
    return { value: `${st} st ${lb} lb`, unit: '' };
  }
  if (p.weight === 'lb') return { value: fixed(kgToLb(kg), 1, true), unit: 'lb' };
  return { value: fixed(kg, 1, true), unit: 'kg' };
};
/** "72.5 kg" | "159.8 lb" | "11 st 6 lb". */
export const formatWeight = (kg: number | null | undefined, p: WeightPrefs): string => {
  const { value, unit } = weightParts(kg, p);
  return unit ? `${value} ${unit}` : value;
};
/** What to pre-fill an input with, so that parseWeight reads it straight back. */
export const formatWeightInput = (kg: number | null | undefined, p: WeightPrefs): string => {
  if (!ok(kg) || kg <= 0) return '';
  if (p.weight === 'st') { const { st, lb } = kgToStLb(kg); return `${st} st ${lb}`; }
  return fixed(p.weight === 'lb' ? kgToLb(kg) : kg, 1, true);
};
export const weightUnitLabel = (p: WeightPrefs): string => (p.weight === 'st' ? 'st + lb' : p.weight);

/** "175 cm" | "5′ 9″". */
export const formatHeight = (cm: number | null | undefined, p: SystemPrefs): string => {
  if (!ok(cm) || cm <= 0) return DASH;
  if (p.system === 'imperial') { const { ft, in: i } = cmToFtIn(cm); return `${ft}′ ${i}″`; }
  return `${Math.round(cm)} cm`;
};
export const formatHeightInput = (cm: number | null | undefined, p: SystemPrefs): string => {
  if (!ok(cm) || cm <= 0) return '';
  if (p.system === 'imperial') { const { ft, in: i } = cmToFtIn(cm); return `${ft}'${i}"`; }
  return String(Math.round(cm));
};
export const heightUnitLabel = (p: SystemPrefs): string => (p.system === 'imperial' ? 'ft in' : 'cm');

/** "5.00 km" | "3.11 mi" | "13.1 mi". */
export const formatDistance = (km: number | null | undefined, p: SystemPrefs): string => {
  if (!ok(km) || km < 0) return DASH;
  const v = p.system === 'imperial' ? kmToMi(km) : km;
  return `${fixed(v, roundTo(v, 2) < 10 ? 2 : 1, false)} ${p.system === 'imperial' ? 'mi' : 'km'}`;
};

/** "5:00 /km" | "8:03 /mi". Input is seconds per KILOMETRE. */
export const formatPace = (secPerKm: number | null | undefined, p: SystemPrefs): string => {
  const unit = p.system === 'imperial' ? '/mi' : '/km';
  if (!ok(secPerKm) || secPerKm <= 0) return `${DASH}:${DASH} ${unit}`;
  const total = Math.round(p.system === 'imperial' ? secPerKm * KM_PER_MI : secPerKm);
  const m = Math.floor(total / 60), s = total % 60;
  return `${m}:${String(s).padStart(2, '0')} ${unit}`;
};

/** Energy in the chosen unit, unrounded. */
export const energyValue = (kcal: number, p: EnergyPrefs): number => (p.energy === 'kJ' ? kcalToKj(kcal) : kcal);
/** "450 kcal" | "1,883 kJ". */
export const formatEnergy = (kcal: number | null | undefined, p: EnergyPrefs): string => {
  if (!ok(kcal)) return DASH;
  return `${group(energyValue(kcal, p))} ${p.energy}`;
};

/** "250 ml" | "1.5 L" | "8.5 fl oz". */
export const formatVolume = (ml: number | null | undefined, p: SystemPrefs): string => {
  if (!ok(ml) || ml < 0) return DASH;
  if (p.system === 'imperial') return `${fixed(mlToFlOz(ml), 1, true)} fl oz`;
  const r = Math.round(ml);
  return r < 1000 ? `${r} ml` : `${fixed(ml / 1000, 2, true)} L`;
};

/** US liquid gallon in ml (exact: 231 cubic inches). */
export const ML_PER_US_GALLON = 3785.411784;
/** Big totals (weekly/monthly water goals): "20 L" | "5.3 gal". fl oz would read "676.3 fl oz". */
export const formatLargeVolume = (ml: number | null | undefined, p: SystemPrefs): string => {
  if (!ok(ml) || ml < 0) return DASH;
  if (p.system === 'imperial') return `${fixed(ml / ML_PER_US_GALLON, 1, true)} gal`;
  return `${fixed(ml / 1000, 1, true)} L`;
};

// ── Parsers (output: canonical metric, or null for junk) ────────────────────
/** Plausible human body weight. Anything outside is a typo, not a person. */
export const WEIGHT_KG_RANGE = { min: 2, max: 700 } as const;
export const HEIGHT_CM_RANGE = { min: 50, max: 272 } as const;

const NUM = '(\\d+(?:[.,]\\d+)?)';
/** "72,5" (decimal comma) reads as 72.5. Weights and heights never need a thousands separator. */
const num = (s: string) => Number(s.replace(',', '.'));
const clean = (input: unknown) =>
  typeof input === 'string'
    ? input.trim().toLowerCase()
        .replace(/[′’‘`´]/g, "'")
        .replace(/[″“”]|''/g, '"')
        .replace(/\s+/g, ' ')
    : '';

const LB_WORD = '(?:lbs?|pounds?|#)';
const ST_WORD = '(?:st|stones?)';
const KG_WORD = '(?:kgs?|kilos?|kilograms?|kilogrammes?)';

const finishKg = (kg: number): number | null =>
  ok(kg) && kg >= WEIGHT_KG_RANGE.min && kg <= WEIGHT_KG_RANGE.max ? roundTo(kg, 2) : null;

/**
 * Body weight as typed, in any unit, to kg. A bare number is read in the
 * person's own unit ("160" is 160 lb for a US user, 160 kg is then refused as
 * a typo only by range). Accepts "160", "160 lb", "160lbs", "72.5kg", "72,5 kg",
 * "11st 6", "11 st 6 lb", "11 stone", and — for stones users — "11 6".
 * Pounds inside a stone reading must be under 14.
 */
export const parseWeight = (input: unknown, p: WeightPrefs): number | null => {
  const s = clean(input);
  if (!s) return null;
  let m = s.match(new RegExp(`^${NUM} ?${ST_WORD}\\.?(?: ?${NUM} ?(?:${LB_WORD}\\.?)?)?$`));
  if (m) {
    const lb = m[2] != null ? num(m[2]) : 0;
    return lb < LB_PER_STONE ? finishKg(stLbToKg(num(m[1]), lb)) : null;
  }
  if ((m = s.match(new RegExp(`^${NUM} ?${LB_WORD}\\.?$`)))) return finishKg(lbToKg(num(m[1])));
  if ((m = s.match(new RegExp(`^${NUM} ?${KG_WORD}\\.?$`)))) return finishKg(num(m[1]));
  if ((m = s.match(new RegExp(`^${NUM}$`)))) {
    const v = num(m[1]);
    return finishKg(p.weight === 'st' ? stLbToKg(v) : p.weight === 'lb' ? lbToKg(v) : v);
  }
  if (p.weight === 'st' && (m = s.match(new RegExp(`^(\\d+) ${NUM}$`)))) {
    const lb = num(m[2]);
    return lb < LB_PER_STONE ? finishKg(stLbToKg(num(m[1]), lb)) : null;
  }
  return null;
};

const finishCm = (cm: number): number | null =>
  ok(cm) && cm >= HEIGHT_CM_RANGE.min && cm <= HEIGHT_CM_RANGE.max ? roundTo(cm, 1) : null;

/**
 * Height as typed to cm. Accepts "5'9", "5'9\"", "5′ 9″", "5 ft 9 in", "5ft9",
 * "6'", "69 in", "175", "175cm", "1.75 m", "1,75m". Inches beside feet must be
 * under 12.
 *
 * Bare numbers (no unit):
 *   metric     under 3 → metres (1.75); otherwise cm (175)
 *   imperial   a whole number up to 8 → feet ("6"); "5 9" → 5 ft 9 in;
 *              9 to 96 → inches ("69"); over 96 → cm ("175")
 *              a decimal up to 8 ("5.9") → null: it is 5′ 9″ to some people
 *              and 5.9 ft (5′ 11″) to others, so the app asks instead of guessing.
 */
export const parseHeight = (input: unknown, p: SystemPrefs): number | null => {
  const s = clean(input);
  if (!s) return null;
  let m = s.match(new RegExp(`^${NUM} ?(?:'|ft\\.?|feet|foot)(?: ?${NUM} ?(?:"|in\\.?|inch|inches)?)?$`));
  if (m) {
    const inches = m[2] != null ? num(m[2]) : 0;
    return inches < IN_PER_FT ? finishCm(ftInToCm(num(m[1]), inches)) : null;
  }
  if ((m = s.match(new RegExp(`^${NUM} ?(?:"|in\\.?|inch|inches)$`)))) return finishCm(inToCm(num(m[1])));
  if ((m = s.match(new RegExp(`^${NUM} ?(?:cm|cms|centimet(?:er|re)s?)\\.?$`)))) return finishCm(num(m[1]));
  if ((m = s.match(new RegExp(`^${NUM} ?(?:m|metres?|meters?)\\.?$`)))) return finishCm(num(m[1]) * 100);
  if ((m = s.match(new RegExp(`^${NUM}$`)))) {
    const v = num(m[1]);
    if (p.system === 'imperial') {
      if (v <= 8) return Number.isInteger(v) ? finishCm(ftInToCm(v)) : null;
      return v <= 96 ? finishCm(inToCm(v)) : finishCm(v);
    }
    return v < 3 ? finishCm(v * 100) : finishCm(v);
  }
  if (p.system === 'imperial' && (m = s.match(new RegExp(`^(\\d) ${NUM}$`)))) {
    const inches = num(m[2]);
    return inches < IN_PER_FT ? finishCm(ftInToCm(Number(m[1]), inches)) : null;
  }
  return null;
};

// ── Screen helpers: lifts, food, water, energy input, rates, parts ──────────
//
// Same rule as everything above: in = metric, out = display; the *ToKg /
// *ToG / *ToKcal readers take what a person typed in THEIR unit and hand back
// metric exactly once. Display rounding (0.5 plate steps, 1 dp oz) never
// reaches storage: a screen keeps the stored kg/g untouched until the person
// edits the field, and then stores their typed number converted once.

/** Bar and dumbbell loads: lb for pound users; kg for kg AND stone users (UK gyms load plates in kg). */
export type LoadUnit = 'kg' | 'lb';
export const loadUnit = (p: WeightPrefs): LoadUnit => (p.weight === 'lb' ? 'lb' : 'kg');
/** The +/- step a load stepper moves by: 2.5 kg or 5 lb (the smallest pair of plates). */
export const loadStep = (p: WeightPrefs): number => (loadUnit(p) === 'lb' ? 5 : 2.5);
/** Heaviest load a screen accepts, in kg (well over any human lift). */
export const LOAD_KG_MAX = 1000;

/** A stored load (kg) in the display unit, to the nearest 0.5 (the plate step). 0 for none. */
export const loadValue = (kg: number | null | undefined, p: WeightPrefs): number => {
  if (!ok(kg) || kg <= 0) return 0;
  return roundTo((loadUnit(p) === 'lb' ? kgToLb(kg) : kg) * 2, 0) / 2;
};
/** "62.5 kg" | "137.5 lb" | "0 kg" (bodyweight). */
export const formatLoad = (kg: number | null | undefined, p: WeightPrefs): string => {
  if (!ok(kg) || kg < 0) return DASH;
  return `${fixed(loadValue(kg, p), 1, true)} ${loadUnit(p)}`;
};
/** Lifted volume, sum of kg x reps, as whole display units: "12,450 kg" | "27,447 lb". */
export const formatLoadVolume = (kgReps: number | null | undefined, p: WeightPrefs): string => {
  if (!ok(kgReps) || kgReps < 0) return DASH;
  return `${group(loadUnit(p) === 'lb' ? kgToLb(kgReps) : kgReps)} ${loadUnit(p)}`;
};

/** A number, optionally followed by a unit word, as typed. */
const leadNumber = (input: unknown): { v: number; unit: string } | null => {
  if (typeof input === 'number') return ok(input) ? { v: input, unit: '' } : null;
  const s = clean(input);
  const m = s.match(new RegExp(`^${NUM} ?([a-z. ]*)$`));
  return m ? { v: num(m[1]), unit: m[2].replace(/[. ]/g, '') } : null;
};

/**
 * A load typed in the display unit, to kg (0.01), or null for junk. "135" is
 * 135 lb for a pound user; "60 kg" / "135 lb" override the unit. 0 is a valid
 * load (bodyweight work). 0.01 kg is 0.022 lb, so what was typed reads back
 * exactly at the 0.5 display step.
 */
export const loadToKg = (input: unknown, p: WeightPrefs): number | null => {
  const r = leadNumber(input);
  if (!r) return null;
  let kg: number;
  if (/^(?:kgs?|kilos?|kilograms?)$/.test(r.unit)) kg = r.v;
  else if (/^(?:lbs?|pounds?|#)$/.test(r.unit)) kg = lbToKg(r.v);
  else if (r.unit === '') kg = loadUnit(p) === 'lb' ? lbToKg(r.v) : r.v;
  else return null;
  return ok(kg) && kg >= 0 && kg <= LOAD_KG_MAX ? roundTo(kg, 2) : null;
};

/** Food portions: grams, or ounces (avoirdupois) on imperial. */
export const foodMassUnit = (p: SystemPrefs): 'g' | 'oz' => (p.system === 'imperial' ? 'oz' : 'g');
/** Stored grams in the display unit: whole g, or oz to 1 dp. */
export const foodMassValue = (g: number | null | undefined, p: SystemPrefs): number => {
  if (!ok(g) || g <= 0) return 0;
  return p.system === 'imperial' ? roundTo(gToOz(g), 1) : Math.round(g);
};
/** "150 g" | "5.3 oz". */
export const formatFoodMass = (g: number | null | undefined, p: SystemPrefs): string => {
  if (!ok(g) || g < 0) return DASH;
  return p.system === 'imperial' ? `${fixed(gToOz(g), 1, false)} oz` : `${Math.round(g)} g`;
};
/**
 * One tap of a portion's +/- button, in grams. Metric keeps the original 10 g
 * steps (25 g from 200 g). Imperial steps on a clean oz grid, 0.5 oz below
 * 7 oz and 1 oz from there, so 4.3 oz goes to 4.5, not 4.65. Never below one
 * step. Whole grams out (portions are stored as grams).
 */
export const stepFoodMass = (g: number, dir: 1 | -1, p: SystemPrefs): number => {
  const cur = ok(g) && g > 0 ? g : 0;
  if (p.system !== 'imperial') {
    const step = cur >= 200 ? 25 : 10;
    return Math.max(step, cur + dir * step);
  }
  const oz = gToOz(cur);
  const step = oz >= 7 - 1e-9 ? 1 : 0.5;
  const k = oz / step;
  const next = (dir > 0 ? Math.floor(k + 1e-6) + 1 : Math.ceil(k - 1e-6) - 1) * step;
  return Math.round(ozToG(Math.max(step, next)));
};
/** Heaviest single food portion a screen accepts, in grams. */
export const FOOD_G_MAX = 5000;
/** A portion typed in the display unit (or with "g"/"oz") to grams (0.1), or null. */
export const foodMassToG = (input: unknown, p: SystemPrefs): number | null => {
  const r = leadNumber(input);
  if (!r) return null;
  let g: number;
  if (/^(?:g|gs|grams?|gm)$/.test(r.unit)) g = r.v;
  else if (/^(?:oz|ounces?)$/.test(r.unit)) g = ozToG(r.v);
  else if (r.unit === '') g = p.system === 'imperial' ? ozToG(r.v) : r.v;
  else return null;
  return ok(g) && g > 0 && g <= FOOD_G_MAX ? roundTo(g, 1) : null;
};

/** Drinks: ml, or US fl oz on imperial. */
export const volumeUnit = (p: SystemPrefs): 'ml' | 'fl oz' => (p.system === 'imperial' ? 'fl oz' : 'ml');
/** Stored ml in the display unit: whole ml, or fl oz to 1 dp. */
export const volumeValue = (ml: number | null | undefined, p: SystemPrefs): number => {
  if (!ok(ml) || ml <= 0) return 0;
  return p.system === 'imperial' ? roundTo(mlToFlOz(ml), 1) : Math.round(ml);
};
/**
 * One-tap water amounts, as the ml that gets STORED. Imperial gets round cup
 * sizes (4, 8, 12, 16 fl oz) converted once to whole ml (water logs are whole
 * ml), so 8 fl oz is stored as 237 ml and reads back as 8 fl oz.
 */
export const WATER_PRESETS_ML: Record<UnitSystem, readonly number[]> = {
  metric: [100, 250, 500, 750],
  imperial: [4, 8, 12, 16].map((oz) => Math.round(flOzToMl(oz))),
};
export const waterPresetsMl = (p: SystemPrefs): readonly number[] => WATER_PRESETS_ML[p.system];

/** Energy as a bare grouped whole number in the chosen unit: "1,883". */
export const formatEnergyNumber = (kcal: number | null | undefined, p: EnergyPrefs): string =>
  ok(kcal) ? group(energyValue(kcal, p)) : DASH;
/** What to pre-fill an energy input with: a whole number in the chosen unit. */
export const energyInputValue = (kcal: number | null | undefined, p: EnergyPrefs): number =>
  ok(kcal) && kcal > 0 ? Math.round(energyValue(kcal, p)) : 0;
/** Energy typed in the chosen unit (or with "kcal"/"kJ") to kcal (0.1), or null. */
export const energyToKcal = (input: unknown, p: EnergyPrefs): number | null => {
  const r = leadNumber(input);
  if (!r) return null;
  let kcal: number;
  if (/^(?:kcals?|cals?|calories?)$/.test(r.unit)) kcal = r.v;
  else if (/^(?:kj|kilojoules?)$/.test(r.unit)) kcal = kjToKcal(r.v);
  else if (r.unit === '') kcal = p.energy === 'kJ' ? kjToKcal(r.v) : r.v;
  else return null;
  return ok(kcal) && kcal >= 0 ? roundTo(kcal, 1) : null;
};

/** Body-weight change unit: kg, or lb for pound AND stone users (nobody counts stones a week). */
const rateUnit = (p: WeightPrefs): 'kg' | 'lb' => (p.weight === 'kg' ? 'kg' : 'lb');
/** A body-weight change, unsigned: "0.5 kg" | "1.1 lb". */
export const formatWeightChange = (kg: number | null | undefined, p: WeightPrefs): string => {
  if (!ok(kg)) return DASH;
  const v = Math.abs(rateUnit(p) === 'lb' ? kgToLb(kg) : kg);
  return `${fixed(v, 1, false)} ${rateUnit(p)}`;
};
/** Weekly trend for a stat tile: { value: "+0.45", unit: "kg / week" } | { value: "-1.0", unit: "lb / week" }. */
export const weightRateParts = (kgPerWeek: number | null | undefined, p: WeightPrefs): { value: string; unit: string } => {
  const unit = `${rateUnit(p)} / week`;
  if (!ok(kgPerWeek)) return { value: DASH, unit };
  const lb = rateUnit(p) === 'lb';
  const v = lb ? kgToLb(kgPerWeek) : kgPerWeek;
  const s = fixed(v, lb ? 1 : 2, false);
  return { value: roundTo(v, lb ? 1 : 2) > 0 ? `+${s}` : s, unit };
};
/** Per-body-weight dose label (protein g per ...): kg, or lb for pound users. */
export const perBodyWeightUnit = (p: WeightPrefs): 'kg' | 'lb' => (p.weight === 'lb' ? 'lb' : 'kg');
/** A per-kg dose in the per-body-weight unit: 2.5 g/kg is 1.1 g/lb. */
export const perBodyWeightValue = (perKg: number, p: WeightPrefs): number =>
  roundTo(p.weight === 'lb' ? perKg * KG_PER_LB : perKg, 1);

/** Short lengths (grip width, stride): "62 cm" | "24.4 in". */
export const formatShortLength = (cm: number | null | undefined, p: SystemPrefs): string => {
  if (!ok(cm) || cm < 0) return DASH;
  return p.system === 'imperial' ? `${fixed(cmToIn(cm), 1, true)} in` : `${Math.round(cm)} cm`;
};
/** Elevation / climb in whole metres or whole feet. */
export const elevationParts = (m: number | null | undefined, p: SystemPrefs): { value: string; unit: string } => {
  const unit = p.system === 'imperial' ? 'ft' : 'm';
  if (!ok(m) || m < 0) return { value: DASH, unit };
  return { value: group(p.system === 'imperial' ? mToFt(m) : m), unit };
};

/**
 * One instruction line for an AI prompt. The DATA in a prompt stays metric
 * (kg, km, ml, g, kcal); this tells the model which units to PRESENT in.
 * Metric + kg + kcal gives the app's original line, word for word.
 * Keep in step with functions/src/unitsPrompt.ts (the server's copy, which
 * proof:units checks is identical for every combination).
 */
export const unitsPromptLine = (raw?: unknown): string => {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const imperial = o.system === 'imperial';
  const w: WeightUnit = (WEIGHT_UNITS as readonly unknown[]).includes(o.weight) ? (o.weight as WeightUnit) : imperial ? 'lb' : 'kg';
  const e: EnergyUnit = o.energy === 'kJ' ? 'kJ' : 'kcal';
  if (!imperial && w === 'kg' && e === 'kcal') {
    return 'Use METRIC units only (ml, litres, km, kg, minutes) — the app shows water in ml, never ounces or miles.';
  }
  const parts = [
    `body weight in ${w === 'st' ? 'stones and pounds' : w}`,
    `lifting loads in ${w === 'lb' ? 'lb' : 'kg'}`,
    imperial ? 'height in feet and inches' : 'height in cm',
    imperial ? 'distance in miles and pace per mile' : 'distance in km and pace per km',
    imperial ? 'water and drinks in US fl oz' : 'water and drinks in ml or litres',
    imperial ? 'food portions in oz (macros stay in grams)' : 'food portions in grams',
    `food and burned energy in ${e}`,
  ];
  return `Present every quantity in the user's units: ${parts.join(', ')}. ` +
    'Numbers given to you here are metric (kg, km, ml, g, kcal); convert them ' +
    '(1 kg = 2.2046 lb, 1 km = 0.6214 mi, 1 US fl oz = 29.57 ml, 1 oz = 28.35 g, 1 kcal = 4.184 kJ) ' +
    'and never mix unit systems in one reply.';
};

/** formatDistance split for big-number tiles: { value: "3.11", unit: "mi" }. */
export const distanceParts = (km: number | null | undefined, p: SystemPrefs): { value: string; unit: string } => {
  const s = formatDistance(km, p);
  const i = s.lastIndexOf(' ');
  return i < 0 ? { value: s, unit: p.system === 'imperial' ? 'mi' : 'km' } : { value: s.slice(0, i), unit: s.slice(i + 1) };
};
/** formatPace split: { value: "8:03", unit: "/mi" }. */
export const paceParts = (secPerKm: number | null | undefined, p: SystemPrefs): { value: string; unit: string } => {
  const s = formatPace(secPerKm, p);
  const i = s.lastIndexOf(' ');
  return { value: s.slice(0, i), unit: s.slice(i + 1) };
};
