// Offline food search — pure, dependency-free, provable (`npm run proof:foodsearch`).
//
// Search used to know ~100 Western foods and matched by substring: "nasi lemak"
// found nothing, "chiken" found nothing, and any query with one local hit never
// reached the wider sources. This indexes every bundled food (the curated list
// plus scripts/data/common-foods.json), matches on names AND aliases, forgives
// typos and plurals, and ranks whole-phrase matches above partial ones.
//
// No network, no Firestore: it works on a plane and answers in a millisecond.

export interface IndexedFood {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  /** Serving the numbers are for, when the name does not already say. */
  serving?: string;
  aliases?: string[];
  brand?: string;
}

export interface FoodHit {
  food: IndexedFood;
  score: number;
}

interface Entry {
  food: IndexedFood;
  /** Normalised name and aliases, as whole phrases. */
  phrases: string[];
  /** Every distinct word across name, aliases and brand. */
  tokens: string[];
  nameTokenCount: number;
}

export interface FoodIndex {
  entries: Entry[];
  size: number;
}

// Words that describe an amount, not a food: "a bowl of oatmeal" is "oatmeal".
const FILLER = new Set([
  'a', 'an', 'the', 'some', 'of', 'with', 'and', 'my', 'in', 'on', 'for',
  'small', 'medium', 'large', 'big', 'bowl', 'cup', 'cups', 'glass', 'plate',
  'piece', 'pieces', 'pcs', 'slice', 'slices', 'serving', 'portion', 'gram',
  'grams', 'g', 'ml', 'tbsp', 'tsp', 'oz', 'one', 'two', 'three', 'half',
]);

/** Lowercase, strip accents and punctuation, collapse spaces. */
export const normalizeText = (s: string): string =>
  (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** "eggs" -> "egg", "berries" -> "berry". Deliberately tiny: typos cover the rest. */
export const stem = (t: string): string => {
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
};

const tokensOf = (s: string, dropFiller: boolean): string[] => {
  const all = normalizeText(s).split(' ').filter(Boolean);
  // A leading number is a quantity ("2 eggs"); anywhere else it is part of the
  // name ("Chicken 65", "100 Plus") and must stay.
  const kept = all.filter((t, i) => !(dropFiller && FILLER.has(t)) && !(i === 0 && /^\d+$/.test(t)));
  // "a cup of" must not become an empty query that matches nothing.
  return (kept.length ? kept : all).map(stem);
};

const phraseOf = (s: string): string => tokensOf(s, true).join(' ');

/**
 * Edit distance with adjacent transpositions, abandoned as soon as it must
 * exceed `max` (returns max + 1). "chiken" -> "chicken" is 1, "nasi lemka" -> 1.
 */
export const editDistance = (a: string, b: string, max: number): number => {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: lb + 1 }, (_, j) => j);
  for (let i = 1; i <= la; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[lb];
};

/** How many typos a word of this length is allowed. Short words get none. */
const typoBudget = (len: number): number => (len >= 7 ? 2 : len >= 4 ? 1 : 0);

export const buildFoodIndex = (foods: IndexedFood[]): FoodIndex => {
  const seen = new Set<string>();
  const entries: Entry[] = [];
  for (const food of foods) {
    if (!food || typeof food.name !== 'string' || !(food.calories > 0)) continue;
    // "Air Kelapa (coconut water)" is named Air Kelapa and also answers to
    // coconut water; "Satay Ayam (5 sticks)" is named Satay Ayam.
    // (Brackets holding a number are a serving size, not another name.)
    const inParens = [...food.name.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]).filter((s) => !/\d/.test(s));
    const namePhrase = phraseOf(food.name.replace(/\([^)]*\)/g, ' '));
    if (!namePhrase) continue;
    // Two sources may carry the same food; the first one given wins. Compared
    // on the name as written (minus the serving), not the stemmed phrase:
    // "Eggs (2 large)" and "Egg (1 large)" are different entries.
    const id = normalizeText(food.name.replace(/\([^)]*\)/g, ' ')) + '|' + normalizeText(food.brand || '');
    if (seen.has(id)) continue;
    seen.add(id);
    const phrases = [namePhrase, ...[...(food.aliases || []), ...inParens].map(phraseOf).filter(Boolean)];
    const tokens = new Set<string>();
    for (const p of phrases) for (const t of p.split(' ')) tokens.add(t);
    for (const t of tokensOf(food.brand || '', false)) tokens.add(t);
    entries.push({ food, phrases, tokens: [...tokens], nameTokenCount: namePhrase.split(' ').length });
  }
  return { entries, size: entries.length };
};

