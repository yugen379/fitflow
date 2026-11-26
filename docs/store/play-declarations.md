# Play Console declarations for this build

These are the questions Play Console will ask about this build, with suggested
answers. Every answer comes from the code in this commit. Where the code does
not settle a question, the answer is marked **UNCERTAIN** with what to check.

- Build: `versionName 1.6.11`, `versionCode 35` (android/app/build.gradle)
- Package: **`com.fitflow.fitness`** (`applicationId`). The older
  `PLAY_STORE_LISTING.md` and `PLAY_DATA_SAFETY.md` at the repo root say
  `com.fitflow.app`. That is the Java namespace, not the package Play sees.
- targetSdk / compileSdk 36, minSdk 26 (android/variables.gradle)
- Listing text: `docs/store/<locale>/{title,short-description,full-description}.txt`,
  checked by `npm run proof:storetext`.

Sources: `android/app/src/main/AndroidManifest.xml`,
`android/app/src/main/java/com/fitflow/app/**`, `src/services/healthService.ts`,
`src/lib/healthImport.ts`, `src/pages/TrackActivity.tsx`, `src/lib/telemetry.ts`,
`src/pages/Settings.tsx`, `functions/src/account.ts`.

---

## 1. Health Connect permissions declaration

App content → Health Connect. Play asks you to justify **each** permission in
the manifest. Only declare permissions the app actually requests.

### Permissions the app requests at runtime

`HC_PERMISSIONS` in `src/services/healthService.ts` is the list the app asks
for. It shows one Health Connect sheet through `FitSleep.requestPermission`
(`health/SleepPlugin.java`). All of them are read-only. The app never writes to
Health Connect.

| Permission | What FitFlow reads | Why (the feature the user sees) |
|---|---|---|
| `READ_STEPS` | `Steps` records for today | The day's step count on Home and Steps. It's also used to estimate distance and active minutes. |
| `READ_ACTIVE_CALORIES_BURNED` | `ActiveCaloriesBurned` for today | The day's calories burned. If nothing has been recorded, the app estimates it from steps instead. |
| `READ_HEART_RATE` | `HeartRateSeries` for today | The average heart rate shown for the day. |
| `READ_RESTING_HEART_RATE` | `RestingHeartRate`, latest plausible value | A recovery signal on Home and for the coach. |
| `READ_WEIGHT` | `Weight`, last 60 days | Smart-scale weigh-ins are copied into weight history, one per day, and only on days the user didn't type a weight (`importScaleWeights`). The smart calorie target uses them. |
| `READ_SLEEP` | `SleepSession` for last night (`SleepPlugin.readSleep`) | Last night's sleep and its quality are saved as that day's sleep log. The daily briefing uses them, for example to suggest a lighter session after a short night. |

Suggested purpose text for every permission: *"To show the user their own
activity, sleep and body data inside FitFlow and to personalise their daily
plan and calorie target. Data is read only, it is never used for advertising,
and it is never sold or shared with third parties."*

### Declared in the manifest but never requested (fix before you submit)

| Permission | Status |
|---|---|
| `READ_TOTAL_CALORIES_BURNED` | **Not in `HC_PERMISSIONS`, and no code reads it.** |
| `READ_EXERCISE` | **Not requested, and no code reads `ExerciseSession`.** |
| `READ_DISTANCE` | **Not requested.** Distance is worked out from steps (see the comment above `HC_READ_TYPES`). |

**Recommendation:** remove these three `<uses-permission>` lines from
`AndroidManifest.xml` before you file the declaration. Play reviews Health
Connect permissions against actual use, and a declared but unused permission
is a common reason for rejection. If you keep them, you have to justify a
feature that doesn't exist. The capacitor-health-connect library manifest
declares no permissions, so deleting the lines removes them completely.
(This commit does not change the manifest. That's your call.)

### Other Health Connect requirements already in place

- A privacy-policy / rationale entry point: the `.HealthConnectPermissionsRationale`
  activity-alias (`ACTION_SHOW_PERMISSIONS_RATIONALE`) for Android 13 and lower,
  and the `.ViewPermissionUsageActivity` alias (`VIEW_PERMISSION_USAGE` +
  `HEALTH_PERMISSIONS`) for Android 14+.
- A `<queries>` entry for `com.google.android.apps.healthdata`.

### UNCERTAIN: Health Connect data reaching the AI

Home sends `sleepHours` into the coach briefing (`src/pages/Home.tsx`,
`CoachBriefingCard`). The deterministic nudge text can include it, for example
"Only 5.5h of sleep last night", and that text goes to Google Gemini for
rewording through FitFlow's server (`getCoachBriefing` in
`src/services/geminiService.ts`). Sleep can come from Health Connect. The
Health Connect policy allows transfer to a service provider to deliver a
user-facing feature. It does **not** allow advertising use, sale, or training
general AI models. Before you submit, check that:
1. the privacy policy says Health Connect data can be processed by an AI service
   provider to produce in-app coaching text, and
