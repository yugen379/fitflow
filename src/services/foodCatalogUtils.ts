// Shared food catalog — pure key + validation helpers.
//
// The catalog is FitFlow's compounding data moat: every food a user resolves (via
// AI, barcode, or manual entry) is written to a shared Firestore collection keyed
// by a normalised name, so the next person to log the same food gets an instant
// hit instead of another AI call. This module holds the dependency-free logic so
// the Node harness (`npm run proof:catalog`) can prove the key + validation rules.
//
// The generated key MUST match the Firestore document-id rule (^[a-zA-Z0-9_\-]+$).

export interface CatalogFood {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  brand?: string;
}

/**
 * Stable, collision-resistant document key for a food name. Lowercases, strips
 * accents and parenthetical serving suffixes ("Oatmeal (1 bowl)" → "oatmeal"),
 * and reduces to [a-z0-9-]. Returns '' for names with no usable characters — the
 * caller skips caching in that case. Deterministic and ASCII-only by construction.
 */
export const catalogKey = (name: string): string => {
  if (!name || typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')   // strip combining accents
    .replace(/\([^)]*\)/g, ' ')        // drop "(serving)" suffixes
    .replace(/[^a-z0-9]+/g, '-')       // everything else → dash
    .replace(/^-+|-+$/g, '')           // trim leading/trailing dashes
    .slice(0, 120);
};

const finiteNonNeg = (v: unknown): boolean =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * A catalog entry is only worth storing if it has a usable name, a positive
 * calorie value (zero = a failed lookup, not real data), and finite non-negative
 * macros. Guards against poisoning the shared DB with garbage.
 */
export const isValidCatalogFood = (f: any): boolean =>
  !!f &&
  typeof f.name === 'string' && f.name.trim().length > 0 && f.name.length <= 100 &&
  finiteNonNeg(f.calories) && f.calories > 0 &&
  finiteNonNeg(f.protein) && finiteNonNeg(f.carbs) && finiteNonNeg(f.fats) &&
  catalogKey(f.name).length > 0;

/**
 * Coerce a raw record into a clean CatalogFood, or null if it isn't valid enough
 * to store/return. Rounds macros and trims the name.
 */
export const normalizeCatalogFood = (raw: any): CatalogFood | null => {
  if (!raw) return null;
  const candidate: CatalogFood = {
    name: typeof raw.name === 'string' ? raw.name.trim().replace(/\s+/g, ' ').slice(0, 100) : '',
    calories: Math.round(Number(raw.calories)),
    protein: Math.round(Number(raw.protein) || 0),
    carbs: Math.round(Number(raw.carbs) || 0),
    fats: Math.round(Number(raw.fats) || 0),
    ...(typeof raw.brand === 'string' && raw.brand.trim() ? { brand: raw.brand.trim().slice(0, 80) } : {}),
  };
  return isValidCatalogFood(candidate) ? candidate : null;
};

/**
 * Shared-catalog key for a packaged product, by barcode: "barcode-<digits>".
 * Values stored under it are PER 100 g (as a nutrition label reads them), unlike
 * name keys, which hold one serving. '' for a code too short to be real.
 */
export const barcodeKey = (code: string): string => {
  const digits = String(code || '').replace(/\D/g, '');
  return digits.length >= 6 && digits.length <= 14 ? `barcode-${digits}` : '';
};

/**
 * Is a nutrition label read (per 100 g) believable enough to share with every
 * user? A misread label is worse than none: the next person trusts it.
 *  - 1..900 kcal (pure fat is ~900),
 *  - protein + carbs + fat can't weigh more than 100 g in 100 g (2 g reading slack),
 *  - the macros must explain the calories: 4P + 4C + 9F within 25% (or 25 kcal)
 *    of the stated kcal. Fibre, sugar alcohols and rounding fit inside that.
 */
export const labelPlausible = (f: { calories: number; protein: number; carbs: number; fats: number } | null | undefined): boolean => {
  if (!f) return false;
  const vals = [f.calories, f.protein, f.carbs, f.fats];
  if (!vals.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0)) return false;
  if (f.calories < 1 || f.calories > 900) return false;
  if (f.protein + f.carbs + f.fats > 102) return false;
  const atwater = f.protein * 4 + f.carbs * 4 + f.fats * 9;
  return Math.abs(atwater - f.calories) <= Math.max(25, 0.25 * f.calories);
};
