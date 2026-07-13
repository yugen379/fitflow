import { GoogleGenAI } from "@google/genai";
import { searchFood, searchLocalFoods } from "./foodService";
import { buildBriefing, applyPolish, CoachContext, CoachBriefing } from "./coachBriefing";
import { splitPhrases, buildResult, normalizeItem, QuickAddResult, QuickAddItem } from "./quickAddUtils";

// Production sends every Gemini call through a Cloud Function proxy so the API
// key never ships in the client bundle. When VITE_GEMINI_PROXY_URL is unset
// (development), we fall back to calling the SDK directly with a local key.
const PROXY_URL = (import.meta as any).env?.VITE_GEMINI_PROXY_URL as string | undefined;
const LOCAL_KEY = (process.env.GEMINI_API_KEY as string | undefined) || undefined;
const useProxy = !!PROXY_URL;

const ai = !useProxy && LOCAL_KEY ? new GoogleGenAI({ apiKey: LOCAL_KEY }) : null;

// Free-tier quota is enforced PER MODEL (5 req/min/model), so a single model
// 429s after a handful of messages. We cascade across several models that each
// carry an independent quota bucket — the first one to answer wins. This multi-
// plies real-AI throughput ~4x before anything degrades to a heuristic reply.
// (2.0-flash / 2.0-flash-lite are excluded: zeroed quota on AI-Studio keys.)
const MODELS = [
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-2.5-flash-lite',
  'gemini-flash-lite-latest',
];

const isRetryable = (e: any): boolean => {
  const s = Number(e?.status ?? e?.code);
  if (s === 429 || s === 500 || s === 503) return true;
  const msg = String(e?.message || e || '');
  return /RESOURCE_EXHAUSTED|quota|rate|unavailable|overloaded|deadline|timeout|network|fetch/i.test(msg);
};

// Per-call ceiling so one hung model can't stall the whole request (a real 162s
// stall was seen against an overloaded endpoint). A timeout reads as retryable,
// so the cascade simply moves on to the next model.
const CALL_TIMEOUT_MS = 20000;

// Gemini 2.5-family models "think" before answering by default — seconds of
// extra latency the app's short structured tasks don't need. Budget 0 turns it
// off; a model that rejects the flag reads as a hard error and ends the sweep,
// but every model in MODELS is 2.5-family and accepts it.
const GEN_CONFIG = { thinkingConfig: { thinkingBudget: 0 } };
const withTimeout = <T>(p: Promise<T>, ms = CALL_TIMEOUT_MS): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);

// Exponential backoff with jitter between full cascade sweeps: base·2^attempt +
// up to 250ms random, so many clients don't re-hit the quota in lockstep.
const backoff = (attempt: number, baseMs: number): Promise<void> =>
  new Promise(r => setTimeout(r, baseMs * 2 ** attempt + Math.floor(Math.random() * 250)));

// ---------------------------------------------------------------------------
// Process-local TTL + LRU cache. Identical AI requests (re-logging "banana", an
// unchanged recipe, the same daily inputs) return the prior answer instead of
// spending another quota-limited call. No Firebase — keeps the proof harnesses
// self-contained — and clears on reload. Only "real" answers are cached (see
// each caller's `accept`), so a transient fallback never gets pinned.
// ---------------------------------------------------------------------------
const CACHE_MAX = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
const aiCache = new Map<string, { value: any; expires: number }>();

const cacheGet = (key: string): any | undefined => {
  const hit = aiCache.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expires) { aiCache.delete(key); return undefined; }
  aiCache.delete(key); aiCache.set(key, hit); // LRU touch
  return hit.value;
};

const cacheSet = (key: string, value: any, ttlMs: number): void => {
  if (value == null) return;
  if (aiCache.size >= CACHE_MAX) {
    const oldest = aiCache.keys().next().value;
    if (oldest !== undefined) aiCache.delete(oldest);
  }
  aiCache.set(key, { value, expires: Date.now() + ttlMs });
};

// Memoize an async producer under a stable key. On a miss the producer runs and
// the result is cached only if `accept` approves it.
const memoize = async <T>(
  key: string,
  ttlMs: number,
  produce: () => Promise<T>,
  accept: (v: T) => boolean = () => true,
): Promise<T> => {
  const cached = cacheGet(key);
  if (cached !== undefined) return cached as T;
  const value = await produce();
  if (accept(value)) cacheSet(key, value, ttlMs);
  return value;
};

