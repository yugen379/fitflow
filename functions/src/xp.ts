/**
 * Server-authoritative XP.
 *
 * Until v1.6.2 the app wrote `points`, `level` and `badges` itself and the
 * rules accepted any number, so a modified client could put 9,999,999 XP on
 * every user's leaderboard. The rules now refuse those fields from clients;
 * this callable is the only writer.
 *
 * The client never names an amount. It names WHAT happened ("I logged meal
 * X") and the server:
 *   1. checks record X exists and belongs to the caller,
 *   2. derives the XP from the record itself (water amount, route distance),
 *   3. awards each record at most once (ledger: users/{uid}/xp_awards),
 *   4. caps each activity type per local day (users/{uid}/xp_days).
 *
 * A self-logged fitness app cannot prove a meal was eaten, so this does not
 * make fake logging impossible. It makes it pointless: the most anyone can
 * earn per day is what an honest heavy user earns, and nobody can write a
 * score directly.
 */
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./db";

// --- Level curve. MUST match src/services/missionUtils.ts (proof:backend
// asserts the two agree for every total from 0 to 500,000). ----------------
const MAX_LEVEL = 99;
const xpForLevel = (level: number): number => {
  const n = Math.min(MAX_LEVEL, Math.max(1, Math.floor(level))) - 1;
  return n * 100 + (n * (n - 1) * 50) / 2;
};
export const levelFor = (points: number): number => {
  const p = Number.isFinite(points) && points > 0 ? Math.floor(points) : 0;
  let level = 1;
  while (level < MAX_LEVEL && p >= xpForLevel(level + 1)) level++;
  return level;
};

// Amounts match XP_AWARDS / the old client call sites, so honest users see
// no change in what they earn.
export const XP = { meal: 15, workout: 40, wellness: 30, badge: 150, onboarding: 100 };

/** Per local day, per activity type. Generous for real use, finite for abuse. */
export const DAILY_CAP: Record<string, number> = {
  meal: 120,      // 8 meals
  workout: 160,   // 4 sessions
  water: 160,     // 4 litres
  wellness: 60,   // 2 check-ins
  run: 5000,      // 50 km
};

/** Fastest believable average speed per route type, km/h. */
const MAX_KMH: Record<string, number> = { walk: 10, run: 25, cycle: 60 };

/** Every badge id in src/services/badgeService.ts ALL_BADGES. */
export const BADGE_IDS = [
  "pioneer", "social_butterfly", "challenge_accepted", "nutrition_master",
  "scanner_pro", "ai_chef", "macro_master", "hydration_hero", "sleep_master",
  "wellness_zen", "iron_will", "calorie_crusher", "week_warrior", "marathoner",
  "early_bird", "night_owl", "streak_3", "streak_7", "streak_30", "centurion",
  "level_5", "comeback_kid",
];

const RECORD_COLLECTION: Record<string, string> = {
  meal: "meals",
  workout: "workouts",
  water: "water_logs",
  wellness: "wellness_logs",
  run: "activity_routes",
};

type Reason = "meal" | "workout" | "water" | "wellness" | "run" | "badge" | "onboarding";
const REASONS: Reason[] = ["meal", "workout", "water", "wellness", "run", "badge", "onboarding"];

export interface XpResult {
  awarded: number;
  points: number;
  level: number;
  duplicate?: boolean;
  capped?: boolean;
  badgeGranted?: boolean;
}

/** 'YYYY-MM-DD' on the user's own clock, matching how the app keys its days. */
const localDay = (tzOffsetHours: unknown): string => {
  const off = typeof tzOffsetHours === "number" && Number.isFinite(tzOffsetHours) ? tzOffsetHours : 0;
  return new Date(Date.now() + off * 3_600_000).toISOString().slice(0, 10);
};

/** XP a record is worth, read from the record itself. */
const xpForRecord = (reason: Reason, rec: Record<string, any>): number => {
  switch (reason) {
    case "meal": return XP.meal;
    case "workout": return XP.workout;
    case "wellness": return XP.wellness;
    case "water": {
      const ml = Number(rec.amount);
      return Number.isFinite(ml) && ml > 0 ? Math.floor(Math.min(ml, 2000) / 25) : 0;
    }
    case "run": {
      const km = Number(rec.distance);
      const seconds = Number(rec.duration);
      if (!Number.isFinite(km) || km <= 0 || !Number.isFinite(seconds) || seconds <= 0) return 0;
      const kmh = km / (seconds / 3600);
      const max = MAX_KMH[String(rec.type)] ?? MAX_KMH.run;
      // A 40 km "run" in 10 minutes is a forged record, not a fast athlete.
      if (kmh > max) return 0;
      return Math.floor(km * 100);
    }
    default: return 0;
  }
};

