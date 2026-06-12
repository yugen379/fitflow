/// <reference types="vite/client" />
import { get, set } from 'idb-keyval';
import { lookupBarcodeRaw } from './barcodeUtils';

const USDA_API_KEY = (import.meta as any).env?.VITE_USDA_API_KEY || 'DEMO_KEY';
const CACHE_PREFIX = 'food_cache_';
const TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface FoodProduct {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  brand?: string;
  source: 'OFF' | 'USDA' | 'AI' | 'LOCAL';
}

/**
 * Curated local food database — typical serving sizes with realistic macros.
 * This is the FIRST lookup so common foods always log instantly with sane numbers,
 * even when Gemini is over quota and USDA is slow or returns confusing duplicates.
 * Keys are lowercase; partial-match search uses `aliases` to catch variant phrasings.
 */
interface LocalFood {
  name: string;          // canonical display name
  aliases: string[];     // alternate phrasings the user might type
  calories: number;      // per serving
  protein: number;
  carbs: number;
  fats: number;
  serving: string;       // describes the serving size for the macros above
}

const LOCAL_FOODS: LocalFood[] = [
  // Breakfast / oats / cereal
  { name: 'Oatmeal',                 aliases: ['oats', 'oatmeal', 'porridge', 'bowl of oatmeal', 'oat porridge', 'rolled oats'],                   calories: 158, protein: 6,  carbs: 27, fats: 3,  serving: '1 bowl (40g dry)' },
  { name: 'Oatmeal with blueberries',aliases: ['oatmeal blueberries', 'blueberry oatmeal', 'oats blueberries'],                                  calories: 220, protein: 7,  carbs: 42, fats: 4,  serving: '1 bowl' },
  { name: 'Oatmeal with banana',     aliases: ['oatmeal banana', 'banana oatmeal', 'oats banana'],                                                calories: 280, protein: 7,  carbs: 55, fats: 4,  serving: '1 bowl' },
  { name: 'Cornflakes with milk',    aliases: ['cornflakes', 'corn flakes', 'cereal milk'],                                                       calories: 200, protein: 7,  carbs: 38, fats: 3,  serving: '1 bowl' },
  { name: 'Granola',                 aliases: ['granola', 'muesli'],                                                                              calories: 220, protein: 5,  carbs: 32, fats: 8,  serving: '1/2 cup' },
  { name: 'Greek yogurt',            aliases: ['greek yogurt', 'yogurt', 'plain yogurt'],                                                         calories: 100, protein: 17, carbs: 6,  fats: 0,  serving: '170g cup' },
  { name: 'Eggs',                    aliases: ['egg', 'eggs', 'boiled egg', 'fried egg', 'scrambled eggs', 'two eggs'],                          calories: 156, protein: 13, carbs: 1,  fats: 11, serving: '2 large eggs' },
  { name: 'Omelette',                aliases: ['omelette', 'omelet', 'vegetable omelette', 'cheese omelette'],                                    calories: 280, protein: 18, carbs: 4,  fats: 22, serving: '3 eggs' },
  { name: 'Pancakes',                aliases: ['pancake', 'pancakes', 'stack of pancakes'],                                                       calories: 350, protein: 7,  carbs: 56, fats: 11, serving: '3 small' },
  { name: 'Waffles',                 aliases: ['waffle', 'waffles'],                                                                              calories: 290, protein: 6,  carbs: 36, fats: 14, serving: '1 waffle' },
  { name: 'Avocado toast',           aliases: ['avocado toast', 'avo toast'],                                                                     calories: 290, protein: 8,  carbs: 30, fats: 17, serving: '1 slice' },
  { name: 'Toast with butter',       aliases: ['toast', 'buttered toast', 'bread toast'],                                                         calories: 130, protein: 3,  carbs: 17, fats: 6,  serving: '1 slice' },
  { name: 'Bagel with cream cheese', aliases: ['bagel cream cheese', 'bagel', 'cream cheese bagel'],                                              calories: 420, protein: 12, carbs: 60, fats: 14, serving: '1 medium' },
  { name: 'Protein smoothie',        aliases: ['protein smoothie', 'protein shake', 'whey shake'],                                                calories: 280, protein: 28, carbs: 28, fats: 6,  serving: '500ml' },
  { name: 'Banana smoothie',         aliases: ['banana smoothie', 'fruit smoothie'],                                                              calories: 220, protein: 5,  carbs: 48, fats: 2,  serving: '500ml' },

  // Lunch / dinner — proteins
  { name: 'Chicken breast',          aliases: ['chicken breast', 'chicken', 'grilled chicken'],                                                   calories: 165, protein: 31, carbs: 0,  fats: 4,  serving: '100g cooked' },
  { name: 'Chicken thigh',           aliases: ['chicken thigh', 'grilled thigh'],                                                                 calories: 209, protein: 26, carbs: 0,  fats: 11, serving: '100g cooked' },
  { name: 'Salmon',                  aliases: ['salmon', 'grilled salmon', 'baked salmon'],                                                       calories: 208, protein: 22, carbs: 0,  fats: 13, serving: '100g cooked' },
  { name: 'Tuna',                    aliases: ['tuna', 'tuna can', 'canned tuna', 'tuna in water'],                                               calories: 116, protein: 26, carbs: 0,  fats: 1,  serving: '100g' },
  { name: 'Tilapia',                 aliases: ['tilapia', 'white fish'],                                                                          calories: 130, protein: 26, carbs: 0,  fats: 3,  serving: '100g cooked' },
  { name: 'Shrimp',                  aliases: ['shrimp', 'prawns'],                                                                               calories: 99,  protein: 24, carbs: 0,  fats: 0,  serving: '100g cooked' },
  { name: 'Beef steak',              aliases: ['steak', 'beef steak', 'sirloin', 'ribeye'],                                                       calories: 271, protein: 26, carbs: 0,  fats: 18, serving: '100g cooked' },
  { name: 'Ground beef',             aliases: ['ground beef', 'mince', 'beef mince'],                                                             calories: 254, protein: 26, carbs: 0,  fats: 17, serving: '100g cooked' },
  { name: 'Pork chop',               aliases: ['pork chop', 'pork'],                                                                              calories: 231, protein: 26, carbs: 0,  fats: 14, serving: '100g cooked' },
  { name: 'Turkey breast',           aliases: ['turkey', 'turkey breast', 'sliced turkey'],                                                       calories: 135, protein: 30, carbs: 0,  fats: 1,  serving: '100g' },
  { name: 'Tofu',                    aliases: ['tofu', 'firm tofu'],                                                                              calories: 144, protein: 17, carbs: 3,  fats: 9,  serving: '100g' },
  { name: 'Lentils',                 aliases: ['lentils', 'dal', 'dhal', 'lentil soup'],                                                          calories: 116, protein: 9,  carbs: 20, fats: 0,  serving: '1 cup cooked' },
  { name: 'Chickpeas',               aliases: ['chickpea', 'chickpeas', 'garbanzo'],                                                              calories: 164, protein: 9,  carbs: 27, fats: 3,  serving: '1 cup cooked' },
  { name: 'Black beans',             aliases: ['black beans', 'beans'],                                                                           calories: 220, protein: 15, carbs: 40, fats: 1,  serving: '1 cup cooked' },

  // Carbs / starches
  { name: 'White rice',              aliases: ['white rice', 'rice', 'steamed rice', 'jasmine rice'],                                             calories: 205, protein: 4,  carbs: 45, fats: 0,  serving: '1 cup cooked' },
  { name: 'Brown rice',              aliases: ['brown rice'],                                                                                     calories: 216, protein: 5,  carbs: 45, fats: 2,  serving: '1 cup cooked' },
  { name: 'Quinoa',                  aliases: ['quinoa'],                                                                                         calories: 222, protein: 8,  carbs: 39, fats: 4,  serving: '1 cup cooked' },
  { name: 'Pasta',                   aliases: ['pasta', 'spaghetti', 'penne', 'fettuccine'],                                                      calories: 220, protein: 8,  carbs: 43, fats: 1,  serving: '1 cup cooked' },
  { name: 'Whole wheat pasta',       aliases: ['wholewheat pasta', 'whole grain pasta'],                                                          calories: 174, protein: 7,  carbs: 37, fats: 1,  serving: '1 cup cooked' },
  { name: 'Sweet potato',            aliases: ['sweet potato', 'baked sweet potato', 'yam'],                                                      calories: 180, protein: 4,  carbs: 41, fats: 0,  serving: '1 medium' },
  { name: 'Potato',                  aliases: ['potato', 'baked potato', 'boiled potato'],                                                        calories: 161, protein: 4,  carbs: 37, fats: 0,  serving: '1 medium' },
  { name: 'French fries',            aliases: ['fries', 'french fries', 'chips'],                                                                 calories: 365, protein: 4,  carbs: 48, fats: 17, serving: 'medium serving' },
  { name: 'Bread',                   aliases: ['bread', 'slice of bread', 'white bread'],                                                         calories: 80,  protein: 3,  carbs: 15, fats: 1,  serving: '1 slice' },
  { name: 'Whole wheat bread',       aliases: ['whole wheat bread', 'wholegrain bread', 'brown bread'],                                           calories: 81,  protein: 4,  carbs: 14, fats: 1,  serving: '1 slice' },
  { name: 'Roti',                    aliases: ['roti', 'chapati', 'flatbread'],                                                                   calories: 120, protein: 3,  carbs: 25, fats: 2,  serving: '1 piece' },
  { name: 'Naan',                    aliases: ['naan', 'naan bread'],                                                                             calories: 260, protein: 9,  carbs: 45, fats: 5,  serving: '1 piece' },
  { name: 'Tortilla',                aliases: ['tortilla', 'wrap'],                                                                               calories: 150, protein: 4,  carbs: 26, fats: 4,  serving: '1 large' },

  // Vegetables / salads
  { name: 'Broccoli',                aliases: ['broccoli', 'steamed broccoli'],                                                                   calories: 55,  protein: 4,  carbs: 11, fats: 1,  serving: '1 cup' },
  { name: 'Spinach',                 aliases: ['spinach'],                                                                                        calories: 23,  protein: 3,  carbs: 4,  fats: 0,  serving: '1 cup raw' },
  { name: 'Mixed salad',             aliases: ['salad', 'green salad', 'mixed salad'],                                                            calories: 120, protein: 3,  carbs: 10, fats: 8,  serving: '1 bowl' },
  { name: 'Caesar salad',            aliases: ['caesar salad'],                                                                                   calories: 350, protein: 10, carbs: 14, fats: 28, serving: '1 bowl' },
  { name: 'Mixed vegetables',        aliases: ['mixed vegetables', 'mixed veg', 'veggies'],                                                       calories: 80,  protein: 3,  carbs: 16, fats: 1,  serving: '1 cup' },
  { name: 'Carrots',                 aliases: ['carrots', 'baby carrots'],                                                                        calories: 50,  protein: 1,  carbs: 12, fats: 0,  serving: '1 cup' },

  // Fruits
  { name: 'Apple',                   aliases: ['apple', 'red apple', 'green apple'],                                                              calories: 95,  protein: 0,  carbs: 25, fats: 0,  serving: '1 medium' },
  { name: 'Banana',                  aliases: ['banana'],                                                                                         calories: 105, protein: 1,  carbs: 27, fats: 0,  serving: '1 medium' },
  { name: 'Orange',                  aliases: ['orange'],                                                                                         calories: 62,  protein: 1,  carbs: 15, fats: 0,  serving: '1 medium' },
  { name: 'Berries',                 aliases: ['berries', 'mixed berries', 'blueberries', 'strawberries'],                                        calories: 50,  protein: 1,  carbs: 12, fats: 0,  serving: '1 cup' },
  { name: 'Grapes',                  aliases: ['grapes'],                                                                                         calories: 104, protein: 1,  carbs: 27, fats: 0,  serving: '1 cup' },
  { name: 'Mango',                   aliases: ['mango'],                                                                                          calories: 100, protein: 1,  carbs: 25, fats: 0,  serving: '1 cup' },
  { name: 'Pineapple',               aliases: ['pineapple'],                                                                                      calories: 82,  protein: 1,  carbs: 22, fats: 0,  serving: '1 cup' },
  { name: 'Avocado',                 aliases: ['avocado'],                                                                                        calories: 240, protein: 3,  carbs: 13, fats: 22, serving: '1 medium' },

  // Snacks / sweets
  { name: 'Peanut butter',           aliases: ['peanut butter', 'pb'],                                                                            calories: 188, protein: 8,  carbs: 6,  fats: 16, serving: '2 tbsp' },
  { name: 'Almond butter',           aliases: ['almond butter'],                                                                                  calories: 196, protein: 7,  carbs: 6,  fats: 18, serving: '2 tbsp' },
  { name: 'Almonds',                 aliases: ['almonds', 'almond'],                                                                              calories: 164, protein: 6,  carbs: 6,  fats: 14, serving: '28g (1oz)' },
  { name: 'Walnuts',                 aliases: ['walnuts', 'walnut'],                                                                              calories: 185, protein: 4,  carbs: 4,  fats: 18, serving: '28g (1oz)' },
  { name: 'Mixed nuts',              aliases: ['mixed nuts', 'trail mix'],                                                                        calories: 175, protein: 5,  carbs: 6,  fats: 16, serving: '28g (1oz)' },
  { name: 'Hummus',                  aliases: ['hummus'],                                                                                         calories: 70,  protein: 2,  carbs: 6,  fats: 4,  serving: '2 tbsp' },
  { name: 'Cheese',                  aliases: ['cheese', 'cheddar', 'mozzarella'],                                                                calories: 113, protein: 7,  carbs: 0,  fats: 9,  serving: '28g (1oz)' },
  { name: 'Cottage cheese',          aliases: ['cottage cheese'],                                                                                 calories: 98,  protein: 11, carbs: 3,  fats: 4,  serving: '1/2 cup' },
  { name: 'Dark chocolate',          aliases: ['dark chocolate', 'chocolate'],                                                                    calories: 170, protein: 2,  carbs: 13, fats: 12, serving: '30g' },
  { name: 'Protein bar',             aliases: ['protein bar', 'energy bar'],                                                                      calories: 210, protein: 20, carbs: 22, fats: 7,  serving: '1 bar' },
  { name: 'Granola bar',             aliases: ['granola bar', 'cereal bar'],                                                                      calories: 130, protein: 3,  carbs: 22, fats: 4,  serving: '1 bar' },
  { name: 'Ice cream',               aliases: ['ice cream'],                                                                                      calories: 200, protein: 4,  carbs: 23, fats: 11, serving: '1/2 cup' },
  { name: 'Cookies',                 aliases: ['cookies', 'cookie', 'biscuits'],                                                                  calories: 160, protein: 2,  carbs: 22, fats: 8,  serving: '2 cookies' },
  { name: 'Donut',                   aliases: ['donut', 'doughnut'],                                                                              calories: 270, protein: 4,  carbs: 31, fats: 15, serving: '1 medium' },

  // Common meals / fast food
  { name: 'Cheeseburger',            aliases: ['cheeseburger', 'burger', 'hamburger'],                                                            calories: 550, protein: 30, carbs: 40, fats: 28, serving: '1 burger' },
  { name: 'Pizza slice',             aliases: ['pizza', 'pizza slice', 'slice of pizza'],                                                         calories: 285, protein: 12, carbs: 36, fats: 10, serving: '1 slice' },
  { name: 'Sandwich',                aliases: ['sandwich', 'turkey sandwich', 'ham sandwich'],                                                    calories: 350, protein: 18, carbs: 38, fats: 14, serving: '1 sandwich' },
  { name: 'Burrito',                 aliases: ['burrito', 'chicken burrito'],                                                                     calories: 580, protein: 28, carbs: 70, fats: 20, serving: '1 medium' },
  { name: 'Sushi roll',              aliases: ['sushi', 'sushi roll', 'maki'],                                                                    calories: 290, protein: 9,  carbs: 38, fats: 11, serving: '8 pieces' },
  { name: 'Stir fry',                aliases: ['stir fry', 'stirfry', 'wok'],                                                                     calories: 380, protein: 22, carbs: 35, fats: 16, serving: '1 plate' },
  { name: 'Pad thai',                aliases: ['pad thai'],                                                                                       calories: 520, protein: 18, carbs: 70, fats: 18, serving: '1 plate' },
  { name: 'Curry with rice',         aliases: ['curry', 'chicken curry', 'curry rice'],                                                           calories: 520, protein: 25, carbs: 65, fats: 18, serving: '1 plate' },
  { name: 'Tacos',                   aliases: ['tacos', 'taco'],                                                                                  calories: 220, protein: 12, carbs: 18, fats: 11, serving: '2 tacos' },
  { name: 'Soup',                    aliases: ['soup', 'vegetable soup', 'chicken soup'],                                                         calories: 120, protein: 6,  carbs: 16, fats: 3,  serving: '1 bowl' },

  // Drinks
  { name: 'Black coffee',            aliases: ['coffee', 'black coffee', 'americano'],                                                            calories: 2,   protein: 0,  carbs: 0,  fats: 0,  serving: '240ml' },
  { name: 'Coffee with milk',        aliases: ['coffee milk', 'latte', 'cappuccino', 'cafe au lait', 'coffee with milk'],                        calories: 100, protein: 6,  carbs: 10, fats: 4,  serving: '240ml' },
  { name: 'Orange juice',            aliases: ['orange juice', 'oj', 'orange juice glass'],                                                       calories: 110, protein: 2,  carbs: 26, fats: 0,  serving: '240ml' },
  { name: 'Milk',                    aliases: ['milk', 'glass of milk', 'whole milk'],                                                            calories: 150, protein: 8,  carbs: 12, fats: 8,  serving: '240ml' },
  { name: 'Almond milk',             aliases: ['almond milk', 'plant milk'],                                                                      calories: 40,  protein: 1,  carbs: 2,  fats: 3,  serving: '240ml' },
  { name: 'Beer',                    aliases: ['beer'],                                                                                           calories: 154, protein: 2,  carbs: 13, fats: 0,  serving: '355ml' },
  { name: 'Red wine',                aliases: ['wine', 'red wine', 'white wine'],                                                                 calories: 125, protein: 0,  carbs: 4,  fats: 0,  serving: '150ml' },
  { name: 'Soda',                    aliases: ['soda', 'coke', 'cola', 'pepsi'],                                                                  calories: 150, protein: 0,  carbs: 39, fats: 0,  serving: '355ml can' },
];

