// Meal pipeline math: pure, deterministic, no network (`npm run proof:mealmath`).
//
// The AI only says WHAT is on the plate and HOW MUCH (grams) and how sure it is.
// Every calorie and macro number is computed here, from per-100 g reference
// values: (grams / 100) * value_per_100g, then summed. The model never does
// arithmetic, so the same plate always gives the same total and the user can
// see and change every number that went into it.

import { buildFoodIndex, searchFoodIndex, type FoodIndex, type IndexedFood } from '../services/foodSearchIndex';
import { INGREDIENTS_100G } from '../data/ingredients100g';

export interface Per100 { kcal: number; protein: number; carbs: number; fats: number }
export interface Macros { calories: number; protein: number; carbs: number; fats: number }

export type CookMethod = 'raw' | 'boiled' | 'grilled' | 'fried' | 'stir_fried' | 'saucy';
const METHODS: CookMethod[] = ['raw', 'boiled', 'grilled', 'fried', 'stir_fried', 'saucy'];

export interface DecomposedItem {
  name: string;
  grams: number;
  /** 0..1 */
  confidence: number;
  method: CookMethod;
  /** The model's generic reference density. Used ONLY when no database has the food. */
  per100Hint: Per100 | null;
}

export interface Decomposition { items: DecomposedItem[]; obscured: boolean }

export type LineSource = 'table' | 'bundled' | 'usda' | 'ai_density' | 'serving' | 'none';

/**
 * One row of the review list. Grams-based rows compute from `per100`; rows
 * that came from a per-serving source (a named dish, the old parser, the shared
 * catalog) have no grams and scale `base` by `servings`.
 */
export interface ReviewLine {
  name: string;
  grams: number | null;
  per100: Per100 | null;
  base: Macros | null;
  servings: number;
  source: LineSource;
  confidence: number;
  method: CookMethod;
  /** The matched reference already includes frying fat (fried chicken, roti canai). */
  oilIncluded: boolean;
}

// --- Numbers ----------------------------------------------------------------

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const round1 = (n: number) => Math.round(n * 10) / 10;
export const MAX_ITEM_GRAMS = 2000;
export const clampGrams = (g: unknown): number => {
  const n = num(g);
  if (!(n > 0)) return 0;
  return Math.min(MAX_ITEM_GRAMS, Math.round(n));
};

/** A sane per-100 g record, or null. Energy density cannot exceed pure fat (~900). */
export const sanePer100 = (raw: any): Per100 | null => {
  if (!raw || typeof raw !== 'object') return null;
  const kcal = num(raw.kcal ?? raw.kcal_per_100g ?? raw.calories);
  if (!(kcal > 0) || kcal > 900) return null;
  const m = (v: unknown) => { const n = num(v); return n >= 0 && n <= 100 ? n : 0; };
  return { kcal, protein: m(raw.protein), carbs: m(raw.carbs), fats: m(raw.fats ?? raw.fat) };
};

/** THE calorie formula: (grams / 100) * value_per_100g. */
export const macrosForGrams = (grams: number, p: Per100): Macros => {
  const k = Math.max(0, grams) / 100;
  return {
    calories: Math.round(k * p.kcal),
    protein: round1(k * p.protein),
    carbs: round1(k * p.carbs),
    fats: round1(k * p.fats),
  };
};

const ZERO: Macros = { calories: 0, protein: 0, carbs: 0, fats: 0 };

export const lineMacros = (l: ReviewLine): Macros => {
  if (l.per100 && l.grams != null) return macrosForGrams(l.grams, l.per100);
  if (l.base) {
    const s = Math.max(0, l.servings);
    return {
      calories: Math.round(l.base.calories * s),
      protein: round1(l.base.protein * s),
      carbs: round1(l.base.carbs * s),
      fats: round1(l.base.fats * s),
    };
  }
  return ZERO;
};

