/**
 * Sunday weekly recaps: the batching core, separate from the schedule so the
 * proof can drive it with a fake AI.
 *
 * The old job ran every user at once on ONE model. The free Gemini tier allows
 * about 5 requests a minute per model, so beyond a handful of users nearly
 * every recap failed, and each failure was just logged and skipped. It also
 * read 5 queries for every account, including people with notifications off
 * who could never receive the push.
 *
 * Now:
 *   • only users with notifications on AND a device token,
 *   • users with no activity that week are skipped (no AI spend on an empty
 *     recap; the win-back push covers them),
 *   • small batches, paced to the per-model quota, through the same 4-model
 *     cascade the coach uses,
 *   • if every model is busy, the user still gets a recap written from their
 *     own numbers instead of nothing,
 *   • a time budget: the job stops cleanly before its timeout, and the next
 *     scheduled pass (hourly through Sunday) picks up whoever is left, because
 *     an existing recap is never regenerated.
 */
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./db";

export interface WeekStats {
  workouts: number;
  minutes: number;
  calories: number;
  consumed: number;
  water: number;
  sleepHours: number;
}

export interface Recap {
  headline: string;
  highlight: string;
  win: string;
  focus: string;
  nextStep: string;
}

export type RecapWriter = (prompt: string) => Promise<string | null>;
export type PushSender = (token: string, title: string, body: string) => Promise<void>;

export interface RecapRunOptions {
  weekId: string;
  now?: number;
  /** Users processed at once. */
  batchSize?: number;
  /** Pause between batches, so batchSize/pause stays under the model quota. */
  pauseMs?: number;
  /** Stop starting new batches after this long; the next pass continues. */
  budgetMs?: number;
  writeRecap: RecapWriter;
  sendPush: PushSender;
}

export interface RecapRunReport {
  eligible: number;
  written: number;
  aiWritten: number;
  fallbackWritten: number;
  skippedExisting: number;
  skippedInactive: number;
  failed: number;
  stoppedEarly: boolean;
  maxConcurrent: number;
}

const sum = (docs: FirebaseFirestore.QueryDocumentSnapshot[], f: string) =>
  docs.reduce((a, d) => a + (Number(d.data()[f]) || 0), 0);

const statsFor = async (uid: string, since: Date): Promise<WeekStats> => {
  const q = (c: string) => db.collection(c).where("userId", "==", uid).where("timestamp", ">=", since).get();
  const [workouts, meals, water, sleep] = await Promise.all([q("workouts"), q("meals"), q("water_logs"), q("sleep_logs")]);
  return {
    workouts: workouts.size,
    minutes: sum(workouts.docs, "duration"),
    calories: sum(workouts.docs, "caloriesBurned"),
    consumed: sum(meals.docs, "calories"),
    water: sum(water.docs, "amount"),
    sleepHours: sleep.size ? Math.round((sum(sleep.docs, "hours") / sleep.size) * 10) / 10 : 0,
  };
};

const isActive = (s: WeekStats) => s.workouts + s.consumed + s.water + s.sleepHours > 0;

/** A recap written from the numbers alone — used when every model is busy. */
export const fallbackRecap = (s: WeekStats, streak: number): Recap => ({
  headline: s.workouts >= 3 ? "A strong week of training." : s.workouts > 0 ? "You kept moving this week." : "A week of steady logging.",
  highlight:
    `${s.workouts} workout${s.workouts === 1 ? "" : "s"}` +
    (s.minutes ? `, ${s.minutes} active minutes` : "") +
    (s.consumed ? `, ${s.consumed.toLocaleString("en-US")} kcal logged` : "") +
    (s.water ? `, ${(s.water / 1000).toFixed(1)} L of water` : "") + ".",
  win: streak >= 3 ? `A ${streak}-day streak — consistency is doing the work.` : "Every log this week is data your plan can use.",
  focus: s.workouts < 2 ? "One more session than last week." : s.water < 10_000 ? "Hydration — aim for 2 L a day." : "Sleep — it is where training turns into progress.",
  nextStep: s.workouts < 2 ? "Put a 30-minute session in your calendar for Monday." : "Log breakfast before 10am on Monday.",
});