// Strip filler words so "a bowl of oatmeal with honey" matches "oatmeal".
const FILLER = /\b(a|an|the|some|of|with|and|my|small|medium|large|big|bowl|cup|glass|plate|piece|slice|serving|portion|grams?|cups?)\b/gi;
const normalize = (q: string) => q.toLowerCase().replace(FILLER, ' ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

export const searchLocalFoods = (query: string): FoodProduct[] => {
  const q = normalize(query);
  if (!q) return [];
  const tokens = q.split(' ').filter(t => t.length >= 2);
  if (!tokens.length) return [];

  // Score each food by how many tokens it covers, then by alias-match-length.
  const scored = LOCAL_FOODS.map(f => {
    const hay = (f.name + ' ' + f.aliases.join(' ')).toLowerCase();
    let score = 0;
    let exact = 0;
    for (const t of tokens) {
      if (hay.includes(t)) score++;
      // Exact alias match counts double
      if (f.aliases.some(a => a === t || a.split(' ').includes(t))) exact++;
    }
    return { f, score, exact };
  }).filter(s => s.score > 0)
    .sort((a, b) => (b.exact - a.exact) || (b.score - a.score));

  return scored.slice(0, 5).map(s => ({
    name: `${s.f.name} (${s.f.serving})`,
    calories: s.f.calories,
    protein: s.f.protein,
    carbs: s.f.carbs,
    fats: s.f.fats,
    source: 'LOCAL' as const,
  }));
};

async function getFromCache(id: string): Promise<FoodProduct | null> {
  const cached = await get(`${CACHE_PREFIX}${id}`);
  if (cached && Date.now() - cached.timestamp < TTL) {
    return cached.data;
  }
  return null;
}

async function saveToCache(id: string, data: FoodProduct) {
  await set(`${CACHE_PREFIX}${id}`, {
    data,
    timestamp: Date.now()
  });
}

export const lookupBarcode = async (barcode: string): Promise<FoodProduct | null> => {
  const clean = (barcode || '').replace(/\D/g, '');
  if (!clean) return null;

  // Cache hit (keyed by the raw scanned code).
  const cached = await getFromCache(clean);
  if (cached) return cached;

  // Hardened resolver: OFF v2 → OFF v0 → USDA, each across UPC/EAN variants,
  // tolerant of OFF's HTML rate-limit pages. (User-Agent is omitted here — it's
  // a forbidden header in the browser; the Node proof harness sets one.)
  const raw = await lookupBarcodeRaw(clean, {
    usdaKey: USDA_API_KEY,
    retries: 2,
    backoffMs: 300,
  });
  if (!raw) return null;

  const product: FoodProduct = {
    name: raw.name,
    calories: raw.calories,
    protein: raw.protein,
    carbs: raw.carbs,
    fats: raw.fats,
    brand: raw.brand,
    source: raw.source === 'USDA' ? 'USDA' : 'OFF',
  };
  await saveToCache(clean, product);
  return product;
};

// Group USDA hits by their stem so "Chicken, breast, raw" / "Chicken, breast, roasted, broiler"
// don't all show up — we keep the highest-quality entry per stem.
const dedupeUsda = (foods: any[]): FoodProduct[] => {
  const seen = new Map<string, FoodProduct>();
  for (const food of foods) {
    const getNutrient = (id: number) => food.foodNutrients?.find((n: any) => n.nutrientId === id)?.value || 0;
    const cals = Math.round(getNutrient(1008));
    if (cals <= 0) continue;
    const desc: string = food.description || '';
    // Stem = first 2-3 meaningful words (strip preparation modifiers like "raw"/"cooked"/"roasted").
    const stem = desc
      .toLowerCase()
      .replace(/,.*$/, '')
      .replace(/\b(raw|cooked|roasted|grilled|baked|fried|boiled|broiled|steamed|fresh|frozen|canned|with skin|without skin|broiler|fryer|skinless|boneless)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .slice(0, 3)
      .join(' ');
    if (!stem || seen.has(stem)) continue;
    seen.set(stem, {
      name: desc,
      calories: cals,
      protein: Math.round(getNutrient(1003)),
      carbs: Math.round(getNutrient(1005)),
      fats: Math.round(getNutrient(1004)),
      brand: food.brandOwner,
      source: 'USDA' as const,
    });
    if (seen.size >= 5) break;
  }
  return Array.from(seen.values());
};

export const searchFood = async (query: string): Promise<FoodProduct[]> => {
  if (query.length < 2) return [];

  // 1) Local curated database — instant, no API call, no duplicates, sane portions.
  const local = searchLocalFoods(query);
  if (local.length > 0) return local;

  // 2) USDA fallback for anything not in the local DB.
  try {
    const res = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&pageSize=20&api_key=${USDA_API_KEY}`);
    const data = await res.json();
    if (!data.foods) return [];
    return dedupeUsda(data.foods);
  } catch (e) {
    console.error('USDA Search Error:', e);
    return [];
  }
};