2. the Gemini API terms the server runs under don't allow the data to be used
   for model training.

---

## 2. Foreground service permissions

App content → Foreground service permissions. targetSdk 36, so each type has to
be declared. The app has **two** foreground services.

### Health: background step counting

| | |
|---|---|
| Service | `com.fitflow.app.steps.StepCounterService`, `foregroundServiceType="health"` |
| Permissions | `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_HEALTH`. The prerequisite runtime permission is `ACTIVITY_RECOGNITION`. |
| What it does | It listens to the phone's step-counter sensor so the day's step total stays right while FitFlow is closed. |
| Who starts it | The user, by switching on background counting (Steps / Settings, `BackgroundStepsCard`). After a reboot or app update, `BootReceiver` restarts it **only** if the user had switched it on. |
| User-visible notification | Channel "Step counting" (IMPORTANCE_MIN, silent, no badge). Title "`N steps · N kcal`", text "`FitFlow is counting while you walk · v<version>`". Tapping it opens the app. |
| Why it can't be deferred | A sensor listener has to stay registered all the time. WorkManager and JobScheduler run in scheduled windows and can't hold a sensor subscription. |
| Video (Play asks for one) | Switch background counting on → the notification appears → close the app → walk → reopen and show a higher count. |

### Location: GPS walk / run / ride recording

