/**
 * Spend and overload protection for geminiProxy.
 *
 * Three independent limits, cheapest first:
 *   • models that just returned a quota error are left alone for a moment, so
 *     an overload isn't made worse by every waiting request retrying all four,
 *   • each user has a daily allowance, stored so it holds across server
 *     instances (the older per-minute limit lives in one instance's memory),
 *   • the whole app has a daily ceiling, which is the hard stop on a runaway
 *     bill. It counts requests, not dollars, so it bounds spend only as well as
 *     the average request cost is known.
 *
 * Refused requests get an error the app already handles by falling back to its
 * built-in answers, so old app versions degrade the same way.
 */
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./db";

const envInt = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 && process.env[name] !== "" && process.env[name] !== undefined ? n : fallback;
};

/** Set any of these in functions/.env to change it without a code change. */
export const AI_LIMITS = {
  get freeCallsPerDay() { return envInt("AI_FREE_CALLS_PER_DAY", 50); },
  get proCallsPerDay() { return envInt("AI_PRO_CALLS_PER_DAY", 300); },
  // Live form check samples a frame every 3 s: 200 is 10 minutes, 1200 an hour.
  get freeFramesPerDay() { return envInt("AI_FREE_FRAMES_PER_DAY", 200); },
  get proFramesPerDay() { return envInt("AI_PRO_FRAMES_PER_DAY", 1200); },
  // Wording only, for everyone. App versions before 1.6.4 ask on every Home visit
  // with no limit of their own, so the cap has to be here, and it is separate so
  // those requests can't use up the allowance for features people asked for.
  get briefingsPerDay() { return envInt("AI_BRIEFINGS_PER_DAY", 6); },
  // Free users can try the coach chat (it used to be a hard Pro wall, so most
  // never saw the app's best feature before the paywall).
  get freeCoachPerDay() { return envInt("AI_FREE_COACH_PER_DAY", 3); },
  get globalCallsPerDay() { return envInt("AI_GLOBAL_CALLS_PER_DAY", 1_000); },
};

/** Free users stop here, so paying users keep AI as the ceiling approaches. */
const FREE_SHARE_OF_GLOBAL = 0.8;
/** Cosmetic requests stop here, leaving the rest for what people asked for. */
const LOW_PRIORITY_SHARE_OF_GLOBAL = 0.5;

export type AiRefusal = "daily_limit" | "global_limit";
export type AiKind = "call" | "frame" | "briefing" | "coach";

const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);

// --- Per-user allowance -----------------------------------------------------

/**
 * Takes one unit of today's allowance, or refuses. Transactional, so a burst of
 * parallel requests can't all read the same count and slip past the limit.
 *
 * Stored under the user doc, so deleteUserData's recursive delete covers it, and
 * as one overwritten document, so it doesn't grow with each day of use.
 */
export const takeUserAllowance = async (
  uid: string,
  kind: AiKind,
  isPro: boolean,
  now = Date.now(),
): Promise<boolean> => {
  const limit = kind === "coach"
    ? AI_LIMITS.freeCoachPerDay
    : kind === "briefing"
    ? AI_LIMITS.briefingsPerDay
    : kind === "frame"
      ? (isPro ? AI_LIMITS.proFramesPerDay : AI_LIMITS.freeFramesPerDay)
      : (isPro ? AI_LIMITS.proCallsPerDay : AI_LIMITS.freeCallsPerDay);
  const ref = db.doc(`users/${uid}/private/ai_usage`);
  const day = dayKey(now);
  const field = kind === "frame" ? "frames" : kind === "briefing" ? "briefings" : kind === "coach" ? "coach" : "calls";
  // A burst from one user can make the database give up on the transaction.
  // That is a refusal, not a server error: paid AI fails closed.
  return db.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data();
    const sameDay = data?.day === day;
    const used = sameDay ? Number(data?.[field]) || 0 : 0;
    if (used >= limit) return false;
    tx.set(ref, {
      day,
      calls: sameDay ? Number(data?.calls) || 0 : 0,
      frames: sameDay ? Number(data?.frames) || 0 : 0,
      briefings: sameDay ? Number(data?.briefings) || 0 : 0,
      coach: sameDay ? Number(data?.coach) || 0 : 0,
      [field]: used + 1,
    });
    return true;
  }).catch((err) => {
    console.warn("AI allowance transaction failed for", uid, err?.code || err);
    return false;
  });
};

