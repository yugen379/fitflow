import * as functions from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import { GoogleGenAI } from "@google/genai";
import Stripe from "stripe";

admin.initializeApp();
const db = admin.firestore();

// Gemini key lives in Firebase Secret Manager (replaces the deprecated
// functions.config() runtime config, which sunsets March 2027). Set it with:
//   firebase functions:secrets:set GEMINI_API_KEY
const geminiApiKey = defineSecret("GEMINI_API_KEY");

// ---------------------------------------------------------------------------
// Stripe billing — hosted Checkout + Billing Portal + webhook.
//
// Secrets live in Secret Manager (set with `firebase functions:secrets:set`):
//   STRIPE_SECRET_KEY      — sk_live_… / sk_test_…
//   STRIPE_WEBHOOK_SECRET  — whsec_…  (from the webhook endpoint in Stripe)
//
// The 6-day free trial is APP-MANAGED and cardless (see lib/billing.ts), so we
// do NOT use Stripe's trial_period_days here — checkout charges immediately when
// the user chooses to subscribe. The webhook is the ONLY writer of billing
// fields on the user doc (admin SDK bypasses Firestore rules).
// ---------------------------------------------------------------------------
const GRACE_DAYS = 3;
const stripeSecret = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

// Shared secret RevenueCat sends in the Authorization header of its webhook (set
// it in the RevenueCat dashboard → project → Webhooks, and here via
// `firebase functions:secrets:set REVENUECAT_WEBHOOK_AUTH`). Guards the endpoint
// so only RevenueCat can grant entitlement.
const revenueCatAuth = defineSecret("REVENUECAT_WEBHOOK_AUTH");

const getStripe = (): Stripe | null => {
  const key = stripeSecret.value() || process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key, { apiVersion: "2024-12-18.acacia" as any });
};

// Map a Stripe subscription onto our user-doc billing fields and persist it.
const applySubscription = async (stripe: Stripe, sub: Stripe.Subscription) => {
  const customerId = sub.customer as string;
  const snap = await db.collection("users")
    .where("stripeCustomerId", "==", customerId).limit(1).get();
  if (snap.empty) {
    console.warn("applySubscription: no user for customer", customerId);
    return;
  }
  const ref = snap.docs[0].ref;

  const item = sub.items?.data?.[0];
  const interval = item?.price?.recurring?.interval;
  const plan = (sub.metadata?.plan as string) || (interval === "year" ? "yearly" : "monthly");
  const periodEndMs = sub.current_period_end ? sub.current_period_end * 1000 : null;

  // Entitlement decision lives server-side: premium while healthy or within grace.
  const entitledStatuses = ["active", "trialing"];
  const isEntitled = entitledStatuses.includes(sub.status);
  const isPastDue = sub.status === "past_due";

  const update: Record<string, any> = {
    subscriptionType: isEntitled || isPastDue ? "premium" : "free",
    subscriptionStatus: sub.status,
    plan,
    stripeSubscriptionId: sub.id,
    currentPeriodEnd: periodEndMs,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    subscriptionUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  // Past-due keeps Pro for a short dunning grace window, then the next Stripe
  // event (canceled/unpaid) flips it to free.
  update.graceUntil = isPastDue ? Date.now() + GRACE_DAYS * 86_400_000 : null;

  await ref.set(update, { merge: true });
};

export const createCheckoutSession = functions.https.onRequest(
  { secrets: [stripeSecret] },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Methods", "POST");
      res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") { res.status(405).send("Method Not Allowed"); return; }

    const stripe = getStripe();
    if (!stripe) { res.status(500).json({ error: "Stripe not configured" }); return; }

    try {
      const authHeader = req.headers.authorization || "";
      const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
      if (!idToken) { res.status(401).json({ error: "Missing auth token" }); return; }
      const decoded = await admin.auth().verifyIdToken(idToken);
      const uid = decoded.uid;

      const { priceId, plan, successUrl, cancelUrl } = req.body || {};
      if (!priceId) { res.status(400).json({ error: "Missing priceId" }); return; }

      // Reuse the existing Stripe customer if we've seen this uid before
      const userDoc = await db.doc(`users/${uid}`).get();
      let customerId = userDoc.data()?.stripeCustomerId as string | undefined;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: decoded.email,
          metadata: { firebaseUid: uid },
        });
        customerId = customer.id;
        await db.doc(`users/${uid}`).set({ stripeCustomerId: customerId }, { merge: true });
      }

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: {
          metadata: { firebaseUid: uid, plan: plan === "yearly" ? "yearly" : "monthly" },
        },
        allow_promotion_codes: true,
        success_url: successUrl || "https://fitflow.com/pro?status=success",
        cancel_url: cancelUrl || "https://fitflow.com/pro?status=cancelled",
      });

      res.json({ url: session.url, id: session.id });
    } catch (err: any) {
      console.error("createCheckoutSession error:", err);
      res.status(500).json({ error: err?.message || "Checkout failed" });
    }
  });

