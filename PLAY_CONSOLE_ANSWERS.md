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

## 12) Foreground service permissions declaration  <-- REQUIRED, blocks the release

*(Policy -> App content -> Foreground service permissions -> "Go to declaration")*

Verified against the **shipped** `v1.5.0` bundle's merged manifest, not the source.
These must match exactly or review rejects the release.

**Which foreground service types does your app use?** -> tick **Health** only.

The app declares exactly one: `android:foregroundServiceType="health"` on
`.steps.StepCounterService`, with `FOREGROUND_SERVICE` and
`FOREGROUND_SERVICE_HEALTH`. Do **not** tick dataSync, location or any other type
-- the app declares none of them.

**Describe the functionality** (paste):

> FitFlow counts the user's daily steps using the device's hardware step-counter
> sensor. The foreground service keeps that sensor listener alive while the app is
> closed, so the day's step total stays accurate without the user having to open
> the app. The service starts only when the user explicitly turns "Background step
> counting" on, and can be turned off at any time from the same screen. While it
> runs it shows a persistent notification reading "N steps today - FitFlow is
> counting your steps". No location data is used for step counting, and no step
> data is shared with third parties.

**Is it user-initiated?** -> **Yes.** It starts only from an explicit tap
(`enableBackgroundCounting`, on the Home and Steps screens); nothing starts it
automatically on install. The boot receiver restarts it after a reboot **only if
the user had already switched it on**.

**Video demonstrating the feature** -> Google requires a link (an unlisted YouTube
video, ~30 seconds). Record: open the Steps screen -> toggle "Background step
counting" on -> grant the Activity Recognition prompt -> show the persistent
notification appear -> close the app -> show the count still rising in the
notification. Set it **unlisted, not private**, or the reviewer cannot open it.

Permitted-use-case mapping: the `health` type covers continuous fitness/activity
tracking and takes `ACTIVITY_RECOGNITION` as its runtime permission, which the app
requests before starting the service.

---

## 13) Health declaration  <-- REQUIRED, blocks the release

*(Policy -> App content -> Health -> "Go to declaration")*

**Does your app access Health Connect?** -> **Yes.**

The eight permissions below are merged in from `capacitor-health-connect`, so they
do not appear in `android/app/src/main/AndroidManifest.xml` -- but they ARE in the
shipped bundle. All are **read-only**; the app requests no WRITE permission.

| Health Connect permission | Play form data type |
| --- | --- |
| `READ_STEPS` | Steps |
| `READ_ACTIVE_CALORIES_BURNED` | Active calories burned |
| `READ_TOTAL_CALORIES_BURNED` | Total calories burned |
| `READ_HEART_RATE` | Heart rate |
| `READ_SLEEP` | Sleep |
| `READ_EXERCISE` | Exercise |
| `READ_WEIGHT` | Weight |
| `READ_DISTANCE` | Distance |

**Purpose, for all eight** (paste):

> To personalise the user's fitness plan, daily insights and weekly recap.

- **Share Health Connect data with third parties?** -> **No**
- **Use Health Connect data for advertising or marketing?** -> **No**
- **Is the app a medical device / for diagnosis or treatment?** -> **No**
  (fitness and wellness only)
- **Permissions-rationale screen** -> already implemented: the
  `.HealthConnectPermissionsRationale` activity-alias handles
  `androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE`. Google checks it exists.
- **Privacy policy URL** -> the same one used in section 1.

If the form asks you to justify each type individually: steps and distance feed
the daily step ring and streaks; active and total calories feed the calorie
balance against food logged; heart rate and exercise feed workout intensity and
the weekly recap; sleep feeds the recovery screen; weight feeds the progress chart
and the calorie target.

---

## 14) ACTIVITY_RECOGNITION declaration  <-- REQUIRED, blocks the release

*(Policy -> App content -> Sensitive app permissions -> Activity recognition)*

Verified against the shipped v1.5.0 bundle and the native source, not assumed.

**What the app actually does with it.** `ACTIVITY_RECOGNITION` is used for exactly
one thing: reading `Sensor.TYPE_STEP_COUNTER`, which Android gates behind this
permission from API 29. See `StepCounterService.java:107,118,147`. It is also the
prerequisite runtime permission for the `health` foreground service - promoting
without it throws on Android 14+.

**What it does NOT do, and must not be claimed.** The app does not use Google's
Activity Recognition API. There is no `ActivityRecognitionClient`,
`DetectedActivity` or `ActivityTransition` anywhere in the codebase, so it never
classifies or infers activity types (walking, running, cycling, driving). If the
form offers "detects user activity type", do not tick it - that would be a
declaration the binary contradicts.

**Description** (paste):

> FitFlow is a fitness tracking app. It uses ACTIVITY_RECOGNITION solely to read
> the device's built-in hardware step-counter sensor (Sensor.TYPE_STEP_COUNTER),
> which Android gates behind this permission from API 29 onwards. The step count
> is used to show the user their daily steps, estimated distance and calories
> burned, and to drive their step goal, streaks and achievements - all displayed
> only to that user inside the app.
>
> This permission is also the prerequisite runtime permission for our
> FOREGROUND_SERVICE_HEALTH service, which keeps the step-counter listener alive
> so the count stays accurate while the app is closed.
>
> FitFlow does not use the Activity Recognition API and does not classify or
> infer activity types such as walking, running, cycling or driving. Step data is
> never used for advertising or marketing, is never sold, and is not shared with
> third parties. The permission is requested in context, only when the user turns
> on step counting, and the rest of the app works normally if it is declined -
> steps simply are not counted.

- **Shared with third parties?** No
- **Used for advertising?** No
- **Requested in context?** Yes - only when the user enables step counting
- **App usable if denied?** Yes - every other feature works; steps are not counted
- If a demo video is requested here too, the same one as section 12 applies: it
  shows the permission gating the counter and the count rising with the app closed.

---

## Only 2 things actually need YOU (everything else is copy-paste above)
1. **Create a reviewer test account** (email/password on the live web app) → enter under **App access** (#2).
2. **Confirm the privacy page** shows your real legal name + contact address (#1).