// Per query word: exact 10, the entry word starts with it 7, a typo 4.
const tokenScore = (q: string, entryTokens: string[]): number => {
  let best = 0;
  const budget = typoBudget(q.length);
  for (const t of entryTokens) {
    if (t === q) return 10;
    if (q.length >= 2 && t.startsWith(q)) { if (best < 7) best = 7; continue; }
    if (best < 4 && budget > 0 && editDistance(q, t, budget) <= budget) best = 4;
  }
  return best;
};

export const searchFoodIndex = (index: FoodIndex, query: string, limit = 8): FoodHit[] => {
  const qTokens = tokensOf(query, true);
  if (!qTokens.length || qTokens.join('').length < 2) return [];
  const qPhrase = qTokens.join(' ');
  const hits: FoodHit[] = [];

  for (const e of index.entries) {
    let matched = 0, sum = 0;
    for (const q of qTokens) {
      const s = tokenScore(q, e.tokens);
      if (s > 0) { matched++; sum += s; }
    }
    if (!matched) continue;
    // One stray word may miss ("chicken rice extra chilli"), but not most of them.
    if (matched / qTokens.length < 0.6) continue;

    let score = sum + (matched === qTokens.length ? 20 : 0);
    // The whole phrase is worth far more than its words: "rice" is White Rice,
    // not Chicken Rice; "nasi lemak" is Nasi Lemak, not Nasi Lemak with Rendang.
    //
    // Below an exact match, where the typed text sits matters more than that it
    // appears: a NAME that begins with it beats another name for the food that
    // begins with it, and both beat a name that merely contains it. The prefix
    // test has no word boundary on purpose: "roti ca" is someone halfway
    // through typing Roti Canai, and must not lose to "PappaRich Roti Canai…",
    // which contains " roti ca" in the middle (it did, once the list grew).
    if (e.phrases[0] === qPhrase) score += 100;
    else if (e.phrases.includes(qPhrase)) score += 90;
    else if (e.phrases[0].startsWith(qPhrase)) score += 40;
    else if (e.phrases.some((p) => p.startsWith(qPhrase))) score += 30;
    else if (e.phrases.some((p) => p.includes(' ' + qPhrase))) score += 15;
    // Among equals, the plainer food first.
    score -= Math.max(0, e.nameTokenCount - qTokens.length) * 1.5;
    hits.push({ food: e.food, score });
  }

  hits.sort((a, b) => b.score - a.score || a.food.name.length - b.food.name.length || a.food.name.localeCompare(b.food.name));
  return hits.slice(0, limit);
};

/**
 * The food a typed phrase NAMES, or null. Stricter than search: the phrase must
 * be a food's name or alias (typos allowed), not merely share a word with one.
 * Used to log "nasi lemak" instantly, offline, without asking the AI.
 */
export const resolveFoodPhrase = (index: FoodIndex, phrase: string): IndexedFood | null => {
  // An amount is not one food at its listed serving: "3 eggs" is not
  // "Eggs (2 large)". Those go to the parser, which understands quantities.
  if (/\d/.test(phrase) || AMOUNT.test(phrase)) return null;
  const top = searchFoodIndex(index, phrase, 1)[0];
  if (!top) return null;
  const q = phraseOf(phrase);
  // Something joined with "and" may be a list ("eggs and toast") or a name
  // ("fish and chips"). Only an exact name settles it; no typo guessing.
  const joined = /[,&+/]/.test(phrase) || JOIN.test(phrase);
  // Tighter than search even for a plain phrase: two edits turn "egg toast"
  // into "egg tart". One typo for an ordinary name, two only for a long one.
  const letters = q.replace(/ /g, '').length;
  const budget = joined ? 0 : letters >= 12 ? 2 : letters >= 6 ? 1 : 0;
  const names = index.entries.find((e) => e.food === top.food)!.phrases;
  const words = q.split(' ').length;
  return names.some((p) =>
    p === q || (budget > 0 && p.split(' ').length === words && editDistance(p, q, budget) <= budget),
  ) ? top.food : null;
};