| | |
|---|---|
| Service | `com.fitflow.app.gps.LocationTrackingService`, `foregroundServiceType="location"` |
| Permissions | `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, plus `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` granted while in use |
| What it does | It records the route of a walk, run or ride the user started, so recording continues with the screen off. |
| Who starts it | Only the user, by tapping Start on `/track-activity`, while the app is visible. It isn't exported, and it doesn't restart after a reboot. It stops when the user stops and saves or discards the activity. |
| User-visible notification | Channel "Activity recording" (IMPORTANCE_LOW, silent). Title "`<Walk/Run/Ride> · <elapsed> · <distance> km`". Text "Recording your route · tap to open", "Paused · tap to open FitFlow", or "GPS is off — turn on Location to keep recording". Category WORKOUT, ongoing. |
| Video | Start a run → lock the screen → walk → unlock and show the route and distance → stop and save. |

Note: the notification always shows **km**, even when the user picked miles in
the app (`String.format(Locale.US, "%.2f km", …)` in
`LocationTrackingService.java`). That isn't a policy problem, but US users will
notice it. It's worth fixing before you describe the feature in miles in
screenshots.

---

## 3. Location permission

- Requested: `ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION`, both **while
  in use only**. They're asked for when the user first starts a GPS recording
  (`GpsTrackerPlugin.java`).
- **`ACCESS_BACKGROUND_LOCATION` is not in the manifest, and the app never
  requests it.** Recording with the screen off works because the location
  foreground service is started from the visible app. Android allows that
  without background location.
- So the Play Console **"Location permissions" declaration (background
  location) doesn't apply**. If Play asks anyway, answer that the app doesn't
  access location in the background.
- Location isn't used for ads, analytics or anything outside recording a route.
  The saved route is simplified, capped at 500 points (firestore.rules) and
  stored in the user's own workout record.

---

## 4. Other permissions in the manifest (for reference)

| Permission | Used for | Declaration form? |
|---|---|---|
| `INTERNET` | Everything online | No |
| `CAMERA` | Barcode scanning, meal and nutrition-label photos, AI form check (still frames only) | No |
| `POST_NOTIFICATIONS` | Reminders, nudges, and the two foreground-service notifications | No |
| `ACTIVITY_RECOGNITION` | Step-counter sensor; prerequisite for the `health` foreground service | No form, but say what it's for in Data safety |
| `RECEIVE_BOOT_COMPLETED` | Restarting step counting after a reboot, only if the user switched it on | No |

`RECORD_AUDIO` is no longer in the manifest. The fix recommended in
`PLAY_DATA_SAFETY.md` has been made.

The **merged** release manifest from this commit's compile
(`android/app/build/intermediates/merged_manifest/release/processReleaseMainManifest/AndroidManifest.xml`)
also includes permissions that plugins and libraries add. None of them needs a
Play declaration form:
`ACCESS_NETWORK_STATE`, `VIBRATE`, `WAKE_LOCK`, `com.android.vending.BILLING`
(Play Billing), `com.google.android.c2dm.permission.RECEIVE` (push),
`com.google.android.providers.gsf.permission.READ_GSERVICES`, and
`com.fitflow.fitness.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` (generated by
AndroidX). It contains **no** `ACCESS_BACKGROUND_LOCATION` and **no**
`RECORD_AUDIO`. The In-App Review library adds no permission. After you upload,
check the list again in App bundle explorer.

---

## 5. Data safety form

Play defines "shared" as sending data to a third party **for its own use**.
Service providers that process data for FitFlow (Firebase / Google Cloud,
Google Gemini, Stripe, RevenueCat, Sentry, PostHog, Open Food Facts, USDA
FoodData Central) don't count as sharing. Posts and squad activity that the
user chooses to show other users are user-initiated, so they're exempt too.
Suggested answer: **Shared = No** for every type.

### Gate questions

| Question | Answer |
|---|---|
| Does the app collect or share any of the required user data types? | **Yes** |
| Is all user data encrypted in transit? | **Yes.** Firebase, Cloud Functions, the Gemini proxy, the USDA API, Stripe and RevenueCat are all HTTPS. The only `http://` URL in `src/` is the local Auth emulator (`127.0.0.1:9099`), which runs only in development builds. |
| Can users ask for their data to be deleted? | **Yes.** In the app: **Profile → Settings → Delete account**. This calls the `deleteAccount` Cloud Function, which runs `deleteUserData` in `functions/src/account.ts`. That deletes every user collection, their posts with replies, their comments and likes on other posts, follow edges, their meal plan and recaps, their squad membership, and then the Auth user. On the web, `/delete-account` (`src/pages/DeleteAccount.tsx`) explains both the in-app path and deletion by email. Use `https://<web-domain>/delete-account` as the **account deletion URL** Play asks for. |

### Data types

| Category → type | Collected | Required? | Purpose | Where in the code |
|---|---|---|---|---|
| Location → **Precise location** | Yes | Optional (only if the user records a GPS activity) | App functionality | `TrackActivity.tsx` saves `route` on the workout |
| Location → Approximate location | Yes | Optional | App functionality | Coarse is requested alongside fine |
| Personal info → Name | Yes | Required | App functionality, Account management | Sign-in profile |
| Personal info → Email address | Yes | Required | Account management | Firebase Auth |
| Personal info → User IDs | Yes | Required | App functionality, Account management | Firebase UID |
| Financial info → Purchase history | Yes | Optional (only subscribers) | App functionality | Entitlement on the user record |
| Health and fitness → **Health info** | Yes | Optional | App functionality | Weight, height, age, goal, sleep, heart rate, resting heart rate (typed or from Health Connect) |
| Health and fitness → **Fitness info** | Yes | Optional | App functionality | Steps, workouts, meals and calories, GPS activities |
| Photos and videos → Photos | Yes | Optional | App functionality | Meal photos, nutrition-label photos, form-check still frames sent for AI analysis |
| App activity → App interactions | Yes | Optional | Analytics | PostHog, only if `VITE_POSTHOG_KEY` is set at build time |
| App activity → Other user-generated content | Yes | Optional | App functionality | Community posts and comments, squad names, notes, coach-chat messages |
| App info and performance → Crash logs, Diagnostics | Yes | Optional | Analytics | Sentry, only if `VITE_SENTRY_DSN` is set |
| Device or other IDs | Yes | Optional | App functionality (push) | FCM token |