// Stripe Billing Portal — lets a paying user manage/cancel their subscription.
export const createPortalSession = functions.https.onRequest(
  { secrets: [stripeSecret] },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Methods", "POST");
      res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") { res.status(405).send("Method Not Allowed"); return; }

    const stripe = getStripe();
    if (!stripe) { res.status(500).json({ error: "Stripe not configured" }); return; }

    try {
      const authHeader = req.headers.authorization || "";
      const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
      if (!idToken) { res.status(401).json({ error: "Missing auth token" }); return; }
      const decoded = await admin.auth().verifyIdToken(idToken);
      const uid = decoded.uid;

      const userDoc = await db.doc(`users/${uid}`).get();
      const customerId = userDoc.data()?.stripeCustomerId as string | undefined;
      if (!customerId) { res.status(400).json({ error: "No billing account yet." }); return; }

      const { returnUrl } = req.body || {};
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl || "https://fitflow.com/settings",
      });
      res.json({ url: session.url });
    } catch (err: any) {
      console.error("createPortalSession error:", err);
      res.status(500).json({ error: err?.message || "Portal failed" });
    }
  });

export const stripeWebhook = functions.https.onRequest(
  { secrets: [stripeSecret, stripeWebhookSecret] },
  async (req, res) => {
    const stripe = getStripe();
    const webhookSecret = stripeWebhookSecret.value() || process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripe || !webhookSecret) { res.status(500).send("Stripe not configured"); return; }

    const sig = req.headers["stripe-signature"] as string;
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent((req as any).rawBody, sig, webhookSecret);
    } catch (err: any) {
      console.error("Webhook signature failed:", err?.message);
      res.status(400).send(`Webhook Error: ${err?.message}`);
      return;
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          if (session.subscription) {
            const sub = await stripe.subscriptions.retrieve(session.subscription as string);
            await applySubscription(stripe, sub);
          }
          break;
        }
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted": {
          await applySubscription(stripe, event.data.object as Stripe.Subscription);
          break;
        }
        case "invoice.payment_failed": {
          const invoice = event.data.object as Stripe.Invoice;
          if ((invoice as any).subscription) {
            const sub = await stripe.subscriptions.retrieve((invoice as any).subscription as string);
            await applySubscription(stripe, sub);
          }
          break;
        }
      }
      res.json({ received: true });
    } catch (err: any) {
      console.error("Webhook handler error:", err);
      res.status(500).send("Internal");
    }
  });

// ---------------------------------------------------------------------------
// Account deletion — server-side cascade (more robust than client-side)
// ---------------------------------------------------------------------------
export const deleteAccount = functions.https.onCall(async (data: any, context: any) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Sign in required");
  const uid = context.auth.uid;
  const collections = [
    "meals", "workouts", "water_logs", "sleep_logs", "wellness_logs",
    "weight_history", "body_metrics", "activity_routes", "notifications",
    "posts", "comments",
  ];
  for (const c of collections) {
    const snap = await db.collection(c).where("userId", "==", uid).get();
    if (snap.empty) continue;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  await db.doc(`users/${uid}`).delete().catch(() => {});
  await admin.auth().deleteUser(uid).catch(() => {});
  return { deleted: true };
});

// ---------------------------------------------------------------------------
// Gemini proxy — holds the API key server-side so it never ships in the client
// bundle. Every Gemini-backed feature routes through here when the client has
// VITE_GEMINI_PROXY_URL set. Mirrors the client model cascade and per-action
// fallbacks so behavior is identical to the legacy direct-SDK path.
// ---------------------------------------------------------------------------

// Free-tier quota is enforced PER MODEL (5 req/min/model). Cascading across
// models that each carry an independent quota bucket multiplies real-AI
// throughput ~4x before anything degrades to a heuristic reply. (Keep this list
// in sync with MODELS in src/services/geminiService.ts.)
const GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-flash-latest",
  "gemini-2.5-flash-lite",
  "gemini-flash-lite-latest",
];

const isRetryable = (e: any): boolean => {
  const s = Number(e?.status ?? e?.code);
  if (s === 429 || s === 500 || s === 503) return true;
  const msg = String(e?.message || e || "");
  return /RESOURCE_EXHAUSTED|quota|rate|unavailable|overloaded|deadline|timeout|network|fetch/i.test(msg);
};

