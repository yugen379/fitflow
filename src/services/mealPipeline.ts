// Meal pipeline: AI decomposition -> per-100 g lookup -> deterministic math.
//
//   1. decomposeMeal(): the model lists { ingredient, grams, confidence }.
//   2. Each ingredient is looked up: reference table -> bundled foods whose
//      serving states grams -> USDA (per 100 g) -> the model's generic density
//      (labelled "estimate") -> not found (the user types the kcal).
//   3. mealMath computes (grams / 100) * per_100g and sums only after lookup.
//
// When the AI is unavailable (or the server predates decomposeMeal) the older
// per-serving paths answer, as review rows without grams, so logging never
// stops working.

import { decomposeMeal, parseQuickAdd, analyzeMealImage } from './geminiService';
import { getFoodIndex, searchUsda, type FoodProduct } from './foodService';
import {
  sanitizeDecomposition, lookupOffline, makeLine, servingLine, sanePer100, isVagueMeal, pickUsdaHit, mealCacheKey, localDecompose,
  type ReviewLine, type Found, type DecomposedItem,
} from '../lib/mealMath';

export interface MealAnalysis {
  lines: ReviewLine[];
  obscured: boolean;
  /** true = ingredient + grams pipeline; false = an older per-serving fallback answered. */
  decomposed: boolean;
  /** Answered from this device's repeat-meal cache. */
  cached?: boolean;
  /** The AI was unavailable; the app split the meal itself (portions are typical, not seen). */
  offline?: boolean;
}

const USDA_BUDGET_MS = 5_000;

const withBudget = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

const usdaPer100 = async (name: string): Promise<Found | null> => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  const none: FoodProduct[] = [];
  const hits = await withBudget(searchUsda(name, { generic: true }).catch(() => none), USDA_BUDGET_MS, none);
  const hit = pickUsdaHit(name, hits);
  const per100 = hit ? sanePer100({ kcal: hit.calories, protein: hit.protein, carbs: hit.carbs, fats: hit.fats }) : null;
  return hit && per100 ? { per100, matched: hit.name, source: 'usda' } : null;
};

/** Look one ingredient up and build its review row. */
export const resolveItem = async (item: DecomposedItem): Promise<ReviewLine> => {
  const bundled = await getFoodIndex().catch(() => null);
  const offline = lookupOffline(item.name, bundled);
  if (offline) return makeLine(item, offline);
  const usda = await usdaPer100(item.name);
  return makeLine(item, usda);
};

const resolveAll = async (raw: { items: any[]; obscured: boolean }): Promise<MealAnalysis> => {
  const d = sanitizeDecomposition(raw);
  const lines = await Promise.all(d.items.map(resolveItem));
  return { lines, obscured: d.obscured, decomposed: true };
};

// ---- Repeat meals answer instantly -------------------------------------------
// People eat the same things again and again. A description that was already
// broken down (and looked up) is kept on the device for 14 days, so typing
// "nasi lemak with fried chicken" a second time shows the review at once
// instead of waiting on the AI. Only full itemised answers are kept.
const CACHE_KEY = 'ff_meal_cache_v1';
const CACHE_TTL_MS = 14 * 86_400_000;
const CACHE_MAX = 60;
type CacheEntry = { at: number; lines: ReviewLine[] };

