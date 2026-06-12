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