const safeJsonParse = (text: string, fallback: any) => {
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    return fallback;
  }
};

// One pass over the model cascade. Returns trimmed text, or null if every model
// failed. Retryable (quota/transient) errors advance to the next model; hard
// errors stop. Never throws.
const cascadeOnce = async (ai: GoogleGenAI, contents: any): Promise<string | null> => {
  for (const model of GEMINI_MODELS) {
    try {
      // thinkingBudget 0 skips the 2.5-family "thinking" pass — the proxy's
      // short structured tasks don't need it and it costs seconds of latency.
      const resp = await ai.models.generateContent({
        model, contents, config: { thinkingConfig: { thinkingBudget: 0 } },
      });
      const text = (resp.text || "").trim();
      if (text) return text;
    } catch (e: any) {
      console.warn(`Gemini ${model} failed:`, e?.status || "", String(e?.message || e).slice(0, 80));
      if (!isRetryable(e)) break;
    }
  }
  return null;
};

// Retrying variant for user-facing text (the coach): if the whole cascade is
// momentarily exhausted, back off and sweep again before giving up.
const cascadeText = async (
  ai: GoogleGenAI,
  contents: any,
  { retries = 1, minChars = 1, backoffMs = 600 }: { retries?: number; minChars?: number; backoffMs?: number } = {},
): Promise<string | null> => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const text = await cascadeOnce(ai, contents);
    if (text && text.length >= minChars) return text;
    if (attempt < retries) await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)));
  }
  return null;
};

