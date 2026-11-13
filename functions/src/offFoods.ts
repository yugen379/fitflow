/**
 * Open Food Facts search results -> foods the app can log. Pure: no network,
 * no database, so `npm run proof:backend` can feed it anything.
 *
 * Open Food Facts is crowd-sourced. Most of it is good; some of it is a
 * half-filled form, a typo, or energy entered in the wrong unit. Everything
 * here is about refusing those rows rather than showing a 4,000 kcal biscuit:
 * a product needs a name, a believable energy figure, and macros that could
 * add up to it.
 */

export interface OffFood {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  brand?: string;
  /** Barcode, so a later scan and a search agree on the same product. */
  code?: string;
  source: "OFF";
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

const clean = (v: unknown, max: number): string =>
  String(v ?? "")
    // Control characters and markup have no business in a food name.
    .replace(/[\u0000-\u001f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** One search hit as a loggable food, or null when it cannot be trusted. */
export const mapOffHit = (hit: any): OffFood | null => {
  if (!hit || typeof hit !== "object") return null;
  const name = clean(hit.product_name, 80);
  if (name.length < 2) return null;

  const n = hit.nutriments && typeof hit.nutriments === "object" ? hit.nutriments : {};
  let kcal = num(n["energy-kcal_100g"]);
  if (kcal == null) {
    const kj = num(n["energy_100g"]);
    if (kj != null) kcal = kj / 4.184;
  }
  // Pure fat is 900 kcal per 100 g; nothing edible is above that.
  if (kcal == null || kcal <= 0 || kcal > 900) return null;

  const protein = num(n["proteins_100g"]) ?? 0;
  const carbs = num(n["carbohydrates_100g"]) ?? 0;
  const fats = num(n["fat_100g"]) ?? 0;
  if ([protein, carbs, fats].some((g) => g < 0 || g > 100)) return null;
  if (protein + carbs + fats > 105) return null;
  // The same bound the food_catalog rule uses.
  if (protein * 4 + carbs * 4 + fats * 9 > kcal * 1.5 + 50) return null;

  // Per serving when the product states a sane one, else per 100 g.
  const grams = num(hit.serving_quantity);
  const perServing = grams != null && grams >= 5 && grams <= 1000;
  const k = perServing ? (grams as number) / 100 : 1;
  const label = perServing ? clean(hit.serving_size, 30) || `${Math.round(grams as number)}g` : "100g";

  const brands = Array.isArray(hit.brands) ? hit.brands : String(hit.brands ?? "").split(",");
  const brand = clean(brands[0], 60);
  const code = clean(hit.code, 20);

  return {
    name: `${name} (${label})`,
    calories: Math.max(1, Math.round(kcal * k)),
    protein: Math.round(protein * k),
    carbs: Math.round(carbs * k),
    fats: Math.round(fats * k),
    ...(brand ? { brand } : {}),
    ...(/^\d{6,14}$/.test(code) ? { code } : {}),
    source: "OFF",
  };
};

/** Every usable hit, without repeats of the same product, capped. */
export const mapOffHits = (hits: unknown, limit = 10): OffFood[] => {
  if (!Array.isArray(hits)) return [];
  const seen = new Set<string>();
  const out: OffFood[] = [];
  for (const h of hits) {
    const f = mapOffHit(h);
    if (!f) continue;
    const id = (f.name + "|" + (f.brand || "")).toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(f);
    if (out.length >= limit) break;
  }
  return out;
};

/** Cache key for a query: lowercase words joined by dashes, or "" if unusable. */
export const searchKey = (query: unknown): string =>
  String(query ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
