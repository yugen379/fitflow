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
    if (e.phrases[0] === qPhrase) score += 100;
    else if (e.phrases.includes(qPhrase)) score += 90;
    else if (e.phrases[0].startsWith(qPhrase + ' ')) score += 40;
    else if (e.phrases.some((p) => p.startsWith(qPhrase + ' ') || p.includes(' ' + qPhrase))) score += 25;
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
  const top = searchFoodIndex(index, phrase, 1)[0];
  if (!top) return null;
  const q = phraseOf(phrase);
  const budget = Math.min(2, typoBudget(q.replace(/ /g, '').length));
  const names = index.entries.find((e) => e.food === top.food)!.phrases;
  return names.some((p) => p === q || (budget > 0 && editDistance(p, q, budget) <= budget)) ? top.food : null;
};

/** What to show in a result row. */
export const displayName = (f: IndexedFood): string =>
  f.serving && !f.name.includes('(') ? `${f.name} (${f.serving})` : f.name;