const safeJsonParse = (text: string, fallback: any = {}) => {
  try {
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch {
    return fallback;
  }
};

// The proxy requires a signed-in user (it verifies a Firebase ID token). The
// host app injects a token supplier at boot (src/lib/firebase.ts); this module
// itself stays firebase-free so the proof harnesses keep working, and they call
// Gemini directly with a local key rather than through the proxy.
type AuthTokenSupplier = () => Promise<string | null>;
let getAuthToken: AuthTokenSupplier | null = null;
export const setGeminiAuthTokenSupplier = (fn: AuthTokenSupplier): void => { getAuthToken = fn; };

const callProxy = async (action: string, payload: any) => {
  if (!PROXY_URL) throw new Error('Gemini proxy not configured');
  const token = getAuthToken ? await getAuthToken().catch(() => null) : null;
  // Abort a hung proxy call so it can't block the UI indefinitely; the caller's
  // try/catch then degrades to the structured fallback.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ action, payload }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Gemini proxy returned ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
};

// One pass over the model cascade. Returns trimmed text, or null if every model
// failed. On a retryable (quota/transient) error we move to the next model; on a
// hard error (bad request) we stop — trying other models won't help. Never throws.
const generateOnce = async (contents: any): Promise<string | null> => {
  if (!ai) return null;
  for (const model of MODELS) {
    try {
      const resp = await withTimeout(ai.models.generateContent({ model, contents, config: GEN_CONFIG }));
      const text = (resp.text || '').trim();
      if (text) return text;
      // Empty completion — try the next model.
    } catch (e: any) {
      console.warn(`Gemini ${model} failed:`, e?.status || '', String(e?.message || e).slice(0, 80));
      if (!isRetryable(e)) break;
    }
  }
  return null;
};

// Cascade sweep with exponential-backoff retries. When every model in one sweep
// is momentarily exhausted/overloaded, wait and sweep again (the quota buckets
// refill quickly) before giving the caller a null to degrade on.
const generate = async (contents: any, retries = 2, baseMs = 500): Promise<string | null> => {
  if (!ai) return null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const text = await generateOnce(contents);
    if (text) return text;
    if (attempt < retries) await backoff(attempt, baseMs);
  }
  return null;
};

const direct = async (contents: any, fallback: any = '{}') => {
  const text = await generate(contents);
  // Quota exhaustion, rate limits, network blips — always degrade to the
  // structured fallback so the UI never sees a thrown error toast.
  return text ? safeJsonParse(text, fallback) : fallback;
};

const directRaw = async (contents: any, fallbackText = '') => {
  const text = await generate(contents);
  return text || fallbackText;
};

// Retrying variant for user-facing text (the coach): if the whole cascade is
// momentarily exhausted, wait a short backoff and sweep it again before giving
// up to a canned reply. Accepts only answers that clear a minimum-substance bar.
const directRawRetry = async (
  contents: any,
  { retries = 2, minChars = 12, backoffMs = 500 }: { retries?: number; minChars?: number; backoffMs?: number } = {},
): Promise<string | null> => {
  if (!ai) return null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const text = await generateOnce(contents);
    if (text && text.length >= minChars) return text;
    if (attempt < retries) await backoff(attempt, backoffMs);
  }
  return null;
};

// ---------------------------------------------------------------------------
// Public API — every consumer of Gemini routes through these functions.
// ---------------------------------------------------------------------------

// USDA fallback so when Gemini is over quota the meal still gets logged with real numbers.
const usdaFallback = async (description: string) => {
  try {
    const results = await searchFood(description);
    const hit = results.find(r => r.calories > 0);
    if (hit) {
      return {
        name: hit.name,
        calories: Math.round(hit.calories),
        protein: Math.round(hit.protein),
        carbs: Math.round(hit.carbs),
        fats: Math.round(hit.fats),
      };
    }
  } catch { /* ignore */ }
  return null;
};

export const estimateCalories = async (description: string) =>
  // Cache by normalized text: re-logging the same food never re-spends a call.
  // Only cache real hits (calories > 0) so a transient zero isn't pinned.
  memoize(`cal:${description.trim().toLowerCase()}`, DAY_MS, () =>
    estimateCaloriesUncached(description), (r) => !!r && r.calories > 0);

const estimateCaloriesUncached = async (description: string) => {
  const zero = { name: description, calories: 0, protein: 0, carbs: 0, fats: 0 };

  // 1) Local curated database — instant hit for common foods like "bowl of oatmeal",
  //    "chicken breast", "banana smoothie". Strips filler words before matching.
  const local = searchLocalFoods(description);
  if (local.length > 0 && local[0].calories > 0) {
    const hit = local[0];
    return {
      name: hit.name,
      calories: hit.calories,
      protein: hit.protein,
      carbs: hit.carbs,
      fats: hit.fats,
    };
  }

  // 2) Gemini for anything more specific or unusual.
  let result: any = zero;
  if (useProxy) {
    try { result = await callProxy('estimateCalories', { description }); }
    catch { result = zero; }
  } else {
    result = await direct(
      `Analyze this food and return ONLY valid JSON.
Format: {"name": string, "calories": number, "protein": number, "carbs": number, "fats": number}
Food: "${description}"`,
      zero,
    );
  }

  // 3) USDA last resort.
  if (!result || !result.calories || result.calories <= 0) {
    const usda = await usdaFallback(description);
    if (usda) return usda;
  }
  return result;
};

export const analyzeMealImage = async (base64Image: string, mimeType = 'image/jpeg') => {
  const fallback = { name: 'Unknown meal', calories: 0, protein: 0, carbs: 0, fats: 0 };
  if (useProxy) {
    try { return await callProxy('analyzeMealImage', { base64Image, mimeType }); }
    catch { return fallback; }
  }
  return direct(
    {
      parts: [
        { inlineData: { data: base64Image, mimeType } },
        { text: `Analyze this food image and return ONLY valid JSON.
Format: {"name": string, "calories": number, "protein": number, "carbs": number, "fats": number}` },
      ],
    },
    fallback,
  );
};