Not collected: audio, contacts, calendar, SMS, files, web browsing, installed
apps, payment card details (Google Play or Stripe handles them).

**UNCERTAIN, check before you submit:**
1. *Photos: processed ephemerally?* Meal, label and form-check images are sent
   for AI analysis. Check whether any image is **stored**, for example in Cloud
   Storage, or for the shared label catalogue, which keeps the label **values**
   another user photographed (`Track.tsx`, "A label another FitFlow user already
   photographed"). If no image is ever stored, answer "processed ephemerally =
   Yes" for Photos.
2. *Coach chat:* the conversation is kept on the device (`localStorage`,
   `src/pages/Coach.tsx`) and the messages are sent to Gemini through the
   server. Check whether the server logs or stores message text. If it doesn't,
   the chat is processed ephemerally.
3. *Analytics and crash data* only exist if PostHog and Sentry keys were set in
   the release build's environment. If they weren't set for this AAB, those rows
   can be left out. Check the GitHub secrets the release workflow uses.

---

## 6. Health apps declaration

App content → Health apps. Suggested categories, based on the features in
this build:
- **Activity and fitness** (steps, GPS activities, workouts)
- **Nutrition and weight management** (food logging, calorie target, weigh-ins)
- **Sleep management**: only last night's sleep is read and shown. Tick this
  only if Play's category definitions need it for Health Connect sleep access.
  **UNCERTAIN.**

Not a medical device. There are no diagnosis, treatment or clinical features.
The listing text says "not a medical device".

---

## 7. In-app review (Google Play In-App Review API)

- Library: `com.google.android.play:review:2.0.2`. Plugin:
  `com.fitflow.app.review.ReviewPlugin` (registered in `MainActivity`). Policy:
  `src/lib/reviewPrompt.ts`.
- **No Play Console declaration and no permission are needed.**
- Policy compliance:
  - The app never asks "Do you like FitFlow?" before deciding whether to show
    the card (no review gating). The Play card is the only UI.
  - No rewards, XP or unlocks for reviewing.
  - It asks only after a real win (daily mission complete, 7+ day streak, a
    personal record, finishing a GPS activity, applying the smart target). It
    needs 5 or more distinct days of use and 3 or more days since install. It
    never asks within 120 days of a previous ask, never more than 3 times, never
    within 10 minutes of an error, and never in the day's first session before
    the user has touched the app.
- The API never tells the app whether the card appeared or whether the user
  rated. Play also applies its own quota and may show nothing.
- **Testing:** the card only appears on a build **installed from Google Play**
  (internal testing, internal app sharing, closed or production track).
  Sideloaded APKs complete the flow and show nothing (`installerIsPlay: false`
  in the plugin result). An account that has already reviewed the app won't see
  it again.

---

## 8. Other App content answers (unchanged from earlier releases)

- **Ads:** No ads. There is no ad SDK in `package.json` or the Android
  dependencies.
- **Target audience:** 18+ is suggested, to keep the Families policy out of
  scope. **UNCERTAIN:** this is a product decision.
- **Content rating:** user-generated content = Yes (community posts and squads,
  with reporting via `ReportModal`). Shares location with other users = No
  (routes stay on the user's own record).
- **Subscriptions:** On Android, Pro is sold through Google Play Billing via
  RevenueCat (`src/services/playBillingService.ts`, `PLAY_BILLING_GO_LIVE.md`).
  How the build behaves depends on its environment variables (`src/lib/billing.ts`,
  `src/pages/Pro.tsx`):
  - `VITE_PLAY_STORE_BUILD=true` and RevenueCat **not** configured: there is no
    purchase UI at all. The trial still works. This complies with Play's
    payments policy, but the listing's "FitFlow Pro … subscription" paragraph
    then describes something the user can't buy in the app. Either configure
    RevenueCat (`VITE_REVENUECAT_ANDROID_KEY`) or soften that paragraph.
  - `VITE_ALL_FEATURES_FREE=true`: everything is unlocked. Remove the "(Pro)"
    tags and the FitFlow Pro paragraph from all four locales.
  - Without `VITE_PLAY_STORE_BUILD`, the APK sends users to Stripe Checkout in
    the browser. **Never upload that build to Play.**
  **UNCERTAIN:** which of these the AAB you upload was built with. Check the
  release workflow's secrets.