/** Sum AFTER each line was computed from its own lookup. */
export const sumMacros = (list: Macros[]): Macros => {
  const t = list.reduce((a, m) => ({
    calories: a.calories + m.calories,
    protein: a.protein + m.protein,
    carbs: a.carbs + m.carbs,
    fats: a.fats + m.fats,
  }), { ...ZERO });
  return { calories: t.calories, protein: round1(t.protein), carbs: round1(t.carbs), fats: round1(t.fats) };
};

export const totalsOf = (lines: ReviewLine[]): Macros => sumMacros(lines.map(lineMacros));

// --- Sanitising the model's answer ------------------------------------------

const cleanName = (v: unknown): string => {
  if (typeof v !== 'string') return '';
  return v.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
};

/** 0..1 from 0..1, 0..100, or "high/medium/low". Missing means "not sure". */
export const toConfidence = (v: unknown): number => {
  if (typeof v === 'string') {
    const s = v.toLowerCase();
    if (s.startsWith('high')) return 0.9;
    if (s.startsWith('med')) return 0.6;
    if (s.startsWith('low')) return 0.3;
  }
  let n = num(v);
  if (!Number.isFinite(n)) return 0.5;
  if (n > 1) n = n / 100;
  return Math.min(1, Math.max(0, n));
};

const toMethod = (v: unknown): CookMethod => {
  const s = typeof v === 'string' ? v.toLowerCase().replace(/[\s-]+/g, '_') : '';
  if ((METHODS as string[]).includes(s)) return s as CookMethod;
  if (/deep|fry|fried|goreng/.test(s)) return s.includes('stir') ? 'stir_fried' : 'fried';
  if (/sauce|curry|gravy|stew/.test(s)) return 'saucy';
  return 'raw';
};

const NOT_FOOD = /^(plate|bowl|cup|glass|table|spoon|fork|chopsticks|napkin|tray|unknown|food|meal)$/i;

/**
 * Whatever the model returned (array, object, junk) -> a valid Decomposition.
 * Cooking oil listed as an item is dropped: oil has its own selector.
 */
export const sanitizeDecomposition = (raw: any): Decomposition => {
  const arr: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
  const items: DecomposedItem[] = [];
  for (const r of arr.slice(0, 15)) {
    const name = cleanName(r?.ingredient_name ?? r?.name);
    if (!name || NOT_FOOD.test(name)) continue;
    if (/^(cooking |vegetable |palm |olive )?oil$/i.test(name)) continue;
    const grams = clampGrams(r?.estimated_grams ?? r?.grams);
    if (!grams) continue;
    items.push({
      name,
      grams,
      confidence: toConfidence(r?.confidence),
      method: toMethod(r?.method),
      per100Hint: sanePer100(r?.per_100g ?? r?.per100g),
    });
  }
  return { items, obscured: raw?.obscured === true };
};

// --- Lookup -----------------------------------------------------------------

let tableIndex: FoodIndex | null = null;
const getTableIndex = (): FoodIndex => {
  if (!tableIndex) tableIndex = buildFoodIndex(INGREDIENTS_100G as IndexedFood[]);
  return tableIndex;
};

// Words that describe preparation or cut, not which food it is. Dropped when
// the full name finds nothing ("grilled boneless chicken thigh" -> chicken thigh).
// "fried" is NOT here: fried chicken is a different food from chicken.
const PREP = /\b(grilled|roasted|baked|steamed|boiled|poached|sliced|diced|chopped|shredded|boneless|skinless|fresh|plain|cooked|homemade|small|medium|large|piece|pieces|of|portion)\b/g;

const toPer100 = (f: { calories: number; protein: number; carbs: number; fats: number }): Per100 =>
  ({ kcal: f.calories, protein: f.protein, carbs: f.carbs, fats: f.fats });

/**
 * Loose: all query words matched (search adds 20 only then) and at least one
 * exactly. Exact: the query IS a name or alias (search adds 90+ only then) —
 * required for the shortened fallbacks, so "chili sauce" can never become
 * "Soy sauce" just by sharing the word "sauce".
 */