const promptFor = (goal: string, s: WeekStats, streak: number) => `You are an elite performance coach writing a friendly weekly recap.
Goal: ${goal || "general fitness"}. This week:
- ${s.workouts} workouts, ${s.minutes} active minutes
- ${s.calories} kcal burned, ${s.consumed} consumed
- ${s.water}ml water, ${s.sleepHours} hours sleep
- ${streak}-day streak

Return ONLY valid JSON:
{"headline":"<≤8 word title>","highlight":"<1-2 sentence summary>","win":"<1 short positive observation>","focus":"<one thing to focus on next week>","nextStep":"<one specific action they can take Monday>"}
Tone: warm, direct, like a real human coach. No emojis.`;

const parseRecap = (text: string | null): Recap | null => {
  if (!text) return null;
  try {
    const r = JSON.parse(text.replace(/```json|```/g, "").trim());
    const ok = ["headline", "highlight", "win", "focus", "nextStep"].every((k) => typeof r?.[k] === "string" && r[k].trim());
    return ok ? (r as Recap) : null;
  } catch {
    return null;
  }
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const runWeeklyRecaps = async (opts: RecapRunOptions): Promise<RecapRunReport> => {
  const now = opts.now ?? Date.now();
  const batchSize = opts.batchSize ?? 4;
  const pauseMs = opts.pauseMs ?? 13_000; // 4 per 13 s ≈ 18/min, under 4 models × 5/min
  const budgetMs = opts.budgetMs ?? 25 * 60_000;
  const since = new Date(now - 7 * 86_400_000);
  const started = Date.now();
  const report: RecapRunReport = {
    eligible: 0, written: 0, aiWritten: 0, fallbackWritten: 0, skippedExisting: 0,
    skippedInactive: 0, failed: 0, stoppedEarly: false, maxConcurrent: 0,
  };

  const snap = await db.collection("users").where("notificationsEnabled", "==", true).get();
  const users = snap.docs.filter((d) => typeof d.data().fcmToken === "string" && d.data().fcmToken);
  report.eligible = users.length;

  let inFlight = 0;
  for (let i = 0; i < users.length; i += batchSize) {
    if (Date.now() - started > budgetMs) { report.stoppedEarly = true; break; }
    const batch = users.slice(i, i + batchSize);
    let calledAi = false;

    await Promise.all(batch.map(async (doc) => {
      const uid = doc.id;
      const u = doc.data();
      const ref = db.doc(`weekly_recaps/${uid}_${opts.weekId}`);
      try {
        if ((await ref.get()).exists) { report.skippedExisting++; return; }
        const stats = await statsFor(uid, since);
        if (!isActive(stats)) { report.skippedInactive++; return; }
        const streak = Number(u.currentStreak ?? u.streak) || 0;

        inFlight++;
        report.maxConcurrent = Math.max(report.maxConcurrent, inFlight);
        calledAi = true;
        let recap: Recap | null;
        try {
          recap = parseRecap(await opts.writeRecap(promptFor(String(u.goal || ""), stats, streak)));
        } finally {
          inFlight--;
        }
        const source = recap ? "ai" : "fallback";
        recap ||= fallbackRecap(stats, streak);

        await ref.set({ recap, stats, source, generatedAt: FieldValue.serverTimestamp() });
        report.written++;
        if (source === "ai") report.aiWritten++; else report.fallbackWritten++;
        await opts.sendPush(u.fcmToken, "Your weekly recap is ready", recap.headline).catch((err) => {
          console.warn("recap push failed for", uid, err?.code || err);
        });
      } catch (err) {
        report.failed++;
        console.warn("recap failed for", uid, err);
      }
    }));

    const more = i + batchSize < users.length;
    if (more && calledAi && pauseMs > 0) await sleep(pauseMs);
  }
  return report;
};