// AI barcode fallback — when the barcode either won't decode or the product
// isn't in OFF/USDA, we send the captured camera frame to Gemini Vision to read
// the on-pack nutrition label (or identify the product) and return per-100g
// macros. This is what makes the scanner an "AI barcode scanner": even unlisted
// products resolve instead of dumping the user to manual entry.
export interface ScannedNutrition {
  name: string;
  brand?: string;
  calories: number; // per 100g
  protein: number;
  carbs: number;
  fats: number;
  source: 'AI';
}

export const analyzeNutritionLabel = async (
  base64Image: string,
  mimeType = 'image/jpeg',
): Promise<ScannedNutrition | null> => {
  const parse = (r: any): ScannedNutrition | null => {
    if (!r) return null;
    const n = Number(r.calories);
    if (!Number.isFinite(n) || n <= 0) return null;
    return {
      name: r.name || 'Scanned product',
      brand: r.brand || undefined,
      calories: Math.round(n),
      protein: Math.round(Number(r.protein) || 0),
      carbs: Math.round(Number(r.carbs) || 0),
      fats: Math.round(Number(r.fats) || 0),
      source: 'AI',
    };
  };

  if (useProxy) {
    try { return parse(await callProxy('analyzeNutritionLabel', { base64Image, mimeType })); }
    catch { return null; }
  }
  const r = await direct(
    {
      parts: [
        { inlineData: { data: base64Image, mimeType } },
        {
          text: `You are reading a packaged-food photo (a barcode/product or its nutrition label).
Identify the product and return its nutrition PER 100g (or per 100ml). If the label only shows per-serving values, convert to per-100g using the stated serving size.
Return ONLY valid JSON, no markdown:
{"name": string, "brand": string, "calories": number, "protein": number, "carbs": number, "fats": number}
If you genuinely cannot determine any nutrition, return {"calories": 0}.`,
        },
      ],
    },
    { calories: 0 },
  );
  return parse(r);
};

// Heuristic workout generator — used whenever Gemini doesn't return usable exercises.
// We pick exercises from a curated pool based on goal + type so the user always gets
// a concrete, well-structured session instead of an empty card.
const heuristicWorkout = (userGoals: string): any => {
  const g = (userGoals || '').toLowerCase();
  const isCardio = /cardio|run|hiit|burn|endurance|stamina|condition/.test(g);
  const isCycling = /cycle|cycling|bike|spin/.test(g);
  const isSwimming = /swim|pool|aqua/.test(g);
  const isUpper = /upper|push|pull|chest|back|arm|shoulder/.test(g);
  const isLower = /lower|leg|glute|squat|deadlift|hamstring/.test(g);
  const isFatLoss = /fat|loss|lean|cut|weight loss/.test(g);
  const isMuscle = /muscle|hypertrophy|build|gain|mass|strength/.test(g);

  if (isCycling) {
    return {
      title: 'Threshold ride',
      description: '40 min mixed-intensity cycling session — builds aerobic capacity and leg endurance.',
      type: 'Cycling',
      exercises: [
        { id: 'warmup-spin', name: 'Easy spin — 8 min warm-up' },
        { id: 'tempo-1', name: 'Tempo block 1 — 8 min @ 75% effort' },
        { id: 'recovery-1', name: 'Easy spin — 3 min' },
        { id: 'tempo-2', name: 'Tempo block 2 — 8 min @ 80% effort' },
        { id: 'recovery-2', name: 'Easy spin — 3 min' },
        { id: 'sprint-set', name: '6 x 30s sprints / 60s easy' },
        { id: 'cooldown-spin', name: 'Cooldown spin — 5 min' },
      ],
    };
  }
  if (isSwimming) {
    return {
      title: 'Pyramid swim',
      description: '1800m pyramid set — builds smooth pacing and lung capacity.',
      type: 'Swimming',
      exercises: [
        { id: 'warmup-swim', name: '200m freestyle warm-up' },
        { id: 'set-100', name: '4 x 100m moderate (15s rest)' },
        { id: 'set-200', name: '3 x 200m steady (20s rest)' },
        { id: 'set-100b', name: '4 x 100m strong (15s rest)' },
        { id: 'kick-set', name: '200m kick with board' },
        { id: 'cooldown-swim', name: '200m easy freestyle' },
      ],
    };
  }
  if (isCardio) {
    return {
      title: isFatLoss ? 'Fat-burn HIIT' : 'Conditioning circuit',
      description: '25–30 min high-intensity intervals — torches calories and sharpens cardio capacity.',
      type: 'Cardio',
      exercises: [
        { id: 'jumping-jacks', name: 'Jumping jacks — 60s' },
        { id: 'mountain-climbers', name: 'Mountain climbers — 45s' },
        { id: 'burpees', name: 'Burpees — 30s' },
        { id: 'high-knees', name: 'High knees — 45s' },
        { id: 'jump-squats', name: 'Jump squats — 40s' },
        { id: 'plank', name: 'Plank hold — 60s' },
        { id: 'shadow-box', name: 'Shadow boxing — 90s' },
        { id: 'cool-walk', name: 'Cooldown walk — 3 min' },
      ],
    };
  }
  if (isUpper) {
    return {
      title: 'Upper body strength',
      description: 'Push-pull focus — chest, back, shoulders, arms. 45 min total.',
      type: 'Strength',
      exercises: [
        { id: 'bench-press', name: 'Bench press — 4 sets' },
        { id: 'bent-row', name: 'Bent-over row — 4 sets' },
        { id: 'overhead-press', name: 'Overhead press — 3 sets' },
        { id: 'lat-pulldown', name: 'Lat pulldown — 3 sets' },
        { id: 'dumbbell-curl', name: 'Dumbbell curl — 3 sets' },
        { id: 'tricep-pushdown', name: 'Tricep pushdown — 3 sets' },
      ],
    };
  }
  if (isLower) {
    return {
      title: 'Lower body power',
      description: 'Squat-hinge focused session — quads, glutes, hamstrings. 50 min.',
      type: 'Strength',
      exercises: [
        { id: 'back-squat', name: 'Back squat — 4 sets' },
        { id: 'romanian-deadlift', name: 'Romanian deadlift — 4 sets' },
        { id: 'walking-lunge', name: 'Walking lunge — 3 sets' },
        { id: 'leg-press', name: 'Leg press — 3 sets' },
        { id: 'calf-raise', name: 'Calf raise — 3 sets' },
        { id: 'plank', name: 'Plank — 3 x 45s' },
      ],
    };
  }
  if (isMuscle) {
    return {
      title: 'Full-body hypertrophy',
      description: 'Compound-led session for size and strength. 50–60 min.',
      type: 'Strength',
      exercises: [
        { id: 'squat', name: 'Back squat — 4 sets' },
        { id: 'bench-press', name: 'Bench press — 4 sets' },
        { id: 'deadlift', name: 'Conventional deadlift — 3 sets' },
        { id: 'pullup', name: 'Pull-ups — 3 sets' },
        { id: 'overhead-press', name: 'Overhead press — 3 sets' },
        { id: 'farmer-carry', name: 'Farmer carry — 3 x 40m' },
      ],
    };
  }
  // Default balanced session
  return {
    title: 'Total body builder',
    description: 'Balanced strength + conditioning session, 40 min.',
    type: 'Strength',
    exercises: [
      { id: 'goblet-squat', name: 'Goblet squat — 3 sets' },
      { id: 'pushup', name: 'Push-ups — 3 sets' },
      { id: 'dumbbell-row', name: 'Dumbbell row — 3 sets' },
      { id: 'glute-bridge', name: 'Glute bridge — 3 sets' },
      { id: 'plank', name: 'Plank — 3 x 45s' },
      { id: 'kettlebell-swing', name: 'Kettlebell swing — 3 x 20' },
    ],
  };
};