const strongHit = (index: FoodIndex, q: string, exact: boolean): IndexedFood | null => {
  const words = q.trim().split(/\s+/).filter(Boolean).length;
  const top = searchFoodIndex(index, q, 1)[0];
  if (!top) return null;
  const floor = exact ? 90 + 20 + 10 * words - 3 : 20 + 4 * words + 6;
  return top.score >= floor ? top.food : null;
};

/**
 * Candidate phrasings, most specific first. The name as given and the name
 * without prep words match loosely; the shortened tails must match exactly.
 */
export const nameVariants = (name: string): { q: string; exact: boolean }[] => {
  const base = name.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  const noPrep = base.replace(PREP, ' ').replace(/\s+/g, ' ').trim();
  const words = noPrep.split(' ').filter(Boolean);
  const out: { q: string; exact: boolean }[] = [{ q: base, exact: false }, { q: noPrep, exact: false }];
  // A tail is only tried when every word it drops is a describing word, not a
  // food: "spicy curry gravy" may become "curry gravy", but "chicken curry"
  // must never become "curry" (gravy alone) by dropping the chicken.
  const droppable = (dropped: string[]) => dropped.every((w) => !strongHit(getTableIndex(), w, true));
  if (words.length > 2 && droppable(words.slice(0, -2))) out.push({ q: words.slice(-2).join(' '), exact: true });
  if (words.length > 1 && droppable(words.slice(0, -1))) out.push({ q: words[words.length - 1], exact: true });
  const seen = new Set<string>();
  return out.filter((v) => v.q.length >= 2 && !seen.has(v.q) && !!seen.add(v.q));
};

export interface Found { per100: Per100; matched: string; source: LineSource }

const fromTable = (q: string, exact: boolean): Found | null => {
  const hit = strongHit(getTableIndex(), q, exact);
  return hit ? { per100: toPer100(hit), matched: hit.name, source: 'table' } : null;
};

/** Grams in a serving text: "100g cooked", "(325ml can)", "170 g cup". */
export const servingGrams = (text: string | undefined): number | null => {
  const m = /(\d+(?:\.\d+)?)\s*(g|gm|gram|grams|ml)\b/i.exec(text || '');
  if (!m) return null;
  const g = Number(m[1]);
  return g > 0 && g <= 2000 ? g : null;
};

/** A bundled per-serving food becomes per-100 g only when its serving states grams. */
export const per100FromServingFood = (food: IndexedFood): Per100 | null => {
  const g = servingGrams(food.serving) ?? servingGrams(food.name);
  if (!g || !(food.calories > 0)) return null;
  const k = 100 / g;
  return sanePer100({ kcal: food.calories * k, protein: food.protein * k, carbs: food.carbs * k, fats: food.fats * k });
};

const fromBundled = (index: FoodIndex | null, q: string, exact: boolean): Found | null => {
  if (!index) return null;
  const hit = strongHit(index, q, exact);
  const p = hit ? per100FromServingFood(hit) : null;
  return p && hit ? { per100: p, matched: hit.name, source: 'bundled' } : null;
};

/**
 * Offline lookup, most specific phrasing first; for each phrasing the
 * reference table, then the bundled list. The first two phrasings (as given,
 * and without prep words) match loosely; shorter fallbacks must match a name
 * or alias exactly. USDA and the model's own density are the caller's later
 * steps (network / last resort).
 */
export const lookupOffline = (name: string, bundled: FoodIndex | null = null): Found | null => {
  for (const { q, exact } of nameVariants(name)) {
    const hit = fromTable(q, exact) || fromBundled(bundled, q, exact);
    if (hit) return hit;
  }
  return null;
};