// --- App-wide daily ceiling -------------------------------------------------

// A single document can only take about one write a second, so the counter is
// split across shards and each request increments one at random.
const GLOBAL_SHARDS = 20;
const GLOBAL_READ_TTL_MS = 30_000;
let globalCache: { day: string; total: number; at: number } | null = null;
let warnedDay = "";

const readGlobalTotal = async (now: number, ttlMs: number): Promise<number> => {
  const day = dayKey(now);
  if (globalCache && globalCache.day === day && now - globalCache.at < ttlMs) return globalCache.total;
  const refs = Array.from({ length: GLOBAL_SHARDS }, (_, i) => db.doc(`ai_global_usage/${day}_${i}`));
  const snaps = await db.getAll(...refs);
  const total = snaps.reduce((sum, s) => sum + (Number(s.data()?.calls) || 0), 0);
  globalCache = { day, total, at: now };
  return total;
};

/**
 * Whether the app-wide ceiling allows this request. The total is cached per
 * instance, so the ceiling can overshoot by up to about 30 seconds of traffic.
 */
export const globalCeilingAllows = async (
  isPro: boolean,
  now = Date.now(),
  ttlMs = GLOBAL_READ_TTL_MS,
  lowPriority = false,
): Promise<boolean> => {
  const ceiling = AI_LIMITS.globalCallsPerDay;
  const total = await readGlobalTotal(now, ttlMs);
  if (total >= ceiling * FREE_SHARE_OF_GLOBAL && warnedDay !== dayKey(now)) {
    warnedDay = dayKey(now);
    console.error(`AI ceiling: ${total} of ${ceiling} calls used today; free users are now refused AI`);
  }
  if (lowPriority && total >= ceiling * LOW_PRIORITY_SHARE_OF_GLOBAL) return false;
  return total < (isPro ? ceiling : ceiling * FREE_SHARE_OF_GLOBAL);
};

export const countGlobalCall = async (now = Date.now()): Promise<void> => {
  const shard = Math.floor(Math.random() * GLOBAL_SHARDS);
  await db.doc(`ai_global_usage/${dayKey(now)}_${shard}`)
    .set({ calls: FieldValue.increment(1) }, { merge: true });
};

/** All the limits, in order. Null means go ahead. */
export const checkAiAllowance = async (
  uid: string,
  kind: AiKind,
  isPro: boolean,
  now = Date.now(),
  ttlMs = GLOBAL_READ_TTL_MS,
  lowPriority = false,
): Promise<AiRefusal | null> => {
  // The ceiling first: a refused request should not use up the user's allowance.
  if (!(await globalCeilingAllows(isPro, now, ttlMs, lowPriority))) return "global_limit";
  if (!(await takeUserAllowance(uid, kind, isPro, now))) return "daily_limit";
  await countGlobalCall(now);
  return null;
};

// --- Model cooldown ---------------------------------------------------------

const MODEL_COOLDOWN_MS = 20_000;
const coolingUntil = new Map<string, number>();

export const isQuotaError = (e: any): boolean =>
  Number(e?.status ?? e?.code) === 429 || /RESOURCE_EXHAUSTED/i.test(String(e?.message || e || ""));

export const coolModel = (model: string, now = Date.now()): void => {
  coolingUntil.set(model, now + MODEL_COOLDOWN_MS);
};

export const modelIsCooling = (model: string, now = Date.now()): boolean =>
  (coolingUntil.get(model) ?? 0) > now;

/** Seconds until a model is free, or 0 if one is free now. For Retry-After. */
export const secondsUntilAnyModel = (models: string[], now = Date.now()): number => {
  const waits = models.map((m) => (coolingUntil.get(m) ?? 0) - now);
  const soonest = Math.min(...waits);
  return soonest > 0 ? Math.ceil(soonest / 1000) : 0;
};

export const resetCooldowns = (): void => coolingUntil.clear();