const AMOUNT = /\b(one|two|three|four|five|six|seven|eight|nine|ten|half|quarter|double|triple|dozen|couple|few|extra|x)\b/i;
const JOIN = /\b(and|with|plus)\b/i;

/** What to show in a result row. */
export const displayName = (f: IndexedFood): string =>
  f.serving && !f.name.includes('(') ? `${f.name} (${f.serving})` : f.name;

// --- Quantities ------------------------------------------------------------
//
// The offline fallback used to log the listed serving whatever was typed: with
// the AI unavailable, "3 eggs" became "Eggs (2 large eggs)" and "200g chicken
// breast" became 100 g. This works out how many listed servings a phrase asks
// for. It handles counts and weights; anything it cannot read stays at 1.

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  dozen: 12, couple: 2, double: 2, triple: 3,
};
// Grams for weights, millilitres for volumes.
const WEIGHT: Record<string, number> = { g: 1, gram: 1, grams: 1, kg: 1000, oz: 28.35 };
const VOLUME: Record<string, number> = { ml: 1, l: 1000, litre: 1000, liter: 1000 };
// "2 rolls", "3 bowls": the number counts whole servings, not the pieces inside one.
const CONTAINER = /\b(rolls?|bowls?|plates?|cups?|glass(es)?|packs?|packets?|cans?|bottles?|servings?|portions?|box(es)?|bags?|sets?|orders?)\b/i;

interface Amount { n: number; kind: 'count' | 'weight' | 'volume'; }

const leadingAmount = (text: string): Amount | null => {
  const t = text.trim().toLowerCase();
  const m = /^(\d+(?:\.\d+)?)\s*([a-z]+)?/.exec(t);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2] || '';
    if (!(n > 0)) return null;
    if (unit in WEIGHT) return { n: n * WEIGHT[unit], kind: 'weight' };
    if (unit in VOLUME) return { n: n * VOLUME[unit], kind: 'volume' };
    return { n, kind: 'count' };
  }
  const word = t.split(/[^a-z]+/)[0];
  return word in NUMBER_WORDS ? { n: NUMBER_WORDS[word], kind: 'count' } : null;
};

/** The serving a result row states: the text inside its first bracket. */
const servingOf = (name: string): string => {
  const open = name.indexOf('(');
  const close = name.lastIndexOf(')');
  return open >= 0 && close > open ? name.slice(open + 1, close) : '';
};

/** How many listed servings `phrase` asks for. 1 when it states no amount. */
export const quantityFactor = (phrase: string, resultName: string): number => {
  const asked = leadingAmount(phrase);
  if (!asked) return 1;
  const serving = leadingAmount(servingOf(resultName)) || { n: 1, kind: 'count' as const };
  let factor = 1;
  if (asked.kind === 'count') {
    // "2 chicken breast" against "100g": two servings. "3 eggs" against
    // "2 large eggs": one and a half. "2 rolls" against "8 pieces": two.
    factor = serving.kind !== 'count' || CONTAINER.test(phrase) ? asked.n : asked.n / serving.n;
  } else if (asked.kind === serving.kind) {
    factor = asked.n / serving.n;
  }
  // A weight asked of a serving given by count (or the reverse) cannot be
  // converted without knowing what one piece weighs: leave it at one serving.
  return Math.min(20, Math.max(0.1, factor));
};

/** A result scaled to the amount the phrase asks for, named as it was typed. */
export const scaleToPhrase = <T extends { name: string; calories: number; protein: number; carbs: number; fats: number }>(
  phrase: string, item: T,
): T => {
  const k = quantityFactor(phrase, item.name);
  if (k === 1) return item;
  const label = phrase.trim().replace(/\s+/g, ' ');
  return {
    ...item,
    name: label.charAt(0).toUpperCase() + label.slice(1, 100),
    calories: Math.round(item.calories * k),
    protein: Math.round(item.protein * k),
    carbs: Math.round(item.carbs * k),
    fats: Math.round(item.fats * k),
  };
};