const readCache = (): Record<string, CacheEntry> => {
  try {
    if (typeof localStorage === 'undefined') return {};
    const v = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
};
const writeCache = (c: Record<string, CacheEntry>) => {
  try {
    if (typeof localStorage === 'undefined') return;
    const keep = Object.entries(c).filter(([, e]) => e && Date.now() - e.at < CACHE_TTL_MS)
      .sort((a, b) => b[1].at - a[1].at).slice(0, CACHE_MAX);
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch { /* storage full or blocked: the cache is only a speed-up */ }
};
export const cachedMeal = (text: string, hint?: string): ReviewLine[] | null => {
  const k = mealCacheKey(text, hint);
  const e = k ? readCache()[k] : undefined;
  return e && Date.now() - e.at < CACHE_TTL_MS && Array.isArray(e.lines) && e.lines.length ? e.lines : null;
};
const rememberMeal = (text: string, hint: string | undefined, lines: ReviewLine[]) => {
  const k = mealCacheKey(text, hint);
  if (!k || !lines.length) return;
  const c = readCache();
  c[k] = { at: Date.now(), lines };
  writeCache(c);
};

/** A typed meal ("nasi lemak with fried chicken"). */
export const analyzeMealText = async (text: string, hint?: string): Promise<MealAnalysis> => {
  const hit = cachedMeal(text, hint);
  if (hit) return { lines: hit.map((l) => ({ ...l })), obscured: false, decomposed: true, cached: true };
  const t0 = Date.now();
  const raw = await decomposeMeal({ text, hint });
  // A quick null is an older server (unknown action) or a network blip; a slow
  // one means the AI was already tried and failed.
  const timedOut = () => Date.now() - t0 > 2_500;
  // A description that names no food ("a plate of leftovers") always asks for
  // a hint first, whatever the model guessed.
  if (raw && raw.items.length) {
    const a = await resolveAll(raw);
    if (hint === undefined && isVagueMeal(text)) return { ...a, obscured: true };
    // Only answers the user would not be asked about again are kept.
    if (!a.obscured && a.lines.every((l) => l.source !== 'none')) rememberMeal(text, hint, a.lines);
    return a;
  }
  if (raw && raw.obscured && hint === undefined) return { lines: [], obscured: true, decomposed: true };
  // The AI is unavailable (quota, outage, timeout) or found nothing: split the
  // meal here. Every named part becomes a gram row; unknown foods still get a
  // row ("not found", the user types the kcal) instead of vanishing.
  const local = localDecompose(hint ? `${text}, ${hint}` : text);
  if (local.length) {
    const lines = await Promise.all(local.map(resolveItem));
    if (lines.some((l) => l.per100)) return { lines, obscured: false, decomposed: true, offline: true };
  }
  // Nothing recognisable at all: the older per-serving parser, AI only when
  // the server answered null quickly (it never tried).
  const r = await parseQuickAdd(text, { ai: raw === null && !timedOut() }).catch(() => null);
  return { lines: (r?.items || []).map((i) => servingLine(i, 0.7)), obscured: false, decomposed: false };
};

/** A meal photo. */
export const analyzeMealPhoto = async (base64Image: string, mimeType: string, hint?: string): Promise<MealAnalysis> => {
  const raw = await decomposeMeal({ base64Image, mimeType, hint });
  if (raw && raw.items.length) return resolveAll(raw);
  if (raw && raw.obscured && hint === undefined) return { lines: [], obscured: true, decomposed: true };
  // Older path: one whole-dish estimate, still shown for review, never auto-logged.
  const r: any = await analyzeMealImage(base64Image, mimeType).catch(() => null);
  return {
    lines: r && r.calories > 0 ? [servingLine({ name: r.name || 'Meal', calories: r.calories, protein: r.protein || 0, carbs: r.carbs || 0, fats: r.fats || 0 }, 0.5)] : [],
    obscured: false,
    decomposed: false,
  };
};

/** "Add item" in the review list: one typed ingredient, optionally with grams ("rice 200g"). */
export const analyzeSingleItem = async (text: string): Promise<ReviewLine | null> => {
  const m = /(\d+(?:\.\d+)?)\s*(g|gm|grams?|ml)\b/i.exec(text);
  const name = text.replace(/(\d+(?:\.\d+)?)\s*(g|gm|grams?|ml)\b/i, ' ').replace(/\s+/g, ' ').trim();
  if (name.length < 2) return null;
  if (m) {
    const grams = Math.min(2000, Math.max(1, Math.round(Number(m[1]))));
    const line = await resolveItem({ name, grams, confidence: 0.9, method: 'raw', per100Hint: null });
    if (line.per100) return line;
  }
  const r = await analyzeMealText(text);
  return r.lines[0] ?? null;
};
