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
 *   • only people active in the last week are read at all, a page at a time,
 *   • AI gets the first part of each pass; the rest of the pass writes recaps
 *     from people's own numbers, so the free quota's ~18 a minute can't leave
 *     most of a large user base with nothing,
 *   • a time budget: the job stops cleanly before its timeout, and the next
 *     scheduled pass (hourly through Sunday) picks up whoever is left, because
 *     an existing recap is never regenerated.
 */
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./db";
import { unitsPromptLine } from "./unitsPrompt";
import { languageLineAfter } from "./languagePrompt";
import { pushText } from "./pushText";

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
  /** After this long, recaps come from the numbers alone, at fallbackBatchSize. */
  aiBudgetMs?: number;
  fallbackBatchSize?: number;
  pageSize?: number;
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

/**
 * A recap written from the numbers alone — used when every model is busy.
 * `units` and `language` follow the user doc (numbers stay metric in `stats`;
 * an unknown language is English, exactly as before).
 */
export const fallbackRecap = (s: WeekStats, streak: number, units?: unknown, language?: unknown): Recap => {
  const o = (units && typeof units === "object" ? units : {}) as Record<string, unknown>;
  const imperial = o.system === "imperial";
  const energy = (kcal: number) => o.energy === "kJ"
    ? `${Math.round(kcal * 4.184).toLocaleString("en-US")} kJ`
    : `${kcal.toLocaleString("en-US")} kcal`;
  // 1 US fl oz = 29.5735 ml (same factor as src/lib/units.ts).
  const water = (ml: number) => imperial ? `${Math.round(ml / 29.5735).toLocaleString("en-US")} fl oz` : `${(ml / 1000).toFixed(1)} L`;
  const L = language;
  // In English this reads exactly as it always did: "3 workouts, 90 active minutes, 600 kcal logged, 1.5 L of water."
  const parts = [
    pushText(L, s.workouts === 1 ? "recap.workouts.one" : "recap.workouts.other", { n: s.workouts }),
    ...(s.minutes ? [pushText(L, "recap.minutes", { n: s.minutes })] : []),
    ...(s.consumed ? [pushText(L, "recap.logged", { energy: energy(s.consumed) })] : []),
    ...(s.water ? [pushText(L, "recap.water", { water: water(s.water) })] : []),
  ];
  return {
    headline: pushText(L, s.workouts >= 3 ? "recap.headline.strong" : s.workouts > 0 ? "recap.headline.moving" : "recap.headline.logging"),
    highlight: parts.join(", ") + ".",
    win: streak >= 3 ? pushText(L, "recap.win.streak", { n: streak }) : pushText(L, "recap.win.logs"),
    focus: s.workouts < 2 ? pushText(L, "recap.focus.session") : s.water < 10_000
      ? pushText(L, imperial ? "recap.focus.waterImperial" : "recap.focus.waterMetric") : pushText(L, "recap.focus.sleep"),
    nextStep: pushText(L, s.workouts < 2 ? "recap.next.session" : "recap.next.breakfast"),
  };
};

/** `units` and `language` come from the user doc; the numbers stay metric, only the wording follows them. */
export const promptFor = (goal: string, s: WeekStats, streak: number, units?: unknown, language?: unknown) => `You are an elite performance coach writing a friendly weekly recap.
Goal: ${goal || "general fitness"}. This week:
- ${s.workouts} workouts, ${s.minutes} active minutes
- ${s.calories} kcal burned, ${s.consumed} consumed
- ${s.water}ml water, ${s.sleepHours} hours sleep
- ${streak}-day streak
${unitsPromptLine(units)}${languageLineAfter(language)}

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

  const aiBudgetMs = opts.aiBudgetMs ?? 15 * 60_000;
  const fallbackBatchSize = opts.fallbackBatchSize ?? 20;
  const pageSize = opts.pageSize ?? 200;
  // One day of slack, because lastActiveDay is the user's LOCAL date.
  const sinceDay = new Date(now - 8 * 86_400_000).toISOString().slice(0, 10);
  const query = db.collection("users")
    .where("notificationsEnabled", "==", true)
    .where("lastActiveDay", ">=", sinceDay);

  let inFlight = 0;
  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  for (;;) {
    if (Date.now() - started > budgetMs) { report.stoppedEarly = true; break; }
    const page: FirebaseFirestore.QuerySnapshot = await (last ? query.startAfter(last) : query).limit(pageSize).get();
    const users = page.docs.filter((d) => typeof d.data().fcmToken === "string" && d.data().fcmToken);
    report.eligible += users.length;
    let lastBatchCalledAi = false;

    for (let i = 0; i < users.length;) {
      if (Date.now() - started > budgetMs) { report.stoppedEarly = true; break; }
      const useAi = Date.now() - started <= aiBudgetMs;
      const size = useAi ? batchSize : fallbackBatchSize;
      const batch = users.slice(i, i + size);
      i += size;
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

          let recap: Recap | null = null;
          if (useAi) {
            inFlight++;
            report.maxConcurrent = Math.max(report.maxConcurrent, inFlight);
            calledAi = true;
            try {
              recap = parseRecap(await opts.writeRecap(promptFor(String(u.goal || ""), stats, streak, u.units, u.language)));
            } finally {
              inFlight--;
            }
          }
          const source = recap ? "ai" : "fallback";
          recap ||= fallbackRecap(stats, streak, u.units, u.language);

          await ref.set({ recap, stats, source, generatedAt: FieldValue.serverTimestamp() });
          report.written++;
          if (source === "ai") report.aiWritten++; else report.fallbackWritten++;
          await opts.sendPush(u.fcmToken, pushText(u.language, "recap.pushTitle"), recap.headline).catch((err) => {
            console.warn("recap push failed for", uid, err?.code || err);
          });
        } catch (err) {
          report.failed++;
          console.warn("recap failed for", uid, err);
        }
      }));

      lastBatchCalledAi = calledAi;
      if (i < users.length && calledAi && pauseMs > 0) await sleep(pauseMs);
    }
    if (report.stoppedEarly || page.size < pageSize) break;
    if (lastBatchCalledAi && pauseMs > 0) await sleep(pauseMs);
    last = page.docs[page.docs.length - 1];
  }
  return report;
};

