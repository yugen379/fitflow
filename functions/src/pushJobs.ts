/**
 * Scheduled push jobs: the selection and paging core, separate from the
 * schedule so the proof can drive it with a fake sender.
 *
 * These jobs used to load every user with notifications on into memory, every
 * 30 minutes, then start one send per user at once. That is fine for a few
 * hundred users. At 100,000 it costs 9.6M reads a day for two jobs alone, and
 * would be expected to run out of memory or time before reaching most people.
 *
 * Now:
 *   • each query asks only for users who could be due, using fields kept by
 *     syncPublicProfile (pushTzBucket, pushReminderHourUtc),
 *   • results are read a page at a time and sent with bounded concurrency,
 *   • a time budget stops a run cleanly before the platform kills it.
 *
 * The queries only NARROW the candidates. Whether someone gets a push is still
 * decided per user by decideNudge, so a query can make a job cheaper but cannot
 * invent a send. `npm run proof:backend` compares it against a full scan.
 */
import { FieldValue, Query, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { db } from "./db";
// Push text in the user doc's `language` (English, unchanged, by default).
import { pushText, type PushTextKey } from "./pushText";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export interface PushContent {
  title: string;
  body: string;
  type: string;
}
export type PushSend = (token: string, push: PushContent) => Promise<void>;

export interface JobReport {
  /** User documents read: what this job costs. */
  candidates: number;
  sent: number;
  failed: number;
  stoppedEarly: boolean;
}

export interface JobOptions {
  now?: number;
  /** Stop starting new pages after this long; a run can't outlive its timeout. */
  budgetMs?: number;
  pageSize?: number;
  concurrency?: number;
  send: PushSend;
  /** False: decide and report without writing, for the proof's comparison. */
  stamp?: boolean;
  /** Called with each uid that would be pushed. */
  onDecision?: (uid: string, push: PushContent) => void;
}

const newReport = (): JobReport => ({ candidates: 0, sent: 0, failed: 0, stoppedEarly: false });

const runPool = async <T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) => {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
};

/** Walks a query a page at a time, so memory stays flat however many match. */
export const forEachPage = async (
  query: Query,
  pageSize: number,
  deadline: number,
  report: { candidates: number; stoppedEarly: boolean },
  handlePage: (docs: QueryDocumentSnapshot[]) => Promise<void>,
): Promise<void> => {
  let last: QueryDocumentSnapshot | null = null;
  for (;;) {
    if (Date.now() > deadline) { report.stoppedEarly = true; return; }
    const paged: Query = last ? query.startAfter(last).limit(pageSize) : query.limit(pageSize);
    const snap = await paged.get();
    report.candidates += snap.size;
    if (snap.size) await handlePage(snap.docs);
    if (snap.size < pageSize) return;
    last = snap.docs[snap.docs.length - 1];
  }
};

// --- Derived fields ---------------------------------------------------------

/**
 * Indexed copies of what each job needs to select on. Maintained on every user
 * write by syncPublicProfile; scripts/backfill-push-fields.mjs covers existing
 * accounts. A user with no stored offset counts as UTC, as the jobs always did.
 */
export const pushFieldsFor = (u: Record<string, any>) => {
  const tz = typeof u.tzOffsetHours === "number" ? Math.round(u.tzOffsetHours * 4) / 4 : 0;
  const hour = typeof u.preferredWorkoutTime === "string"
    ? parseInt(u.preferredWorkoutTime.split(":")[0], 10)
    : NaN;
  return {
    pushTzBucket: tz,
    // floor: a +5:30 user at 08:00 is 02:30 UTC. Comparing that 2.5 to a whole
    // target hour never matched, so half-hour zones got no reminders at all.
    pushReminderHourUtc: Number.isNaN(hour) ? null : Math.floor((((hour - tz) % 24) + 24) % 24),
  };
};

const pushableUsers = () => db.collection("users").where("notificationsEnabled", "==", true);

// --- Workout reminders ------------------------------------------------------

export const runWorkoutReminders = async (opts: JobOptions): Promise<JobReport> => {
  const now = opts.now ?? Date.now();
  const report = newReport();
  // Runs every 30 minutes and matches the hour 30 minutes out, so two runs match
  // the same hour; lastReminderDate stops the second. Keyed on the TARGET day so
  // the guard also holds across midnight UTC.
  const target = new Date(now + 30 * 60_000);
  const today = target.toISOString().slice(0, 10);

  await forEachPage(
    pushableUsers().where("pushReminderHourUtc", "==", target.getUTCHours()),
    opts.pageSize ?? 500,
    Date.now() + (opts.budgetMs ?? 8 * 60_000),
    report,
    (docs) => runPool(docs, opts.concurrency ?? 25, async (doc) => {
      const u = doc.data();
      if (!u.fcmToken || !u.preferredWorkoutTime || u.lastReminderDate === today) return;
      const time = { time: u.preferredWorkoutTime };
      const push: PushContent = {
        title: pushText(u.language, "workout.title"),
        body: pushText(u.language, "workout.body", time),
        type: "workout_reminder",
      };
      await deliver(doc, u.fcmToken, push, { lastReminderDate: today }, "reminder",
        pushText(u.language, "workout.inbox", time), opts, report);
    }),
  );
  return report;
};

