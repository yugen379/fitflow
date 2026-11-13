// Branded food search — the app side of functions/src/foodSearch.ts.
//
// Kept out of foodService.ts on purpose: that module must stay firebase-free
// (the proof harnesses import it in plain Node), and this one talks to a Cloud
// Function. Loaded on first use, so firebase/functions stays off the boot path.
//
// Never throws and never blocks logging: branded rows are an extra. Offline,
// signed out, function not deployed, Open Food Facts down — all of those are
// simply "no branded rows".

import type { FoodProduct } from './foodService';

const TIMEOUT_MS = 6000;
const remembered = new Map<string, FoodProduct[]>();

const isFood = (f: any): f is FoodProduct =>
  !!f && typeof f.name === 'string' && f.name.length > 0 &&
  [f.calories, f.protein, f.carbs, f.fats].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0) &&
  f.calories > 0;

export const searchBrandedFoods = async (query: string): Promise<FoodProduct[]> => {
  const q = query.trim().toLowerCase();
  if (q.replace(/[^a-z0-9]/g, '').length < 3) return [];
  const held = remembered.get(q);
  if (held) return held;
  try {
    const [{ app }, { getFunctions, httpsCallable }] = await Promise.all([
      import('../lib/firebase'),
      import('firebase/functions'),
    ]);
    const call = httpsCallable<{ query: string }, { foods?: unknown[] }>(getFunctions(app), 'searchFoods', { timeout: TIMEOUT_MS });
    const res = await call({ query: q });
    const foods = (Array.isArray(res.data?.foods) ? res.data.foods : [])
      .filter(isFood)
      .map((f) => ({ ...f, source: 'OFF' as const }));
    // Remember answers, not failures: a retry after a bad connection should ask again.
    if (remembered.size > 200) remembered.clear();
    remembered.set(q, foods);
    return foods;
  } catch {
    return [];
  }
};

export interface ProductServing {
  /** Grams (or millilitres) in one serving. */
  grams: number;
  /** The serving as the pack words it, e.g. "1 portion (20 g)". */
  label: string;
}

const servings = new Map<string, ProductServing | null>();

/**
 * One serving of a packaged product, by barcode, or null when the product
 * states none. The search results do not carry serving sizes; the product
 * record does, and (unlike search) it may be read straight from the app.
 * Never throws: with no answer the entry sheet simply stays on 100 g.
 */
export const fetchProductServing = async (code: string | undefined): Promise<ProductServing | null> => {
  if (!code || !/^\d{6,14}$/.test(code)) return null;
  if (servings.has(code)) return servings.get(code) ?? null;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    let body: any;
    try {
      const res = await fetch(
        `https://world.openfoodfacts.org/api/v2/product/${code}?fields=serving_size,serving_quantity`,
        { signal: ctl.signal },
      );
      if (!res.ok) return null;
      body = await res.json();
    } finally {
      clearTimeout(timer);
    }
    const serving = toServing(body?.product);
    servings.set(code, serving);
    return serving;
  } catch {
    return null; // not remembered: a bad connection should be asked again
  }
};

/** Pure: the serving a product record states, if it is a believable amount. */
export const toServing = (product: any): ProductServing | null => {
  const grams = Number(product?.serving_quantity);
  // Under 5 g is a pinch and over 1 kg is a whole tub: neither is a serving.
  if (!Number.isFinite(grams) || grams < 5 || grams > 1000) return null;
  const rounded = Math.round(grams);
  const label = String(product?.serving_size ?? '').replace(/[<>\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30);
  return { grams: rounded, label: label || `${rounded} g` };
};
