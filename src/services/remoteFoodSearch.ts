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