const deliver = async (
  doc: QueryDocumentSnapshot,
  token: string,
  push: PushContent,
  stamp: Record<string, unknown>,
  inboxType: string,
  inboxBody: string,
  opts: JobOptions,
  report: JobReport,
) => {
  opts.onDecision?.(doc.id, push);
  if (opts.stamp === false) return;
  try {
    await opts.send(token, push);
    await doc.ref.set(stamp, { merge: true });
    await db.collection("notifications").add({
      userId: doc.id,
      title: push.title,
      body: inboxBody,
      type: inboxType,
      read: false,
      timestamp: FieldValue.serverTimestamp(),
    });
    report.sent++;
  } catch (err) {
    report.failed++;
    console.warn(`${push.type} failed for`, doc.id, err);
  }
};

// --- Trial ending -----------------------------------------------------------

export const runTrialReminders = async (opts: JobOptions & { trialDays: number }): Promise<JobReport> => {
  const now = opts.now ?? Date.now();
  const report = newReport();
  // On the final day of the trial: 0 < time left <= 24h.
  const startedAfter = new Date(now - opts.trialDays * DAY_MS);
  const startedBy = new Date(now - (opts.trialDays - 1) * DAY_MS);

  await forEachPage(
    pushableUsers().where("trialStartedAt", ">", startedAfter).where("trialStartedAt", "<=", startedBy),
    opts.pageSize ?? 500,
    Date.now() + (opts.budgetMs ?? 8 * 60_000),
    report,
    (docs) => runPool(docs, opts.concurrency ?? 25, async (doc) => {
      const u = doc.data();
      // Skip users who already pay.
      if (u.subscriptionType === "premium" || u.trialEndingNotifiedAt || !u.fcmToken) return;
      await deliver(doc, u.fcmToken, {
        title: pushText(u.language, "trial.title"),
        body: pushText(u.language, "trial.body"),
        type: "trial_ending",
      }, { trialEndingNotifiedAt: FieldValue.serverTimestamp() }, "system", pushText(u.language, "trial.inbox"), opts, report);
    }),
  );
  return report;
};

// --- Engagement nudges ------------------------------------------------------
//
// All decision logic mirrors src/services/engagementUtils.ts (proven by
// `npm run proof:engagement`). KEEP THESE CONSTANTS IN SYNC with that module.
//   streak-risk: streak >= 2, active yesterday (not today), local hour >= 19
//   meal-nudge : local hour 12–15, nothing logged today
//   win-back   : exactly 1/3/7/14/30 days since last active, fired at ~10:00 local
// Idempotency lives in user-doc fields written here via the admin SDK (which
// bypasses Firestore rules): streakRiskNotifiedDate, mealNudgeDate, winbackLastTier.
// The client resets winbackLastTier to 0 on every active day (analyticsService).
const ENG = {
  STREAK_RISK_MIN: 2,
  STREAK_RISK_HOUR: 19,
  MEAL_NUDGE_HOUR_START: 12,
  MEAL_NUDGE_HOUR_END: 15,
  WINBACK_TIERS: [1, 3, 7, 14, 30] as readonly number[],
  WINBACK_HOUR: 10, // local hour to send the daily win-back check (once/day/user)
};

// Win-back copy per tier lives in pushText.ts ("winback.<tier>.title|body").
const winbackCopy = (gap: number, lang: unknown): { title: string; body: string } => ({
  title: pushText(lang, `winback.${gap}.title` as PushTextKey),
  body: pushText(lang, `winback.${gap}.body` as PushTextKey),
});

// 'YYYY-MM-DD' (UTC fields of a wall-clock-shifted instant) → whole-day ordinal.
const dayOrdinal = (key: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || "");
  if (!m) return null;
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS);
};

export type Nudge = PushContent & { update: Record<string, unknown> };