// References that already contain their frying or cooking fat; adding the
// oil selector's grams on top would count the fat twice.
const OIL_INCLUDED = /fried|goreng|fries|roti canai|prata|paratha|chapati|naan|rendang|sambal|curry|laksa|omelette|scrambled|instant|peanut sauce|coconut rice|nasi lemak|mayonnaise|oil|butter|ghee|margarine|cookies|chocolate|crackers/i;
export const includesOil = (name: string): boolean => OIL_INCLUDED.test(name);

/** A review line from a decomposed item and whatever lookup found. */
export const makeLine = (item: DecomposedItem, found: Found | null): ReviewLine => {
  const per100 = found?.per100 ?? item.per100Hint ?? null;
  const source: LineSource = found ? found.source : item.per100Hint ? 'ai_density' : 'none';
  return {
    name: item.name,
    grams: item.grams,
    per100,
    base: null,
    servings: 1,
    source,
    confidence: item.confidence,
    method: item.method,
    oilIncluded: includesOil(item.name) || includesOil(found?.matched || ''),
  };
};

/** A row from a per-serving source (named dish, old parser, catalog, photo fallback). */
export const servingLine = (m: { name: string } & Macros, confidence = 0.8): ReviewLine => ({
  name: m.name,
  grams: null,
  per100: null,
  base: { calories: Math.max(0, Math.round(m.calories)), protein: Math.max(0, m.protein), carbs: Math.max(0, m.carbs), fats: Math.max(0, m.fats) },
  servings: 1,
  source: 'serving',
  confidence,
  method: 'raw',
  oilIncluded: includesOil(m.name),
});

// --- Stage 2: cooking fat ---------------------------------------------------

export type OilLevel = 'none' | 'light' | 'heavy';
export const OIL_PER_100: Per100 = { kcal: 884, protein: 0, carbs: 0, fats: 100 };
/** Oil as a share of the cooked food it went into. light ~ 1 tsp per 200 g, heavy ~ 1 tbsp. */
export const OIL_SHARE: Record<OilLevel, number> = { none: 0, light: 0.025, heavy: 0.075 };
const OIL_MIN_G: Record<OilLevel, number> = { none: 0, light: 3, heavy: 8 };
export const OIL_MAX_G = 60;
const OILY: CookMethod[] = ['fried', 'stir_fried', 'saucy'];

/** Grams of cooked food that oil could have gone into (references with fat built in are excluded). */
export const oilBaseGrams = (lines: ReviewLine[]): number =>
  lines.reduce((a, l) => a + (OILY.includes(l.method) && !l.oilIncluded && l.grams ? l.grams : 0), 0);

export const oilGrams = (level: OilLevel, baseGrams: number): number => {
  if (level === 'none' || !(baseGrams > 0)) return 0;
  return Math.min(OIL_MAX_G, Math.max(OIL_MIN_G[level], Math.round(baseGrams * OIL_SHARE[level])));
};

export const oilMacros = (level: OilLevel, baseGrams: number): Macros =>
  macrosForGrams(oilGrams(level, baseGrams), OIL_PER_100);

/** Offer the selector only when something was cooked in fat we have not counted. */
export const needsOilChoice = (lines: ReviewLine[]): boolean => oilBaseGrams(lines) > 0;

/**
 * Pre-selected level: a real portion (>= 100 g) of fried food -> heavy;
 * anything else fried, stir-fried or saucy -> light. (A 50 g fried egg is a
 * teaspoon of oil, not a tablespoon.)
 */
export const suggestedOil = (lines: ReviewLine[]): OilLevel => {
  const live = lines.filter((l) => !l.oilIncluded && l.grams);
  const friedG = live.reduce((a, l) => a + (l.method === 'fried' ? l.grams || 0 : 0), 0);
  if (friedG >= 100) return 'heavy';
  if (friedG > 0) return 'light';
  if (live.some((l) => l.method === 'stir_fried' || l.method === 'saucy')) return 'light';
  return 'none';
};

export const mealTotals = (lines: ReviewLine[], oil: OilLevel): Macros =>
  sumMacros([...lines.map(lineMacros), oilMacros(oil, oilBaseGrams(lines))]);

