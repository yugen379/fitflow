# FitFlow — Google Play Data Safety form

Copy these answers straight into **Play Console → App content → Data safety**.
Every answer below was derived from the actual code (manifest permissions,
`src/lib/telemetry.ts`, `src/services/*`, `src/pages/Privacy.tsx`, Firestore usage),
so it will match what Google's automated scanners see. **Mismatches are the #1 cause
of Data Safety rejections — do not "round up" or guess.**

Package: `com.fitflow.app` · Category: Health & Fitness · Privacy policy URL required (see end).

---

## Section 1 — Data collection & security (the 3 gate questions)

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (all traffic is HTTPS/TLS via Firebase, Cloud Functions, Gemini, Stripe, RevenueCat) |
| Do you provide a way for users to request that their data is deleted? | **Yes** (in-app account deletion; profile + activity removed within 30 days — see Privacy policy §6) |

> **"Shared" note:** Google defines *sharing* as transferring data to a **third party for
> their own use**. FitFlow's vendors (Firebase, Google Gemini, Stripe, RevenueCat, Sentry,
> PostHog, OpenFoodFacts) all act as **service providers/processors on FitFlow's behalf**,
> which Google explicitly **excludes** from "sharing." Therefore **Shared = No** for every
> data type below. (You still list them as *collected*.)

---

## Section 2 — Data types (declare exactly these)

For every "Collected = Yes" item: **Shared = No**, **Processed ephemerally = No** (unless noted),
and answer "Is this data required or can users choose?" as marked.

### 📍 Location
| Data type | Collected | Optional/Required | Purposes |
|---|---|---|---|
| **Precise location** | **Yes** | **Optional** (only when the user records a GPS run/route in the Explore/Track screen) | App functionality |
| Approximate location | Yes | Optional | App functionality |

*Why:* `src/pages/Explore.tsx` uses `navigator.geolocation.watchPosition` to record run routes. Routes are stored to the user's own account only.

### 👤 Personal info
| Data type | Collected | Optional/Required | Purposes |
|---|---|---|---|
| **Name** | **Yes** | Required | App functionality, Account management |
| **Email address** | **Yes** | Required | App functionality, Account management |
| **User IDs** | **Yes** | Required | App functionality, Account management, Analytics |

*Why:* Google Sign-In supplies name, email, photo; Firebase UID is the account key.
**Do NOT declare:** Address, Phone number, Race/ethnicity, Political/religious beliefs, Sexual orientation, Other personal info.

### 💳 Financial info
| Data type | Collected | Optional/Required | Purposes |
|---|---|---|---|
| **Purchase history** | **Yes** | Optional (only if the user subscribes to Pro) | App functionality |

**Do NOT declare:** Payment info, Credit score, Other financial info. Card/payment data is handled entirely by **Google Play Billing** (via RevenueCat on Android) — the app never sees or stores it.

### ❤️ Health and fitness
| Data type | Collected | Optional/Required | Purposes |
|---|---|---|---|
| **Health info** | **Yes** | Optional | App functionality |
| **Fitness info** | **Yes** | Optional | App functionality |

*Why:* Profile (age, height, weight, goal weight, health conditions), logged meals/water/sleep/mood/weight history, and Health Connect reads (steps, calories, heart rate, sleep, exercise, distance, weight). Used only to personalize plans/insights.

### 📷 Photos and videos
| Data type | Collected | Optional/Required | Purposes |
|---|---|---|---|
| **Photos** | **Yes** | Optional | App functionality |

*Why:* Meal photos uploaded for AI nutrition analysis, and single camera **frames** captured during AI form check (sent to Gemini as JPEG stills). **Videos are NOT collected** — form check grabs still frames only (`audio: false`).

### 🎤 Audio — **DECLARE NOTHING**
The app does **not** collect audio. AI form check runs with `audio: false`; the mic
`getUserMedia({audio:true})` calls in Onboarding/Settings are permission-priming probes
that never record, store, or transmit audio.
> ⚠️ **Pre-submit fix (recommended):** `RECORD_AUDIO` is still declared in
> `AndroidManifest.xml` but unused. Leaving it can trigger a sensitive-permission review
> flag and a scary mic prompt. See "Pre-submission fixes" below.

### 📊 App activity
| Data type | Collected | Optional/Required | Purposes |
|---|---|---|---|
| **App interactions** | **Yes** | Optional | Analytics |
| **Other user-generated content** | **Yes** | Optional | App functionality |

*Why:* PostHog records page views / key-action taps (only if `VITE_POSTHOG_KEY` is set; autocapture is OFF). Community posts/comments + logged notes are user-generated content.
**Do NOT declare:** In-app search history (skip), Installed apps, Web browsing history.

### 🐞 App info and performance
| Data type | Collected | Optional/Required | Purposes |
|---|---|---|---|
| **Crash logs** | **Yes** | Optional | Analytics (diagnostics) |
| **Diagnostics** | **Yes** | Optional | Analytics (diagnostics) |

*Why:* Sentry crash + performance reporting (only if `VITE_SENTRY_DSN` is set).

### 📱 Device or other IDs
| Data type | Collected | Optional/Required | Purposes |
|---|---|---|---|
| **Device or other IDs** | **Yes** | Optional | App functionality, Analytics |

*Why:* FCM push token (notifications), device model/OS/app version, PostHog distinct ID.

---

## Section 3 — Health Connect (separate but related)

Because the app reads Health Connect, you must **also**:
1. In Play Console → **App content → Health apps declaration**, declare each Health
   Connect data type the manifest requests:
   READ_STEPS, READ_ACTIVE_CALORIES_BURNED, READ_TOTAL_CALORIES_BURNED, READ_HEART_RATE,
   READ_SLEEP, READ_EXERCISE, READ_WEIGHT, READ_DISTANCE.
2. State the purpose: **personalizing the user's fitness plan, insights, and weekly recap.**
3. Confirm you **do not** share Health Connect data with third parties and **do not** use it
   for advertising. (Both true.)
4. The in-app permissions-rationale screen is already wired
   (`HealthConnectPermissionsRationale` activity-alias in the manifest) — Google requires it.

---

## Pre-submission fixes (do these before uploading the AAB)

1. **Remove the unused `RECORD_AUDIO` permission** from `android/app/src/main/AndroidManifest.xml`
   (line 48). Audio is never recorded. This avoids a sensitive-permission flag and keeps the
   Data Safety "Audio = none" answer clean. *(If you ever add voice features, re-add it and
   update the form.)* — **Needs your OK; it's a one-line code change.**
2. **Privacy policy must be at a public URL.** The form requires a hosted link. The policy
   already exists in-app (`src/pages/Privacy.tsx`, also reachable at your web app
   `/privacy` route). Use that public URL, e.g. `https://<your-web-domain>/privacy`.
3. **Fix the policy's placeholders** before going public:
   - `COMPANY = 'FitFlow, Inc.'` → for a solo/individual Play account this should be **your
     legal name** (or a registered trading name), not "Inc." unless you've incorporated.
   - `COMPANY_ADDRESS = '[REPLACE WITH REGISTERED BUSINESS ADDRESS]'` → real contact address
     (Play + GDPR require a reachable address).
4. **Stripe vs. Play Billing wording:** the policy lists Stripe for billing — accurate for the
   **web** app, but on **Android** purchases go through **Google Play Billing (RevenueCat)**.
   Add one line so the policy covers both. (Doesn't change Data Safety answers.)