/** Whether this user gets a push right now, and which. At most one per run. */
export const decideNudge = (u: Record<string, any>, now: number): Nudge | null => {
  if (!u.fcmToken) return null;
  // User-local wall clock (offsetHours = localHour - utcHour; default UTC).
  const offsetHours = typeof u.tzOffsetHours === "number" ? u.tzOffsetHours : 0;
  const localMs = now + offsetHours * HOUR_MS;
  const local = new Date(localMs);
  const hourLocal = local.getUTCHours();
  const today = local.toISOString().slice(0, 10);
  const todayOrd = dayOrdinal(today)!;
  const startOfTodayMs = Math.floor(localMs / DAY_MS) * DAY_MS - offsetHours * HOUR_MS;

  const lastActiveDay: string | null = typeof u.lastActiveDay === "string" ? u.lastActiveDay : null;
  const lastActiveOrd = lastActiveDay ? dayOrdinal(lastActiveDay) : null;
  const streak = Number(u.currentStreak) || 0;

  // --- 1. Streak-at-risk (highest priority) ---
  if (
    streak >= ENG.STREAK_RISK_MIN &&
    lastActiveOrd !== null &&
    todayOrd - lastActiveOrd === 1 &&
    hourLocal >= ENG.STREAK_RISK_HOUR &&
    u.streakRiskNotifiedDate !== today
  ) {
    return {
      title: pushText(u.language, "streak.title", { n: streak }),
      body: pushText(u.language, "streak.body", { n: streak }),
      type: "streak_risk",
      update: { streakRiskNotifiedDate: today },
    };
  }

  // --- 2. Win-back (fired once/day at ~10:00 local) ---
  if (lastActiveOrd !== null && hourLocal === ENG.WINBACK_HOUR) {
    const gap = todayOrd - lastActiveOrd;
    const lastTier = Number(u.winbackLastTier) || 0;
    if (ENG.WINBACK_TIERS.includes(gap) && gap > lastTier) {
      const copy = winbackCopy(gap, u.language);
      return { title: copy.title, body: copy.body, type: "winback", update: { winbackLastTier: gap } };
    }
  }

  // --- 3. Meal-time nudge (lowest priority, midday) ---
  if (hourLocal >= ENG.MEAL_NUDGE_HOUR_START && hourLocal < ENG.MEAL_NUDGE_HOUR_END && u.mealNudgeDate !== today) {
    const lastMealMs = u.lastMealAt?.toMillis ? u.lastMealAt.toMillis()
      : (typeof u.lastMealAt?._seconds === "number" ? u.lastMealAt._seconds * 1000 : null);
    if (!(lastMealMs != null && lastMealMs >= startOfTodayMs)) {
      return {
        title: pushText(u.language, "meal.title"),
        body: pushText(u.language, "meal.body"),
        type: "meal_nudge",
        update: { mealNudgeDate: today },
      };
    }
  }
  return null;
};

// Every UTC offset in use today falls on a quarter hour between -12 and +14.
const TZ_BUCKETS = Array.from({ length: 109 }, (_, i) => -12 + i * 0.25);

/**
 * The one query each time zone needs right now. The three triggers fire in
 * separate local hours, so each zone has at most one shape, and most of the day
 * it needs no query at all.
 */
export const nudgeQueriesAt = (now: number): Query[] => {
  const out: Query[] = [];
  for (const tz of TZ_BUCKETS) {
    const localMs = now + tz * HOUR_MS;
    const hour = new Date(localMs).getUTCHours();
    const dayKey = (daysAgo: number) => new Date(localMs - daysAgo * DAY_MS).toISOString().slice(0, 10);
    const zone = pushableUsers().where("pushTzBucket", "==", tz);
    if (hour >= ENG.STREAK_RISK_HOUR) out.push(zone.where("lastActiveDay", "==", dayKey(1)));
    else if (hour === ENG.WINBACK_HOUR) out.push(zone.where("lastActiveDay", "in", ENG.WINBACK_TIERS.map(dayKey)));
    else if (hour >= ENG.MEAL_NUDGE_HOUR_START && hour < ENG.MEAL_NUDGE_HOUR_END) out.push(zone);
  }
  return out;
};

export const runEngagementNudges = async (opts: JobOptions): Promise<JobReport> => {
  const now = opts.now ?? Date.now();
  const report = newReport();
  const deadline = Date.now() + (opts.budgetMs ?? 8 * 60_000);
  for (const query of nudgeQueriesAt(now)) {
    await forEachPage(query, opts.pageSize ?? 500, deadline, report, (docs) =>
      runPool(docs, opts.concurrency ?? 25, async (doc) => {
        const u = doc.data();
        const nudge = decideNudge(u, now);
        if (!nudge) return;
        const { update, ...push } = nudge;
        await deliver(doc, u.fcmToken, push, update, "reminder", push.body, opts, report);
      }),
    );
    if (report.stoppedEarly) break;
  }
  return report;
};

// --- Community count --------------------------------------------------------

export const COMMUNITY_GOALS = ["fat_loss", "muscle_gain", "maintenance", "athletic_performance"];

/**
 * Stores how many athletes share each goal, so Home can read ONE document
 * rather than hold a live listener on up to 500 profiles per user. It also
 * stops the number being capped at 500.
 */
export const refreshCommunityStats = async (): Promise<{ total: number; byGoal: Record<string, number> }> => {
  const profiles = db.collection("public_profiles");
  const count = async (q: Query) => (await q.count().get()).data().count;
  const [total, ...perGoal] = await Promise.all([
    count(profiles),
    ...COMMUNITY_GOALS.map((g) => count(profiles.where("goal", "==", g))),
  ]);
  const byGoal = Object.fromEntries(COMMUNITY_GOALS.map((g, i) => [g, perGoal[i]]));
  await db.doc("community_stats/global").set({ total, byGoal, updatedAt: FieldValue.serverTimestamp() });
  return { total, byGoal };
};