export const generateWorkoutPlan = async (userGoals: string, userHistory: any[] = []) => {
  const fallback = heuristicWorkout(userGoals);
  let result: any = fallback;
  if (useProxy) {
    try { result = await callProxy('generateWorkoutPlan', { userGoals, userHistory }); }
    catch { return fallback; }
  } else {
    const ctx = userHistory.length ? JSON.stringify(userHistory.slice(-3)) : 'Starting fresh.';
    result = await direct(
      `Generate a workout for goal: ${userGoals}. Context: ${ctx}.
Return ONLY valid JSON: {"title": string, "description": string, "type": string,
"exercises": [{"id": string, "name": string}]}`,
      fallback,
    );
  }
  // If Gemini returned the fallback shape with no exercises, swap in the heuristic plan.
  if (!result || !Array.isArray(result.exercises) || result.exercises.length === 0) {
    return fallback;
  }
  return result;
};

export const generateMealPlan = async (dietaryPreferences: string, kCalTarget: number) => {
  const fallback: any[] = [];
  if (useProxy) {
    try { return await callProxy('generateMealPlan', { dietaryPreferences, kCalTarget }); }
    catch { return fallback; }
  }
  return direct(
    `Generate a 7-day meal plan. Preferences: ${dietaryPreferences}. Target: ${kCalTarget} kcal/day.
Return ONLY a valid JSON array of 7 objects:
[{"day": string, "breakfast": string, "lunch": string, "dinner": string, "snack": string, "calories": number}]`,
    fallback,
  );
};

export const getRecipe = async (mealName: string) =>
  // A recipe for a given dish is stable — cache it (only when we got a real one).
  memoize(`recipe:${mealName.trim().toLowerCase()}`, DAY_MS, () =>
    getRecipeUncached(mealName), (r) => !!r);

const getRecipeUncached = async (mealName: string) => {
  const fallback = null;
  if (useProxy) {
    try { return await callProxy('getRecipe', { mealName }); }
    catch { return fallback; }
  }
  return direct(
    `Healthy recipe for "${mealName}". Return ONLY valid JSON:
{"ingredients": string[], "instructions": string[], "prepTime": string, "protein": number, "carbs": number, "fats": number}`,
    fallback,
  );
};

export const getAICoachInsight = async (summary: { calories: number; water: number; workouts: number; streak: number }) => {
  const fallback = 'Stay consistent — every rep compounds your results.';
  if (useProxy) {
    try {
      const r = await callProxy('getAICoachInsight', summary);
      return typeof r === 'string' ? r : (r?.text || fallback);
    } catch { return fallback; }
  }
  return directRaw(
    `You are an elite fitness AI. Give ONE sharp, motivational insight (max 20 words) based on:
Calories today: ${summary.calories}, Water: ${summary.water}ml, Workouts: ${summary.workouts}, Streak: ${summary.streak} days.
Return ONLY plain text, no JSON.`,
    fallback,
  );
};