export const geminiProxy = functions.https.onRequest(
  { secrets: [geminiApiKey] },
  async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "POST");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }
  try {
    const apiKey = geminiApiKey.value() || process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("Gemini API key is not configured in Firebase");
    const ai = new GoogleGenAI({ apiKey });
    const { action, payload = {} } = req.body || {};

    // Run the cascade and parse JSON, falling back to the given shape on any
    // failure so the client always receives usable structured content.
    const json = async (contents: any, fallback: any) => {
      const text = await cascadeOnce(ai, contents);
      return text ? safeJsonParse(text, fallback) : fallback;
    };
    const vision = (base64Image: string, mimeType: string, text: string) => ({
      parts: [
        { inlineData: { data: base64Image, mimeType: mimeType || "image/jpeg" } },
        { text },
      ],
    });

    switch (action) {
      case "estimateCalories": {
        const out = await json(
          `Analyze this food and return ONLY valid JSON.
Format: {"name": string, "calories": number, "protein": number, "carbs": number, "fats": number}
Food: "${payload.description}"`,
          { name: payload.description, calories: 0, protein: 0, carbs: 0, fats: 0 },
        );
        res.json(out);
        return;
      }

      case "analyzeMealImage": {
        const out = await json(
          vision(payload.base64Image, payload.mimeType, `Analyze this food image and return ONLY valid JSON.
Format: {"name": string, "calories": number, "protein": number, "carbs": number, "fats": number}`),
          { name: "Unknown meal", calories: 0, protein: 0, carbs: 0, fats: 0 },
        );
        res.json(out);
        return;
      }

      case "analyzeNutritionLabel": {
        const out = await json(
          vision(payload.base64Image, payload.mimeType, `You are reading a packaged-food photo (a barcode/product or its nutrition label).
Identify the product and return its nutrition PER 100g (or per 100ml). If the label only shows per-serving values, convert to per-100g using the stated serving size.
Return ONLY valid JSON, no markdown:
{"name": string, "brand": string, "calories": number, "protein": number, "carbs": number, "fats": number}
If you genuinely cannot determine any nutrition, return {"calories": 0}.`),
          { calories: 0 },
        );
        res.json(out);
        return;
      }

      case "analyzeFormFrame": {
        const exercise = payload.exerciseName;
        const out = await json(
          vision(payload.base64Image, payload.mimeType, `You are an elite strength coach. Analyze ONLY this exact frame for ${exercise} form.
Return ONLY valid JSON, no markdown:
{"exercise":"${exercise}","rating":<1-10 form score>,"status":"good"|"fix"|"danger","cue":"<single short coaching cue, max 12 words, imperative voice>","details":"<one optional secondary detail, max 18 words>"}
If no person visible, return rating 0 status "fix" cue "Step into frame so I can see your full body."`),
          { exercise, rating: 0, status: "fix", cue: "Show your full body for a check." },
        );
        res.json(out);
        return;
      }

      case "generateWorkoutPlan": {
        const ctx = payload.userHistory?.length ? JSON.stringify(payload.userHistory.slice(-3)) : "Starting fresh.";
        const out = await json(
          `Generate a workout for goal: ${payload.userGoals}. Context: ${ctx}.
Return ONLY valid JSON: {"title": string, "description": string, "type": string,
"exercises": [{"id": string, "name": string}]}`,
          { title: "", description: "", type: "", exercises: [] },
        );
        res.json(out);
        return;
      }

      case "generateMealPlan": {
        const out = await json(
          `Generate a 7-day meal plan. Preferences: ${payload.dietaryPreferences}. Target: ${payload.kCalTarget} kcal/day.
Return ONLY a valid JSON array of 7 objects:
[{"day": string, "breakfast": string, "lunch": string, "dinner": string, "snack": string, "calories": number}]`,
          [],
        );
        res.json(out);
        return;
      }

      case "getRecipe": {
        const out = await json(
          `Healthy recipe for "${payload.mealName}". Return ONLY valid JSON:
{"ingredients": string[], "instructions": string[], "prepTime": string, "protein": number, "carbs": number, "fats": number}`,
          null,
        );
        res.json(out);
        return;
      }

      case "swapMeal": {
        const out = await json(
          `Suggest ONE alternative meal that replaces "${payload.original}". Reason: ${payload.reason}. Preferences: ${payload.dietaryPreferences}. Do NOT return "${payload.original}" — return a different dish.
Return ONLY valid JSON: {"name": string, "calories": number, "protein": number, "carbs": number, "fats": number, "why": string}`,
          {},
        );
        res.json(out);
        return;
      }

      case "dailyChallenge": {
        const p = payload.profile || {};
        const out = await json(
          `Generate ONE specific, doable daily fitness micro-challenge for someone with goal "${p.goal || "general fitness"}" and a ${p.streak || 0}-day streak.
Pick something they can finish in a single day. Vary the category.
Return ONLY valid JSON: {"title":"<8 words max>","description":"<one short sentence>","target":<number>,"unit":"<short unit string>","category":"movement"|"nutrition"|"recovery"|"mindfulness"}`,
          { title: "Move 30 minutes", description: "Any sustained movement — walk, lift, ride.", target: 30, unit: "minutes", category: "movement" },
        );
        res.json(out);
        return;
      }

      case "getAICoachInsight": {
        const text = await cascadeText(
          ai,
          `You are an elite fitness AI. Give ONE sharp, motivational insight (max 20 words) based on:
Calories today: ${payload.calories}, Water: ${payload.water}ml, Workouts: ${payload.workouts}, Streak: ${payload.streak} days.
Return ONLY plain text, no JSON.`,
        );
        res.json({ text: (text || "").replace(/[*_`#]/g, "").trim() });
        return;
      }

      case "askCoach": {
        const profile = payload.profile || {};
        const history: { role: string; text: string }[] = payload.history || [];
        const transcript = history.slice(-8).map((m) => `${m.role === "user" ? "User" : "Coach"}: ${m.text}`).join("\n");
        const text = await cascadeText(
          ai,
          `You are FitFlow Coach — an expert in strength training, nutrition, recovery, and behavior change.
The user's goal is ${profile.goal || "general fitness"}. Weight: ${profile.weight || "n/a"}kg. Age: ${profile.age || "n/a"}.
Be direct, practical, and motivating. Reply in 2–4 sentences. Use plain language, no markdown, no emojis.

${transcript ? "Conversation so far:\n" + transcript + "\n\n" : ""}User: ${payload.message}
Coach:`,
          { retries: 1, minChars: 15 },
        );
        // Strip stray markdown and apply the same substance gate the client used.
        // An empty string tells the client to use its on-device heuristic reply.
        const clean = (text || "").replace(/[*_`#]/g, "").trim();
        res.json({ text: clean.length >= 15 ? clean : "" });
        return;
      }

      case "generateWeeklyRecap": {
        const out = await json(
          `You are an elite performance coach writing a friendly weekly recap.
Goal: ${payload.goal || "general fitness"}. This week:
- ${payload.workouts} workouts, ${payload.workoutMinutes} active minutes
- ${payload.caloriesBurned} kcal burned, ${payload.caloriesConsumed} consumed
- ${payload.waterMl}ml water, ${payload.sleepHours} hours sleep
- ${payload.streak}-day streak${payload.topExercise ? `, top exercise: ${payload.topExercise}` : ""}

Return ONLY valid JSON, no markdown:
{"headline":"<≤8 word title>","highlight":"<1-2 sentence summary in plain English, sentence case>","win":"<1 short positive observation>","focus":"<one thing to focus on next week, plain language>","nextStep":"<one specific action they can take Monday>"}
Tone: warm, direct, like a real human coach. No emojis.`,
          {
            headline: "A solid week of work.",
            highlight: "You showed up and put in real effort this week. Keep that momentum.",
            win: "Consistency built more progress than any single session.",
            focus: "Hydration — small daily wins compound.",
            nextStep: "Set a 10am hydration alarm and refill once before lunch.",
          },
        );
        res.json(out);
        return;
      }

      default:
        res.status(400).json({ error: "Invalid action" });
        return;
    }
  } catch (error: any) {
    console.error("Cloud Function Proxy Error:", error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
});

// ---------------------------------------------------------------------------
// Smart workout reminders — runs every hour, sends FCM to users whose
// preferredWorkoutTime hour matches (now + 30 minutes).
// Idempotency: lastReminderDate field on user prevents duplicate same-day sends.
// ---------------------------------------------------------------------------
export const sendWorkoutReminders = onSchedule(
  { schedule: "every 30 minutes", timeZone: "UTC" },
  async () => {
    const now = new Date();
    const target = new Date(now.getTime() + 30 * 60 * 1000); // 30 min from now
    const targetHourUtc = target.getUTCHours();
    const today = now.toISOString().slice(0, 10);

    const snap = await db
      .collection("users")
      .where("notificationsEnabled", "==", true)
      .get();

    const messaging = admin.messaging();

    const tasks = snap.docs.map(async (doc) => {
      const u = doc.data() as any;
      if (!u.fcmToken || !u.preferredWorkoutTime) return;
      const [hStr] = u.preferredWorkoutTime.split(":");
      const userHourLocal = parseInt(hStr, 10);
      if (Number.isNaN(userHourLocal)) return;

      // Apply user's UTC offset if stored, else assume UTC.
      const offsetHours = typeof u.tzOffsetHours === "number" ? u.tzOffsetHours : 0;
      const userHourUtc = ((userHourLocal - offsetHours) + 24) % 24;
      if (userHourUtc !== targetHourUtc) return;

      if (u.lastReminderDate === today) return;

      try {
        await messaging.send({
          token: u.fcmToken,
          notification: {
            title: "Training window opens soon",
            body: `You usually train around ${u.preferredWorkoutTime}. 30 minutes — let's go.`,
          },
          data: { type: "workout_reminder" },
          android: { priority: "high", notification: { channelId: "fitflow_reminders" } },
        });
        await doc.ref.update({ lastReminderDate: today });

        await db.collection("notifications").add({
          userId: doc.id,
          title: "Training window opens soon",
          body: `You usually train around ${u.preferredWorkoutTime}.`,
          type: "reminder",
          read: false,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (err) {
        console.warn("Reminder send failed for", doc.id, err);
      }
    });

    await Promise.all(tasks);
  });

// ---------------------------------------------------------------------------
// Sunday AI weekly recap — runs every Sunday 09:00 UTC, generates a personalized
// recap and stores it in weekly_recaps/<uid>_<weekId>. The client picks it up.
// ---------------------------------------------------------------------------
function isoWeek(d: Date) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = date.getTime();
  date.setUTCMonth(0, 1);
  if (date.getUTCDay() !== 4) {
    date.setUTCMonth(0, 1 + ((4 - date.getUTCDay()) + 7) % 7);
  }
  const week = 1 + Math.ceil((firstThursday - date.getTime()) / 604800000);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export const generateWeeklyRecaps = onSchedule(
  { schedule: "every sunday 09:00", timeZone: "UTC", secrets: [geminiApiKey] },
  async () => {
    const apiKey = geminiApiKey.value() || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("Gemini key missing; skipping weekly recap");
      return;
    }
    const ai = new GoogleGenAI({ apiKey });
    const weekId = isoWeek(new Date());
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);

    const usersSnap = await db.collection("users").get();
    const tasks = usersSnap.docs.map(async (doc) => {
      const uid = doc.id;
      const u = doc.data() as any;
      const existing = await db.doc(`weekly_recaps/${uid}_${weekId}`).get();
      if (existing.exists) return;

      const [workouts, meals, water, sleep] = await Promise.all([
        db.collection("workouts").where("userId", "==", uid).where("timestamp", ">=", weekAgo).get(),
        db.collection("meals").where("userId", "==", uid).where("timestamp", ">=", weekAgo).get(),
        db.collection("water_logs").where("userId", "==", uid).where("timestamp", ">=", weekAgo).get(),
        db.collection("sleep_logs").where("userId", "==", uid).where("timestamp", ">=", weekAgo).get(),
      ]);
      const stats = {
        workouts: workouts.size,
        minutes: workouts.docs.reduce((a, d) => a + (d.data().duration || 0), 0),
        calories: workouts.docs.reduce((a, d) => a + (d.data().caloriesBurned || 0), 0),
        consumed: meals.docs.reduce((a, d) => a + (d.data().calories || 0), 0),
        water: water.docs.reduce((a, d) => a + (d.data().amount || 0), 0),
        sleepHours: sleep.size ? Math.round((sleep.docs.reduce((a, d) => a + (d.data().hours || 0), 0) / sleep.size) * 10) / 10 : 0,
      };

      try {
        const result = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: `You are an elite performance coach writing a friendly weekly recap.
Goal: ${u.goal || "general fitness"}. This week:
- ${stats.workouts} workouts, ${stats.minutes} active minutes
- ${stats.calories} kcal burned, ${stats.consumed} consumed
- ${stats.water}ml water, ${stats.sleepHours} hours sleep
- ${u.streak || 0}-day streak

Return ONLY valid JSON:
{"headline":"<≤8 word title>","highlight":"<1-2 sentence summary>","win":"<1 short positive observation>","focus":"<one thing to focus on next week>","nextStep":"<one specific action they can take Monday>"}
Tone: warm, direct, like a real human coach. No emojis.`,
        });
        const text = (result.text || "{}").replace(/```json|```/g, "").trim();
        const recap = JSON.parse(text);
        await db.doc(`weekly_recaps/${uid}_${weekId}`).set({
          recap, stats, generatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        if (u.fcmToken && u.notificationsEnabled) {
          await admin.messaging().send({
            token: u.fcmToken,
            notification: {
              title: "Your weekly recap is ready",
              body: recap.headline,
            },
            data: { type: "weekly_recap" },
          });
        }
      } catch (err) {
        console.warn("Recap generation failed for", uid, err);
      }
    });

    await Promise.all(tasks);
  });

// ---------------------------------------------------------------------------
// Trial-ending nudge — runs daily, pushes a conversion reminder to users whose
// cardless 6-day trial has ~1 day left and who haven't subscribed yet.
// Idempotency: trialEndingNotifiedAt prevents repeat sends. (Keep TRIAL_DAYS in
// sync with src/lib/billing.ts.)
// ---------------------------------------------------------------------------
const TRIAL_DAYS = 6;

export const sendTrialEndingReminders = onSchedule(
  { schedule: "every day 16:00", timeZone: "UTC" },
  async () => {
    const now = Date.now();
    const dayMs = 86_400_000;

    const snap = await db
      .collection("users")
      .where("notificationsEnabled", "==", true)
      .get();

    const messaging = admin.messaging();

    const tasks = snap.docs.map(async (doc) => {
      const u = doc.data() as any;
      // Skip users who already pay or never started a trial.
      if (u.subscriptionType === "premium") return;
      if (u.trialEndingNotifiedAt) return;
      if (!u.fcmToken) return;

      const startMs = u.trialStartedAt?.toMillis ? u.trialStartedAt.toMillis()
        : (typeof u.trialStartedAt?._seconds === "number" ? u.trialStartedAt._seconds * 1000 : null);
      if (startMs == null) return;

      const endMs = startMs + TRIAL_DAYS * dayMs;
      const msLeft = endMs - now;
      // Fire only on the final day of the trial (0 < left <= 24h).
      if (msLeft <= 0 || msLeft > dayMs) return;

      try {
        await messaging.send({
          token: u.fcmToken,
          notification: {
            title: "Your free trial ends tomorrow",
            body: "Keep your AI coach, form check & analytics — subscribe to stay Pro.",
          },
          data: { type: "trial_ending" },
          android: { priority: "high", notification: { channelId: "fitflow_reminders" } },
        });
        await doc.ref.set(
          { trialEndingNotifiedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true },
        );
        await db.collection("notifications").add({
          userId: doc.id,
          title: "Your free trial ends tomorrow",
          body: "Subscribe to keep FitFlow Pro.",
          type: "system",
          read: false,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (err) {
        console.warn("Trial-ending reminder failed for", doc.id, err);
      }
    });

    await Promise.all(tasks);
  });

// ---------------------------------------------------------------------------
// Proactive re-engagement nudges — the three highest-leverage retention pushes,
// in ONE every-30-min scan (cost: a single users read per run). Per user we
// evaluate all three triggers and send AT MOST ONE push (priority: streak-risk >
// win-back > meal-nudge) so nobody gets double-pushed in a run.
//
// All decision logic mirrors src/services/engagementUtils.ts (proven 100% by
// `npm run proof:engagement`). KEEP THESE CONSTANTS IN SYNC with that module.
//   streak-risk: streak >= 2, active yesterday (not today), local hour >= 19
//   meal-nudge : local hour 12–15, nothing logged today
//   win-back   : exactly 1/3/7/14/30 days since last active, fired at ~10:00 local
// Idempotency lives in user-doc fields written here via the admin SDK (which
// bypasses Firestore rules): streakRiskNotifiedDate, mealNudgeDate, winbackLastTier.
// The client resets winbackLastTier to 0 on every active day (analyticsService).
// ---------------------------------------------------------------------------
const ENG = {
  STREAK_RISK_MIN: 2,
  STREAK_RISK_HOUR: 19,
  MEAL_NUDGE_HOUR_START: 12,
  MEAL_NUDGE_HOUR_END: 15,
  WINBACK_TIERS: [1, 3, 7, 14, 30] as readonly number[],
  WINBACK_HOUR: 10, // local hour to send the daily win-back check (once/day/user)
};

const WINBACK_COPY: Record<number, { title: string; body: string }> = {
  1: { title: "Pick up where you left off", body: "A 2-minute log keeps your momentum going. You’ve got this." },
  3: { title: "Your coach misses you", body: "Three days off is fine — jump back in and we’ll adjust your plan." },
  7: { title: "One week — let’s restart", body: "A fresh week is the perfect reset. Log one thing to get rolling." },
  14: { title: "Still here for you", body: "Two weeks out. Your data’s exactly where you left it — come finish what you started." },
  30: { title: "We saved your spot", body: "A month away happens. One tap brings your whole plan back to life." },
};

// 'YYYY-MM-DD' (UTC fields of a wall-clock-shifted instant) → whole-day ordinal.
const engDayOrdinal = (key: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || "");
  if (!m) return null;
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
};

export const sendEngagementNudges = onSchedule(
  { schedule: "every 30 minutes", timeZone: "UTC" },
  async () => {
    const now = Date.now();
    const snap = await db
      .collection("users")
      .where("notificationsEnabled", "==", true)
      .get();
    const messaging = admin.messaging();

    const tasks = snap.docs.map(async (doc) => {
      const u = doc.data() as any;
      if (!u.fcmToken) return;

      // User-local wall clock (offsetHours = localHour - utcHour; default UTC).
      const offsetHours = typeof u.tzOffsetHours === "number" ? u.tzOffsetHours : 0;
      const localMs = now + offsetHours * 3600_000;
      const local = new Date(localMs);
      const hourLocal = local.getUTCHours();
      const today = local.toISOString().slice(0, 10);
      const todayOrd = engDayOrdinal(today)!;
      const startOfTodayMs = Math.floor(localMs / 86400000) * 86400000 - offsetHours * 3600_000;

      const lastActiveDay: string | null = typeof u.lastActiveDay === "string" ? u.lastActiveDay : null;
      const lastActiveOrd = lastActiveDay ? engDayOrdinal(lastActiveDay) : null;
      const streak = Number(u.currentStreak) || 0;

      let push: { title: string; body: string; type: string; update: Record<string, any> } | null = null;

      // --- 1. Streak-at-risk (highest priority) ---
      if (
        streak >= ENG.STREAK_RISK_MIN &&
        lastActiveOrd !== null &&
        todayOrd - lastActiveOrd === 1 &&
        hourLocal >= ENG.STREAK_RISK_HOUR &&
        u.streakRiskNotifiedDate !== today
      ) {
        push = {
          title: `🔥 Your ${streak}-day streak ends at midnight`,
          body: `Don't lose it now — a quick log keeps your ${streak}-day streak alive.`,
          type: "streak_risk",
          update: { streakRiskNotifiedDate: today },
        };
      }

      // --- 2. Win-back (fired once/day at ~10:00 local) ---
      if (!push && lastActiveOrd !== null && hourLocal === ENG.WINBACK_HOUR) {
        const gap = todayOrd - lastActiveOrd;
        const lastTier = Number(u.winbackLastTier) || 0;
        if (ENG.WINBACK_TIERS.includes(gap) && gap > lastTier) {
          const copy = WINBACK_COPY[gap];
          push = { title: copy.title, body: copy.body, type: "winback", update: { winbackLastTier: gap } };
        }
      }

      // --- 3. Meal-time nudge (lowest priority, midday) ---
      if (
        !push &&
        hourLocal >= ENG.MEAL_NUDGE_HOUR_START &&
        hourLocal < ENG.MEAL_NUDGE_HOUR_END &&
        u.mealNudgeDate !== today
      ) {
        const lastMealMs = u.lastMealAt?.toMillis ? u.lastMealAt.toMillis()
          : (typeof u.lastMealAt?._seconds === "number" ? u.lastMealAt._seconds * 1000 : null);
        const loggedToday = lastMealMs != null && lastMealMs >= startOfTodayMs;
        if (!loggedToday) {
          push = {
            title: "Haven't logged today?",
            body: "Capture a meal in 2 taps — scan a barcode or just describe it.",
            type: "meal_nudge",
            update: { mealNudgeDate: today },
          };
        }
      }

      if (!push) return;

      try {
        await messaging.send({
          token: u.fcmToken,
          notification: { title: push.title, body: push.body },
          data: { type: push.type },
          android: { priority: "high", notification: { channelId: "fitflow_reminders" } },
        });
        await doc.ref.set(push.update, { merge: true });
        await db.collection("notifications").add({
          userId: doc.id,
          title: push.title,
          body: push.body,
          type: "reminder",
          read: false,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (err) {
        console.warn("Engagement nudge failed for", doc.id, push.type, err);
      }
    });

    await Promise.all(tasks);
  });

// ---------------------------------------------------------------------------
// RevenueCat webhook — Android in-app purchases (Google Play Billing).
//
// Web sells Pro via Stripe (the only writer of billing fields from that side);
// Android sells via Play Billing through RevenueCat, and THIS function is the only
// writer for that side. It maps a RevenueCat event onto the SAME user-doc fields
// applySubscription() writes (subscriptionType / subscriptionStatus / plan /
// currentPeriodEnd / cancelAtPeriodEnd / graceUntil), so lib/billing.ts treats a
// Play subscriber and a Stripe subscriber identically. The RevenueCat appUserID is
// the Firebase uid, so event.app_user_id IS the user doc id.
//
// Idempotent + safe: an unknown/duplicate event simply 200s without changing state.
// ---------------------------------------------------------------------------
export const revenueCatWebhook = functions.https.onRequest(
  { secrets: [revenueCatAuth] },
  async (req, res) => {
    if (req.method !== "POST") { res.status(405).send("Method Not Allowed"); return; }

    // Verify the shared secret RevenueCat sends in the Authorization header.
    // FAIL CLOSED: if no secret is configured, reject everything — never run as an
    // open endpoint that can grant entitlement.
    const expected = revenueCatAuth.value() || process.env.REVENUECAT_WEBHOOK_AUTH;
    if (!expected || req.headers.authorization !== expected) {
      res.status(401).send("Unauthorized");
      return;
    }

    try {
      const event = req.body?.event;
      const uid: string | undefined = event?.app_user_id;
      if (!event || !uid) { res.status(200).send("ignored: no event/app_user_id"); return; }

      const type: string = event.type || "";
      const expirationMs: number | null =
        typeof event.expiration_at_ms === "number" ? event.expiration_at_ms : null;
      const productId: string = event.product_id || "";
      const plan = /year|annual|yr/i.test(productId) ? "yearly" : "monthly";
      const now = Date.now();

      const update: Record<string, any> = {
        plan,
        currentPeriodEnd: expirationMs,
        billingSource: "play",
        rcEventType: type,
        subscriptionUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      // Entitlement decision (mirrors the Stripe path: premium while healthy or in grace).
      const ACTIVE = ["INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "PRODUCT_CHANGE",
        "NON_RENEWING_PURCHASE", "SUBSCRIPTION_EXTENDED", "TEMPORARY_ENTITLEMENT_GRANT"];
      if (type === "EXPIRATION" || (expirationMs !== null && expirationMs < now && type !== "BILLING_ISSUE")) {
        update.subscriptionType = "free";
        update.subscriptionStatus = "expired";
        update.cancelAtPeriodEnd = false;
        update.graceUntil = null;
      } else if (type === "CANCELLATION") {
        // Cancelled but still entitled until the period ends.
        update.subscriptionType = "premium";
        update.subscriptionStatus = "canceled";
        update.cancelAtPeriodEnd = true;
        update.graceUntil = null;
      } else if (type === "BILLING_ISSUE") {
        update.subscriptionType = "premium";
        update.subscriptionStatus = "past_due";
        update.graceUntil = now + GRACE_DAYS * 86_400_000;
      } else if (ACTIVE.includes(type)) {
        update.subscriptionType = "premium";
        update.subscriptionStatus = "active";
        update.cancelAtPeriodEnd = false;
        update.graceUntil = null;
      } else {
        // TRANSFER, SUBSCRIPTION_PAUSED, TEST, etc. — acknowledge without changing entitlement.
        res.status(200).send("ignored: " + type);
        return;
      }

      await db.doc(`users/${uid}`).set(update, { merge: true });
      res.status(200).send("ok");
    } catch (err) {
      console.error("revenueCatWebhook error", err);
      res.status(500).send("error");
    }
  });
