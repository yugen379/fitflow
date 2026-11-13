/**
 * Branded food search: the app's window onto Open Food Facts' 3 million+
 * products.
 *
 * The bundled list (a few hundred foods) covers what people cook and order.
 * Packaged products are a different scale of problem, and nobody ships
 * millions of rows inside an app. Open Food Facts publishes them under the
 * Open Database Licence, but its search endpoint sends no CORS header, so a
 * browser or WebView cannot call it. This function can.
 *
 * It searches, throws away rows that cannot be trusted (offFoods.ts), and
 * remembers each answer, so a popular search costs one outside request a
 * month however many people type it. If Open Food Facts is slow or down the
 * app simply gets no branded rows; its own list and USDA still answer.
 *
 * Attribution is required by the licence: the app shows "Open Food Facts"
 * beside these results.
 */
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { INTERACTIVE } from "./capacity";
import { db } from "./db";
import { mapOffHits, searchKey, type OffFood } from "./offFoods";

const SEARCH_URL = "https://search.openfoodfacts.org/search";
const FIELDS = "code,product_name,brands,nutriments,serving_size,serving_quantity";
const DAY_MS = 86_400_000;
/** A found product does not change often; an empty answer may just be early. */
const TTL_FOUND_MS = 30 * DAY_MS;
const TTL_EMPTY_MS = DAY_MS;
const UPSTREAM_TIMEOUT_MS = 6_000;
/** Typing fires a search per pause; this is far above a person, far below a script. */
const PER_USER_PER_MINUTE = 40;

type Fetch = (url: string, init?: any) => Promise<{ ok: boolean; json: () => Promise<any> }>;

const recent = new Map<string, number[]>();
const overLimit = (uid: string, now: number): boolean => {
  const hits = (recent.get(uid) || []).filter((t) => now - t < 60_000);
  if (hits.length >= PER_USER_PER_MINUTE) { recent.set(uid, hits); return true; }
  hits.push(now);
  if (recent.size > 10_000) recent.clear();
  recent.set(uid, hits);
  return false;
};

export interface FoodSearchResult {
  foods: OffFood[];
  /** "cache" | "live" | "unavailable" (upstream failed; nothing was stored). */
  from: "cache" | "live" | "unavailable";
}

/** The search itself, with the network injectable so it can be tested. */
export const runFoodSearch = async (
  query: unknown,
  fetchImpl: Fetch = fetch as unknown as Fetch,
  now = Date.now(),
): Promise<FoodSearchResult> => {
  const key = searchKey(query);
  if (key.replace(/-/g, "").length < 3) return { foods: [], from: "cache" };

  const ref = db.doc(`food_search_cache/${key}`);
  const snap = await ref.get();
  if (snap.exists) {
    const c = snap.data() as { foods?: OffFood[]; at?: number };
    const foods = Array.isArray(c.foods) ? c.foods : [];
    const age = now - (typeof c.at === "number" ? c.at : 0);
    if (age >= 0 && age < (foods.length ? TTL_FOUND_MS : TTL_EMPTY_MS)) return { foods, from: "cache" };
  }

  let foods: OffFood[];
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const url = `${SEARCH_URL}?q=${encodeURIComponent(key.replace(/-/g, " "))}&page_size=24&fields=${FIELDS}`;
      const res = await fetchImpl(url, {
        signal: ctl.signal,
        headers: { "User-Agent": "FitFlow-App/1.6 (fitness app; branded food search)" },
      });
      if (!res.ok) return { foods: [], from: "unavailable" };
      foods = mapOffHits((await res.json())?.hits, 10);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Slow, down, or not JSON. Not an answer, so it is not remembered.
    return { foods: [], from: "unavailable" };
  }

  await ref.set({ q: key, foods, at: now }).catch((e) => console.error("food search cache write failed", e));
  return { foods, from: "live" };
};

export const searchFoods = onCall(INTERACTIVE, async (request): Promise<FoodSearchResult> => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required");
  if (overLimit(uid, Date.now())) throw new HttpsError("resource-exhausted", "Too many searches, slow down");
  return runFoodSearch((request.data as any)?.query);
});