export interface FormFeedback {
  exercise: string;
  rating: number;
  status: 'good' | 'fix' | 'danger';
  cue: string;
  details?: string;
}

export const analyzeFormFrame = async (
  base64Image: string,
  exerciseName: string,
  mimeType = 'image/jpeg',
): Promise<FormFeedback> => {
  const fallback: FormFeedback = {
    exercise: exerciseName,
    rating: 0,
    status: 'fix',
    cue: 'Show your full body for a check.',
  };
  if (useProxy) {
    try { return await callProxy('analyzeFormFrame', { base64Image, mimeType, exerciseName }) as FormFeedback; }
    catch { return fallback; }
  }
  return direct(
    {
      parts: [
        { inlineData: { data: base64Image, mimeType } },
        {
          text: `You are an elite strength coach. Analyze ONLY this exact frame for ${exerciseName} form.
Return ONLY valid JSON, no markdown:
{"exercise":"${exerciseName}","rating":<1-10 form score>,"status":"good"|"fix"|"danger","cue":"<single short coaching cue, max 12 words, imperative voice>","details":"<one optional secondary detail, max 18 words>"}
If no person visible, return rating 0 status "fix" cue "Step into frame so I can see your full body."`,
        },
      ],
    },
    fallback,
  ) as Promise<FormFeedback>;
};

// Heuristic swap pool — keyed by meal type so a "breakfast" swap never suggests dinner.
// We rotate based on what the user is replacing so consecutive swaps give different results.
const SWAP_POOL: Record<string, { name: string; calories: number; protein: number; carbs: number; fats: number }[]> = {
  breakfast: [
    { name: 'Oatmeal with blueberries and almonds', calories: 320, protein: 12, carbs: 45, fats: 10 },
    { name: 'Greek yogurt with honey and walnuts',  calories: 280, protein: 18, carbs: 30, fats: 9  },
    { name: 'Vegetable omelette with whole grain toast', calories: 360, protein: 22, carbs: 28, fats: 16 },
    { name: 'Protein smoothie with banana and oats', calories: 380, protein: 28, carbs: 50, fats: 6 },
    { name: 'Avocado toast with poached eggs', calories: 420, protein: 18, carbs: 35, fats: 22 },
    { name: 'Cottage cheese with mixed berries and chia', calories: 260, protein: 22, carbs: 24, fats: 7 },
    { name: 'Whole grain pancakes with peanut butter', calories: 440, protein: 14, carbs: 58, fats: 16 },
    { name: 'Scrambled eggs with smoked salmon', calories: 350, protein: 28, carbs: 4, fats: 24 },
    { name: 'Chia seed pudding with mango', calories: 290, protein: 8, carbs: 38, fats: 12 },
    { name: 'Breakfast burrito with eggs and beans', calories: 480, protein: 24, carbs: 50, fats: 20 },
  ],
  lunch: [
    { name: 'Grilled chicken salad with quinoa', calories: 480, protein: 38, carbs: 35, fats: 18 },
    { name: 'Tuna wrap with greens and hummus', calories: 420, protein: 28, carbs: 42, fats: 14 },
    { name: 'Salmon bowl with brown rice and broccoli', calories: 540, protein: 35, carbs: 50, fats: 18 },
    { name: 'Turkey and avocado sandwich', calories: 460, protein: 28, carbs: 40, fats: 18 },
    { name: 'Lentil soup with whole grain bread', calories: 380, protein: 18, carbs: 55, fats: 8 },
    { name: 'Tofu stir-fry with brown rice', calories: 480, protein: 22, carbs: 65, fats: 14 },
    { name: 'Chicken burrito bowl with black beans', calories: 580, protein: 38, carbs: 65, fats: 18 },
    { name: 'Shrimp and quinoa bowl', calories: 440, protein: 32, carbs: 45, fats: 12 },
    { name: 'Falafel pita with tahini sauce', calories: 520, protein: 18, carbs: 60, fats: 22 },
    { name: 'Greek salad with grilled chicken', calories: 420, protein: 32, carbs: 18, fats: 24 },
  ],
  dinner: [
    { name: 'Baked salmon with sweet potato and asparagus', calories: 580, protein: 40, carbs: 45, fats: 22 },
    { name: 'Grilled chicken with roasted vegetables', calories: 520, protein: 42, carbs: 35, fats: 20 },
    { name: 'Lean beef stir-fry with brown rice', calories: 620, protein: 38, carbs: 55, fats: 22 },
    { name: 'Whole wheat pasta with turkey meatballs', calories: 580, protein: 35, carbs: 65, fats: 16 },
    { name: 'Tofu curry with basmati rice', calories: 540, protein: 22, carbs: 70, fats: 18 },
    { name: 'Shrimp tacos with cabbage slaw', calories: 480, protein: 30, carbs: 45, fats: 18 },
    { name: 'Roast chicken with quinoa and greens', calories: 540, protein: 40, carbs: 45, fats: 18 },
    { name: 'Cod with lemon, potatoes and spinach', calories: 460, protein: 36, carbs: 38, fats: 14 },
    { name: 'Eggplant parmesan with side salad', calories: 520, protein: 22, carbs: 45, fats: 26 },
    { name: 'Pork tenderloin with sweet potato mash', calories: 500, protein: 38, carbs: 40, fats: 18 },
  ],
  snack: [
    { name: 'Apple with almond butter', calories: 220, protein: 5, carbs: 28, fats: 11 },
    { name: 'Greek yogurt with chia seeds', calories: 180, protein: 18, carbs: 14, fats: 6 },
    { name: 'Protein shake with banana', calories: 240, protein: 25, carbs: 30, fats: 4 },
    { name: 'Carrots with hummus', calories: 160, protein: 5, carbs: 22, fats: 7 },
    { name: 'Mixed nuts and dried fruit', calories: 200, protein: 5, carbs: 18, fats: 13 },
    { name: 'Cottage cheese with peach', calories: 150, protein: 14, carbs: 14, fats: 4 },
    { name: 'Boiled eggs with cucumber', calories: 170, protein: 13, carbs: 4, fats: 11 },
    { name: 'Edamame with sea salt', calories: 180, protein: 17, carbs: 14, fats: 8 },
    { name: 'Turkey jerky and apple slices', calories: 190, protein: 18, carbs: 22, fats: 3 },
    { name: 'Dark chocolate and almonds', calories: 230, protein: 6, carbs: 18, fats: 17 },
  ],
};

