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
  sanitizeDecomposition, lookupOffline, makeLine, servingLine, sanePer100, isVagueMeal,
  type ReviewLine, type Found, type DecomposedItem,
} from '../lib/mealMath';

export interface MealAnalysis {
  lines: ReviewLine[];
  obscured: boolean;
  /** true = ingredient + grams pipeline; false = an older per-serving fallback answered. */
  decomposed: boolean;
}

const USDA_BUDGET_MS = 3_000;

const withBudget = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

const usdaPer100 = async (name: string): Promise<Found | null> => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  const key = name.toLowerCase().split(/\s+/).find((w) => w.length > 2) || name.toLowerCase();
  const none: FoodProduct[] = [];
  const hits = await withBudget(searchUsda(name).catch(() => none), USDA_BUDGET_MS, none);
  // FDC's first hit can be a different food sharing one word; require the main word.
  const hit = hits.find((h) => h.calories > 0 && h.name.toLowerCase().includes(key));
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

/** A typed meal ("nasi lemak with fried chicken"). */
export const analyzeMealText = async (text: string, hint?: string): Promise<MealAnalysis> => {
  const t0 = Date.now();
  const raw = await decomposeMeal({ text, hint });
  // A quick null is an older server (unknown action) or a network blip; a slow
  // one means the AI was already tried and failed.
  const timedOut = () => Date.now() - t0 > 2_500;
  // A description that names no food ("a plate of leftovers") always asks for
  // a hint first, whatever the model guessed.
  if (raw && raw.items.length) {
    const a = await resolveAll(raw);
    return hint === undefined && isVagueMeal(text) ? { ...a, obscured: true } : a;
  }
  if (raw && raw.obscured && hint === undefined) return { lines: [], obscured: true, decomposed: true };
  // Older path: per-serving items from the quick-add parser. When the server
  // answered (just found nothing) or timed out, its AI is not asked again —
  // the offline resolver answers at once. A server that predates decomposeMeal
  // returns null fast, and the old AI parse still runs.
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