// --- Stage 3: low confidence -> ask for a hint --------------------------------

export const LOW_MEAL_CONFIDENCE = 0.5;
export const LOW_ITEM_CONFIDENCE = 0.35;

/** Grams-weighted confidence of the plate (a sure 300 g of rice outweighs an unsure garnish). */
export const mealConfidence = (lines: ReviewLine[]): number => {
  let w = 0, s = 0;
  for (const l of lines) { const g = l.grams ?? 100; w += g; s += g * l.confidence; }
  return w ? s / w : 0;
};

/**
 * Ask for a 2-4 word hint once per meal, and only when it would help: the model
 * said things are hidden, found nothing, or is unsure about the plate or about a
 * real part of it.
 */
export const needsHint = (lines: ReviewLine[], obscured: boolean, hintUsed: boolean): boolean => {
  if (hintUsed) return false;
  if (obscured || lines.length === 0) return true;
  if (mealConfidence(lines) < LOW_MEAL_CONFIDENCE) return true;
  return lines.some((l) => l.confidence < LOW_ITEM_CONFIDENCE && (l.grams ?? 0) >= 50);
};

/**
 * Words that describe a meal without naming any food. A description made only
 * of these ("a plate of leftovers", "my usual lunch") gives the model nothing to
 * itemise, and on the phone it invented a confident nasi lemak plate instead of
 * flagging it, so the app decides this itself rather than trusting the model.
 */
const VAGUE_WORDS = new Set((
  'a an the of some my our this that same usual usually again just ate eat had have having '
  + 'i we me plate plates bowl bowls box boxes pack packet portion portions serving servings '
  + 'leftover leftovers food foods meal meals stuff thing things something anything whatever '
  + 'breakfast brunch lunch dinner supper snack snacks tea dessert '
  + 'little bit lot lots few small big large medium full half whole '
  + 'home homemade cooked made random mixed misc yesterday today last night earlier '
  + 'takeaway takeout delivery restaurant stall canteen cafeteria office party buffet and with from at for').split(' '));

export const isVagueMeal = (text: string): boolean => {
  const words = text.toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => VAGUE_WORDS.has(w));
};

/** Trim a hint to at most 6 words / 60 chars; empty -> null. */
export const cleanHint = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const words = v.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 6);
  const s = words.join(' ').slice(0, 60).trim();
  return s ? s : null;
};

/** What gets written to the diary for one line. */
export const diaryName = (l: ReviewLine): string =>
  l.grams != null ? `${l.name} (${l.grams} g)` : l.servings !== 1 ? `${l.name} ×${l.servings}` : l.name;

/**
 * Choose the USDA hit for one ingredient. The main word must appear as a whole
 * word, plural allowed ("peas" never matches "chickpeas"; "pomegranate" does
 * match "Pomegranates, raw"). Among those, a plain food beats a processed one
 * (juice, drink, yogurt...) unless the ingredient itself names that form:
 * the phone logged a pomegranate as bottled juice before this.
 */
const PROCESSED = ['juice', 'beverage', 'beverages', 'drink', 'yogurt', 'sauce', 'syrup', 'candy', 'candies', 'cereal', 'bar', 'babyfood', 'soup', 'flavored', 'dressing', 'powder'];

export const pickUsdaHit = <T extends { name: string; calories: number }>(ingredient: string, hits: T[]): T | null => {
  const words = (s: string) => s.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  const want = words(ingredient);
  const key = [...want].reverse().find((w) => w.length > 2) || want[want.length - 1];
  if (!key) return null;
  const forms = new Set([key, `${key}s`, `${key}es`, key.replace(/(es|s)$/, '')]);
  const named = new Set(want);
  const ok = hits.filter((h) => h.calories > 0 && words(h.name).some((w) => forms.has(w)));
  const plain = ok.find((h) => !words(h.name).some((w) => PROCESSED.includes(w) && !named.has(w)));
  return plain || ok[0] || null;
};