const heuristicSwap = (original: string, mealType: string) => {
  const pool = SWAP_POOL[mealType.toLowerCase()] || SWAP_POOL.lunch;
  // Skip whatever is currently selected so swap never returns the same meal.
  const candidates = pool.filter(m => m.name.toLowerCase() !== original.toLowerCase());
  return candidates[Math.floor(Math.random() * candidates.length)];
};

export const swapMeal = async (original: string, reason: string, dietaryPreferences: string) => {
  // Infer meal type from the reason string ("Replace this breakfast", etc.)
  const lower = reason.toLowerCase();
  const mealType =
    lower.includes('breakfast') ? 'breakfast' :
    lower.includes('lunch')     ? 'lunch'     :
    lower.includes('dinner')    ? 'dinner'    :
    lower.includes('snack')     ? 'snack'     : 'lunch';

  const fallback = heuristicSwap(original, mealType);

  let result: any = fallback;
  if (useProxy) {
    try { result = await callProxy('swapMeal', { original, reason, dietaryPreferences }); }
    catch { return fallback; }
  } else {
    result = await direct(
      `Suggest ONE alternative ${mealType} meal that replaces "${original}". Reason: ${reason}. Preferences: ${dietaryPreferences}. Do NOT return "${original}" — return a different dish.
Return ONLY valid JSON: {"name": string, "calories": number, "protein": number, "carbs": number, "fats": number, "why": string}`,
      fallback,
    );
  }

  // If the AI gave back the same name (or no name), force a fresh pick.
  if (!result?.name || result.name.toLowerCase() === original.toLowerCase()) {
    return fallback;
  }
  return result;
};

export interface CoachChatMessage { role: 'user' | 'coach'; text: string; }

// Heuristic, on-device coach replies for when Gemini is unavailable. We pattern-match
// the question against common training/nutrition topics and respond with concrete,
// goal-aware guidance — never "I'm offline".
const heuristicCoachReply = (
  message: string,
  profile: { goal?: string; weight?: number; age?: number },
): string => {
  const q = message.toLowerCase();
  const goal = profile.goal || 'general fitness';
  const weight = profile.weight || 70;
  const proteinG = Math.round(weight * (goal === 'muscle_gain' ? 2.0 : goal === 'fat_loss' ? 1.8 : 1.6));
  const kcal = goal === 'fat_loss' ? 1800 : goal === 'muscle_gain' ? 2800 : 2200;

  if (/(protein|muscle|build|gain)/.test(q))
    return `For ${goal.replace('_', ' ')}, aim for around ${proteinG}g of protein a day spread across 3–4 meals. Hit progressive overload twice per major muscle group weekly, and sleep 7+ hours so the work compounds.`;
  if (/(weight|fat|lose|cut|deficit)/.test(q))
    return `Cleanest fat loss path: a moderate ${kcal} kcal target, 3 strength sessions a week to preserve muscle, and 8–10k daily steps. Track for two weeks before adjusting — most people change their plan too early.`;
  if (/(cardio|run|hiit|endurance|stamina)/.test(q))
    return `Mix one long easy session (60–90 min, conversational pace) with one short hard session (4–6 x 2 min hard / 2 min easy) per week. Easy days build the engine, hard days raise your ceiling.`;
  if (/(sleep|rest|recover|sore)/.test(q))
    return `Recovery is the rep you can't skip. Lock 7–9 hours, keep your bedroom dark and cool, and stop screens 45 min before bed. If you're sore, an easy walk and 500ml of water move you forward more than another hard session.`;
  if (/(water|hydrate|hydration|drink)/.test(q))
    return `Target around ${Math.round(weight * 35)}ml of water daily, more on training days. Drink 500ml first thing in the morning and another 500ml 60 min before training — that solves 80% of energy slumps.`;
  if (/(form|squat|deadlift|bench|press)/.test(q))
    return `For any big lift: brace your core like you're about to be punched, drive through your full foot, and move the bar in a straight line. Film a side angle for one set — most form fixes are visible in 10 seconds of footage.`;
  if (/(meal|eat|food|nutrition|diet)/.test(q))
    return `Build each meal with a palm of protein, two fists of veg, a fist of carbs, and a thumb of fats. That structure hits your ${kcal} kcal target without you ever counting — and gets you ${proteinG}g of protein on autopilot.`;
  if (/(motivat|tired|stuck|plateau|burn)/.test(q))
    return `Plateaus and slumps are signal, not failure. Shrink the next session — 20 minutes, one lift, two exercises. Momentum beats motivation every time, and showing up small rebuilds the habit fastest.`;
  if (/(stretch|mobility|flex|tight)/.test(q))
    return `Two 5-minute mobility blocks a day beats one long session a week. Hit hips, t-spine, and ankles — those three unlock 90% of squat, deadlift, and overhead range.`;
  if (/(stress|anxiety|calm|mind)/.test(q))
    return `Stress and training stress share the same bucket. On rough days, swap intensity for a 30 min Zone-2 walk plus 4-7-8 breathing (4 in, 7 hold, 8 out, ×4). You'll still adapt without overloading the nervous system.`;
  return `For your ${goal.replace('_', ' ')} goal, the biggest levers are: ${proteinG}g protein daily, 3 strength sessions a week, 7+ hours sleep, and ${Math.round(weight * 35)}ml water. Pick the weakest of those four this week and fix it — that's where your next jump comes from.`;
};

