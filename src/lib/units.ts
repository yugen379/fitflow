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
