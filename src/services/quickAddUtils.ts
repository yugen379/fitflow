// Quick-add — pure helpers for natural-language meal logging.
//
// No browser/Firebase imports, so the Node proof harness (`npm run proof:quickadd`)
// can import and assert these deterministically. The AI multi-item parse lives in
// geminiService.parseQuickAdd; everything structural and numeric is sanitised here
// so the result is always valid no matter what the model returns.

export type QuickAddSource = 'AI' | 'local' | 'usda' | 'catalog' | 'manual';

export interface QuickAddItem {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  source?: QuickAddSource;
}

export interface QuickAddTotals {
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
}

export interface QuickAddResult {
  items: QuickAddItem[];
  totals: QuickAddTotals;
  source: 'AI' | 'local' | 'mixed' | 'empty';
}

// Non-negative finite integer (rounds). Anything weird (NaN, Infinity, negative,
// non-number) collapses to 0 so totals can never be corrupted.
const safeNum = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
};

const safeName = (v: unknown): string => {
  if (typeof v !== 'string') return 'Food';
  const t = v.trim().replace(/\s+/g, ' ').slice(0, 100);
  return t.length > 0 ? t : 'Food';
};

/**
 * Split a free-text meal ("2 eggs, toast and a banana") into individual food
 * phrases. Splits on commas, semicolons, +, &, "and", "plus", and newlines — but
 * deliberately NOT on "with", so curated entries like "oatmeal with banana" still
 * match. Trims, drops empties, dedupes, and caps at 12 phrases.
 */
export const splitPhrases = (text: string): string[] => {
  if (!text || typeof text !== 'string') return [];
  const parts = text
    .toLowerCase()
    .replace(/\r?\n+/g, ',')
    .split(/\s*(?:,|;|\+|&|\band\b|\bplus\b)\s*/g)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    if (out.length >= 12) break;
  }
  return out;
};

// Coerce any raw item (from AI / DB / manual) into a valid QuickAddItem.
export const normalizeItem = (raw: any): QuickAddItem => ({
  name: safeName(raw?.name),
  calories: safeNum(raw?.calories),
  protein: safeNum(raw?.protein),
  carbs: safeNum(raw?.carbs),
  fats: safeNum(raw?.fats),
  source: raw?.source,
});

export const computeTotals = (items: QuickAddItem[]): QuickAddTotals => {
  const list = Array.isArray(items) ? items : [];
  return {
    calories: list.reduce((a, i) => a + safeNum(i?.calories), 0),
    protein: list.reduce((a, i) => a + safeNum(i?.protein), 0),
    carbs: list.reduce((a, i) => a + safeNum(i?.carbs), 0),
    fats: list.reduce((a, i) => a + safeNum(i?.fats), 0),
  };
};

/**
 * Build the final result from raw items. Normalises every item, drops zero-calorie
 * entries (failed lookups), computes totals, and derives the source label. Always
 * returns a structurally valid QuickAddResult.
 */
export const buildResult = (
  rawItems: any[],
  declaredSource?: 'AI' | 'local' | 'mixed',
): QuickAddResult => {
  const items = (Array.isArray(rawItems) ? rawItems : [])
    .map(normalizeItem)
    .filter((i) => i.calories > 0);

  if (items.length === 0) {
    return { items: [], totals: { calories: 0, protein: 0, carbs: 0, fats: 0 }, source: 'empty' };
  }

  let source: QuickAddResult['source'];
  if (declaredSource) {
    source = declaredSource;
  } else {
    const sources = new Set(items.map((i) => i.source));
    source = sources.size === 1 && sources.has('AI') ? 'AI'
      : sources.size === 1 && sources.has('local') ? 'local'
        : 'mixed';
  }

  return { items, totals: computeTotals(items), source };
};