export const askCoach = async (
  message: string,
  history: CoachChatMessage[],
  profile: { goal?: string; weight?: number; age?: number } = {},
): Promise<string> => {
  const fallback = heuristicCoachReply(message, profile);
  if (useProxy) {
    try {
      const r = await callProxy('askCoach', { message, history, profile });
      const text = typeof r === 'string' ? r : (r?.text || '');
      return text.trim() || fallback;
    } catch { return fallback; }
  }
  const transcript = history.slice(-8).map(m => `${m.role === 'user' ? 'User' : 'Coach'}: ${m.text}`).join('\n');
  const aiResp = await directRawRetry(
    `You are FitFlow Coach — an expert in strength training, nutrition, recovery, and behavior change.
The user's goal is ${profile.goal || 'general fitness'}. Weight: ${profile.weight || 'n/a'}kg. Age: ${profile.age || 'n/a'}.
Be direct, practical, and motivating. Reply in 2–4 sentences. Use plain language, no markdown, no emojis.

${transcript ? 'Conversation so far:\n' + transcript + '\n\n' : ''}User: ${message}
Coach:`,
    { retries: 1, minChars: 15 },
  );
  // Strip any stray markdown the model occasionally adds, then guarantee a
  // substantive answer — the heuristic reply is always on-topic and concrete.
  const clean = (aiResp || '').replace(/[*_`#]/g, '').trim();
  return clean.length >= 15 ? clean : fallback;
};

export interface DailyChallenge {
  title: string;
  description: string;
  target: number;
  unit: string;
  category: 'movement' | 'nutrition' | 'recovery' | 'mindfulness';
}

export const generateDailyChallenge = async (profile: { goal?: string; streak?: number } = {}): Promise<DailyChallenge> => {
  const fallback: DailyChallenge = {
    title: 'Move 30 minutes',
    description: 'Any sustained movement — walk, lift, ride. Consistency over intensity.',
    target: 30,
    unit: 'minutes',
    category: 'movement',
  };
  if (useProxy) {
    try { return await callProxy('dailyChallenge', { profile }) as DailyChallenge; }
    catch { return fallback; }
  }
  return direct(
    `Generate ONE specific, doable daily fitness micro-challenge for someone with goal "${profile.goal || 'general fitness'}" and a ${profile.streak || 0}-day streak.
Pick something they can finish in a single day. Vary the category.
Return ONLY valid JSON: {"title":"<8 words max>","description":"<one short sentence>","target":<number>,"unit":"<short unit string>","category":"movement"|"nutrition"|"recovery"|"mindfulness"}`,
    fallback,
  ) as Promise<DailyChallenge>;
};

export interface WeeklyRecap {
  headline: string;
  highlight: string;
  win: string;
  focus: string;
  nextStep: string;
}

export const generateWeeklyRecap = async (data: {
  workouts: number;
  workoutMinutes: number;
  caloriesBurned: number;
  caloriesConsumed: number;
  waterMl: number;
  sleepHours: number;
  streak: number;
  goal?: string;
  topExercise?: string;
}): Promise<WeeklyRecap> => {
  const fallback: WeeklyRecap = {
    headline: 'A solid week of work.',
    highlight: "You showed up and put in real effort this week. Keep that momentum.",
    win: 'Consistency built more progress than any single session.',
    focus: 'Hydration — small daily wins compound.',
    nextStep: 'Set a 10am hydration alarm and refill once before lunch.',
  };
  if (useProxy) {
    try { return await callProxy('generateWeeklyRecap', data) as WeeklyRecap; }
    catch { return fallback; }
  }
  return direct(
    `You are an elite performance coach writing a friendly weekly recap.
Goal: ${data.goal || 'general fitness'}. This week:
- ${data.workouts} workouts, ${data.workoutMinutes} active minutes
- ${data.caloriesBurned} kcal burned, ${data.caloriesConsumed} consumed
- ${data.waterMl}ml water, ${data.sleepHours} hours sleep
- ${data.streak}-day streak${data.topExercise ? `, top exercise: ${data.topExercise}` : ''}

Return ONLY valid JSON, no markdown:
{"headline":"<≤8 word title>","highlight":"<1-2 sentence summary in plain English, sentence case>","win":"<1 short positive observation>","focus":"<one thing to focus on next week, plain language>","nextStep":"<one specific action they can take Monday>"}
Tone: warm, direct, like a real human coach. No emojis.`,
    fallback,
  ) as Promise<WeeklyRecap>;
};

// ---------------------------------------------------------------------------
// Proactive Coach Briefing — the moat feature.
//
// The deterministic engine (coachBriefing.ts) decides WHAT to surface; Gemini
// only rewrites the copy in the coach's voice. Structure (which nudges, their
// actions/order) is never delegated to the model, so the result is always valid
// and the feature works perfectly with zero AI calls (quota'd / offline). Never
// throws — always returns at least one actionable nudge.
// ---------------------------------------------------------------------------
export type { CoachContext, CoachBriefing } from "./coachBriefing";

export const getCoachBriefing = async (ctx: CoachContext): Promise<CoachBriefing> => {
  const base = buildBriefing(ctx);
  if (useProxy) {
    try { return applyPolish(base, await callProxy('coachBriefing', { ctx, base })); }
    catch { return base; }
  }
  if (!ai) return base;

  const nudgeBrief = base.nudges.map(n => ({ id: n.id, title: n.title, message: n.message }));
  const polished = await direct(
    `You are FitFlow Coach. Rewrite this daily briefing in your own voice: direct, warm, specific, motivating.
Plain text only — no markdown, no emojis. Keep each "message" to ONE or TWO short sentences.
Preserve every "id" EXACTLY. Do NOT add, drop, or reorder nudges, and do NOT change any numbers or targets mentioned.
User goal: ${ctx.goal || 'general fitness'}.
Briefing to rewrite:
${JSON.stringify({ headline: base.headline, subtitle: base.subtitle, nudges: nudgeBrief })}
Return ONLY valid JSON, same shape: {"headline":string,"subtitle":string,"nudges":[{"id":string,"title":string,"message":string}]}`,
    null,
  );
  return applyPolish(base, polished);
};

// ---------------------------------------------------------------------------
// Quick-add — natural-language meal logging ("2 eggs, toast and a banana").
//
// Tries a single AI multi-item parse first (handles quantities and unknown
// foods), then falls back to resolving each phrase through the curated local DB
// and USDA. Every item is sanitised by quickAddUtils, so the result is always a
// valid QuickAddResult. Never throws — worst case returns an empty result.
// ---------------------------------------------------------------------------
export type { QuickAddResult, QuickAddItem } from "./quickAddUtils";

export const parseQuickAdd = async (text: string): Promise<QuickAddResult> =>
  // Same phrase → same parse. Cache only successful parses (items found) so an
  // empty result is never pinned and the user can retry into a real answer.
  memoize(`quickadd:${text.trim().toLowerCase()}`, DAY_MS, () =>
    parseQuickAddUncached(text), (r) => r.items.length > 0);

const parseQuickAddUncached = async (text: string): Promise<QuickAddResult> => {
  const phrases = splitPhrases(text);
  if (phrases.length === 0) return buildResult([], undefined);

  // 1) AI multi-item parse.
  const tryAi = async (): Promise<QuickAddItem[] | null> => {
    const prompt =
      `Parse this meal description into individual food items with realistic nutrition.
Description: "${text}"
Estimate macros for the quantity stated; default to a typical single serving when no quantity is given.
Return ONLY a valid JSON array (no markdown):
[{"name":string,"calories":number,"protein":number,"carbs":number,"fats":number}]
If you cannot parse any food, return [].`;
    let raw: any = null;
    if (useProxy) {
      try { raw = await callProxy('quickAdd', { text }); } catch { return null; }
    } else if (ai) {
      raw = await direct(prompt, []);
    } else {
      return null;
    }
    if (!Array.isArray(raw)) return null;
    const items = raw.map((r) => normalizeItem({ ...r, source: 'AI' })).filter((i) => i.calories > 0);
    return items.length > 0 ? items : null;
  };

  const aiItems = await tryAi();
  if (aiItems) return buildResult(aiItems, 'AI');

  // 2) Deterministic fallback — resolve each phrase via local DB → USDA.
  const items: QuickAddItem[] = [];
  for (const phrase of phrases) {
    const local = searchLocalFoods(phrase);
    if (local.length > 0 && local[0].calories > 0) {
      items.push(normalizeItem({ ...local[0], source: 'local' }));
      continue;
    }
    try {
      const usda = await searchFood(phrase);
      const hit = usda.find((u) => u.calories > 0);
      if (hit) items.push(normalizeItem({ ...hit, source: 'usda' }));
    } catch { /* skip this phrase */ }
  }
  return buildResult(items, undefined);
};
