# FitFlow — Play Console "App content" + Store listing — exact answers

Package: `com.fitflow.fitness` · Project: `gen-lang-client-0893216108`
Web app (live): `https://gen-lang-client-0893216108.web.app`
Contact email: `fitflow2000@gmail.com`

Work top→bottom. ✅ = answer to enter. ⚠️ = needs your input/action.

---

## 1) Set privacy policy
- **Privacy policy URL:** `https://gen-lang-client-0893216108.web.app/privacy`  ✅ (verified live, HTTP 200)
- ⚠️ Open that page once and confirm it shows your **real legal name + a contact address**
  (the draft had placeholders "FitFlow, Inc." / "[REPLACE…]"). For a personal Play account use
  your own legal name. Not a hard blocker for closed testing, but fix before production.

## 2) App access (Sign in details)
FitFlow requires login, so reviewers need a working test account.
- Choose: **"All or some functionality is restricted"** → add an instruction set:
  - **Name:** `Full app access`
  - **Username:** ⚠️ a real account you create (see below)
  - **Password:** ⚠️ that account's password
  - **Any other instructions:** `Sign in with the email/password above (or Google sign-in). All features are then available.`
- ⚠️ **Create the test account now:** go to `https://gen-lang-client-0893216108.web.app`, sign up
  with email/password (e.g. a dedicated `fitflowreview@gmail.com`), complete onboarding so there's
  data to see, then put those credentials here. Keep it valid — reviewers reuse it.

## 3) Ads
- **Does your app contain ads?** → **No**  ✅ (FitFlow shows no ads; PostHog/Sentry are analytics, not ads.)

## 4) Content rating
- **Email:** `fitflow2000@gmail.com`  ✅
- **Category:** Health & Fitness (or "Utility, Productivity, Communication, or Other" if Health isn't listed) ✅
- Violence / Sexual content / Profanity / Controlled substances / Gambling → **No** to all ✅
- **Users can interact / share content (UGC)?** → **Yes** (community posts & comments) ✅
  - Can users share their location with each other? → **No** (GPS routes are private to the user)
  - Is there moderation / reporting? → **Yes** (be honest; report/moderation exists)
- **Does the app share the user's current location?** → **Yes** (optional GPS run tracking) ✅
- Expected result: **Everyone / PEGI 3** (UGC may nudge to Teen — accept whatever it computes).

## 5) Target audience and content
- **Target age group:** **18 and over** ✅ (avoids the stricter Families/children policy overhead)
- **Appeals to children?** → **No** ✅
- Do not opt into the "Designed for Families" program.

## 6) Data safety
Use **`PLAY_DATA_SAFETY.md`** — it's code-accurate. Gate answers:
- Collects user data → **Yes**; Encrypted in transit → **Yes**; Users can request deletion → **Yes** ✅
- **Shared with third parties → No** for every type (vendors are processors).
- Data types to declare (all Collected=Yes, Shared=No): Location (precise/approx, optional),
  Name/Email/User IDs, Purchase history (optional), Health & fitness info, Photos,
  App interactions, Other UGC, Crash logs, Diagnostics, Device/other IDs.
- **Audio → declare NOTHING** (RECORD_AUDIO was removed; app never records audio).
- Full per-field table + purposes are in PLAY_DATA_SAFETY.md.

## 7) Government apps
- **Is your app a government app?** → **No** ✅

## 8) Financial features
- **Does your app provide financial features?** → **No** ✅
  (A paid subscription via Google Play Billing is NOT a "financial feature" — that category means
  banking, loans, investments, crypto, etc. FitFlow has none.)

## 9) Health
- **Does your app access Health Connect?** → **Yes** ✅
- Health Connect data types requested (all **read-only**), with purpose
  *"personalize the user's fitness plan, insights and weekly recap"*:
  - Steps, Active calories burned, Total calories burned, Heart rate, Sleep, Exercise, Weight, Distance
- **Do you share Health Connect data with third parties?** → **No** ✅
- **Do you use Health Connect data for advertising?** → **No** ✅
- App type: **fitness/wellness** (NOT a medical device / not for diagnosis).
- The in-app permissions-rationale screen is already implemented (required by Google).

---

## 10) Store settings — category & contact details
(Grow → Store presence → Store settings)
- **App category:** `Health & Fitness` ✅
- **Tags:** Workout, Calorie counter, Personal trainer, Nutrition, Running ✅
- **Contact email:** `fitflow2000@gmail.com` ✅
- **Website:** `https://gen-lang-client-0893216108.web.app` ✅
- **Phone:** leave blank (optional) ✅

## 11) Main store listing
(Grow → Store presence → Main store listing) — copy from `PLAY_STORE_LISTING.md`:
- **App name (≤30):** `FitFlow: AI Fitness Coach`
- **Short description (80):** `AI workouts, food logging & a coach that checks in on you. Your fitness, flowing.`
- **Full description:** the long block in PLAY_STORE_LISTING.md (~2,250 chars).
- **Graphics** (from `Desktop\fitflow-store-assets\`):
  - App icon → `icon-512.png`
  - Feature graphic → `feature-1024x500.png`
  - Phone screenshots → `screenshots\01-home.png … 05-analytics.png`

---

## Only 2 things actually need YOU (everything else is copy-paste above)
1. **Create a reviewer test account** (email/password on the live web app) → enter under **App access** (#2).
2. **Confirm the privacy page** shows your real legal name + contact address (#1).
