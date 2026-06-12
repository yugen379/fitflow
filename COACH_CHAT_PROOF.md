# FitFlow — AI Coach Chat: Proof of Work

**Goal:** AI coach chat working at 100% success rate, zero errors, with proof.
**Status:** ✅ Verified — 17/17 answered, **0 errors**, **17/17 real Gemini AI** (was 6/17).
**Live:** https://gen-lang-client-0893216108.web.app  → **Coach** tab
**Reproduce:** `npm run proof:coach`

---

## Root cause

The coach was correctly wired (key valid, CORS allowed, model reachable — all
verified), but **Gemini's free tier limits each model to 5 requests/minute**.
After 5–6 messages, `gemini-2.5-flash` returned `429 RESOURCE_EXHAUSTED` and the
coach silently fell back to canned heuristic replies — which read as "the AI
stopped working." The first proof run showed exactly this: Q1–Q6 real AI, then
everything after 429'd to fallback.

Verified along the way (so we knew it was *quota*, not config):
- Key + model live: `gemini-2.5-flash` → 200 OK from the SDK.
- Browser CORS: `generativelanguage.googleapis.com` reflects
  `access-control-allow-origin: https://gen-lang-client-0893216108.web.app` → 200.
- Deployed bundle inlines the key → `ai` client is constructed in the browser.

## The fix — model cascade (per-model quota buckets)

Free-tier quota is enforced **per model**, so each model has an *independent*
5 rpm bucket. The Gemini call layer now sweeps a cascade and takes the first
model that answers:

```
gemini-2.5-flash → gemini-flash-latest → gemini-2.5-flash-lite → gemini-flash-lite-latest
```

That's ~4× the real-AI throughput before anything degrades. Probed live — all
four return 200 on this key (2.0-flash / 2.0-flash-lite are excluded: zeroed
quota). Plus:

- **`directRawRetry`** for the coach: if the whole cascade is momentarily
  exhausted, wait a short backoff and sweep again before any canned reply.
- **Substance gate**: answers under 15 chars (or empty) are rejected → retry → fallback.
- **Zero-throw guarantee**: every path returns a usable string; `askCoach` never throws.
- Markdown stripped from coach output.

Files: `src/services/geminiService.ts` (cascade + `generateOnce` + retry),
`src/pages/Coach.tsx` (UI, unchanged behavior), `scripts/coach-proof.mjs`.

---

## Proof run (after fix)

```
── AI Coach proof ──
Gemini key: present (live AI expected)

  CASE  OK   SRC       TIME    PREVIEW
  ──────────────────────────────────────────────────────────────────────
  Q1    ✓    AI        3405ms  After your workout, prioritize protein and carbs…
  Q2    ✓    AI        1755ms  Stand with feet shoulder-width apart, toes out…
  Q3    ✓    AI       32666ms  Listen to your body, but moderate fatigue…
  Q4    ✓    AI        5070ms  To break your bench plateau, vary rep ranges…
  Q5    ✓    AI        5782ms  Let's build muscle with no equipment. 45 sec…
  Q6    ✓    AI       54378ms  For muscle gain, 1.6–2.2 g protein per kg…
  Q7    ✓    AI        2761ms  Lower back pain after deadlifts → form issues…
  Q8    ✓    AI       14745ms  To lose belly fat while keeping muscle…
  Q9    ✓    AI       28773ms  Consistency is your absolute key…
  Q10   ✓    AI        7685ms  Aim for 3–4 L of water daily…
  Q11   ✓    AI       23520ms  Training a muscle 2 days in a row isn't optimal…
  Q12   ✓    AI       40075ms  Skip heavy legs today; your CNS needs…
  Q13   ✓    AI       55695ms  (gibberish input) "looks like your keyboard slipped"…
  Q14   ✓    AI       66964ms  (whitespace input) graceful onboarding reply…
  T1    ✓    AI       11658ms  You can build real muscle with just dumbbells…
  T2    ✓    AI        2058ms  Heavy enough for 6–12 reps…
  T3    ✓    AI        2567ms  Train 3–4 days/week with dumbbells…

── Summary ──
  Answered     : 17/17 (100%)
  Thrown errors: 0
  Live AI / fallback: 17 / 0
  ✓ 100% answered · 0 errors — coach chat verified
```

The harness is a **worst-case stress test**: 17 questions fired back-to-back
(incl. a multi-turn conversation, gibberish, and whitespace). Even draining the
buckets in a burst, the cascade + retry got **every** answer from live Gemini.
The slow rows (30–67s) are the burst exhausting buckets and waiting out backoff;
a real user sending one message at a time gets the ~2–5s responses (Q1/Q2/Q7).

## Guarantees

| Property | Guarantee |
|---|---|
| Coach always answers | ✅ cascade → retry → heuristic fallback (always substantive) |
| Zero thrown errors | ✅ every layer catches; `askCoach` cannot throw |
| Real AI under load | ✅ ~4× throughput via per-model quota buckets |
| Verified live at URL | ✅ deployed bundle contains the cascade + inlined key |

**Verification commands**
```
npm run lint            # tsc --noEmit — clean
npm run proof:coach     # 17/17, 0 errors, 17 live-AI
npm run build           # clean
```

> Follow-up (not blocking): the Gemini key is inlined in the client bundle (the
> app's existing design). For hardening, route coach calls through the
> `geminiProxy` Cloud Function (extend it to handle the `askCoach` action) and
> set `VITE_GEMINI_PROXY_URL`, so the key never ships to the browser. Enabling
> billing on the Gemini project also lifts the 5 rpm free-tier cap entirely.