/**
 * Badges whose condition the server can check from the user doc. The rest are
 * granted once each on the client's word: 150 XP x 22 badges is a hard,
 * one-time ceiling, so trusting them cannot inflate a score without bound.
 */
const badgeConditionMet = (badgeId: string, u: Record<string, any>): boolean => {
  const points = Number(u.points) || 0;
  const streak = Math.max(Number(u.currentStreak) || 0, Number(u.streak) || 0);
  switch (badgeId) {
    case "centurion": return points >= 1000;
    case "level_5": return levelFor(points) >= 5;
    case "streak_3": return streak >= 3;
    case "streak_7": return streak >= 7;
    case "streak_30": return streak >= 30;
    default: return true;
  }
};

/** Core award logic, shared by the callable and the proof harness. */
export const awardXpFor = async (uid: string, reason: Reason, refId: string): Promise<XpResult> => {
  const userRef = db.doc(`users/${uid}`);
  const ledgerKey = reason === "onboarding" ? "onboarding" : `${reason}_${refId}`;
  const ledgerRef = userRef.collection("xp_awards").doc(ledgerKey);

  return db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new HttpsError("not-found", "Profile not found");
    const u = userSnap.data() as Record<string, any>;
    const points = Number(u.points) || 0;

    const ledger = await tx.get(ledgerRef);
    if (ledger.exists) return { awarded: 0, points, level: levelFor(points), duplicate: true };

    let xp = 0;
    let capped = false;
    let badge: string | null = null;
    const day = localDay(u.tzOffsetHours);
    const dayRef = userRef.collection("xp_days").doc(day);

    if (reason === "onboarding") {
      xp = XP.onboarding;
      badge = "pioneer";
    } else if (reason === "badge") {
      if (!BADGE_IDS.includes(refId)) throw new HttpsError("invalid-argument", "Unknown badge");
      const owned: string[] = Array.isArray(u.badges) ? u.badges : [];
      if (owned.includes(refId)) return { awarded: 0, points, level: levelFor(points), duplicate: true };
      if (!badgeConditionMet(refId, u)) throw new HttpsError("failed-precondition", "Badge not earned yet");
      xp = XP.badge;
      badge = refId;
    } else {
      const recSnap = await tx.get(db.doc(`${RECORD_COLLECTION[reason]}/${refId}`));
      if (!recSnap.exists || recSnap.data()?.userId !== uid) {
        throw new HttpsError("permission-denied", "That record is not yours");
      }
      const earned = xpForRecord(reason, recSnap.data() as Record<string, any>);
      const daySnap = await tx.get(dayRef);
      const used = Number(daySnap.data()?.[reason]) || 0;
      const room = Math.max(0, DAILY_CAP[reason] - used);
      xp = Math.min(earned, room);
      capped = earned > room;
      if (xp > 0) tx.set(dayRef, { [reason]: used + xp }, { merge: true });
    }

    // Written even when xp is 0, so a capped or forged record is not retried.
    tx.set(ledgerRef, {
      reason, refId, xp, day,
      at: FieldValue.serverTimestamp(),
    });

    const nextPoints = points + xp;
    const update: Record<string, any> = { points: nextPoints, level: levelFor(nextPoints) };
    if (badge) update.badges = FieldValue.arrayUnion(badge);
    tx.update(userRef, update);

    return {
      awarded: xp,
      points: nextPoints,
      level: levelFor(nextPoints),
      ...(capped ? { capped: true } : {}),
      ...(badge ? { badgeGranted: true } : {}),
    };
  });
};

export const awardXp = onCall(async (request): Promise<XpResult> => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required");
  const { reason, refId } = (request.data || {}) as { reason?: unknown; refId?: unknown };
  if (typeof reason !== "string" || !REASONS.includes(reason as Reason)) {
    throw new HttpsError("invalid-argument", "Unknown reason");
  }
  const id = typeof refId === "string" ? refId : "";
  if (reason !== "onboarding" && !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new HttpsError("invalid-argument", "Bad record id");
  }
  return awardXpFor(uid, reason as Reason, id);
});
