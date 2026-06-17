# App Check — backend abuse protection ("Google protect")

App Check makes Firebase verify that requests to **Firestore**, **Cloud Functions**,
and the **Gemini proxy** come from your genuine app — not a bot, scraper, or someone
replaying your public API keys. It's the abuse shield that keeps freeloaders from
draining your Gemini quota and poisoning the shared `food_catalog`.

The code is already wired (`src/lib/appCheck.ts`, initialized in `src/lib/firebase.ts`)
and ships **inert** until you provide a site key — so it can never lock anyone out by
surprise. Roll it out in stages:

## 1. Register a reCAPTCHA v3 provider (web)
1. Firebase Console → **App Check** → **Apps** → your **Web app** → **reCAPTCHA v3**.
2. Google creates a reCAPTCHA v3 site key (or paste your own from the reCAPTCHA admin).
3. Set it in your env / CI secrets:
   ```
   VITE_RECAPTCHA_V3_SITE_KEY=6Lxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
4. Rebuild + redeploy. Clients now silently attach App Check tokens to every request.

## 2. Verify before enforcing (critical)
- Console → **App Check** → each product shows **Verified vs. Unverified** request %.
- Wait until **verified ≈ 100%** of real traffic (usually 24–48h after rollout).
- Enforcing earlier would reject legitimate users whose clients haven't updated.

## 3. Enforce per service
Once verified traffic is steady, click **Enforce** on:
- **Cloud Firestore**
- **Cloud Functions** (protects the Gemini proxy + billing endpoints)
- **Authentication** (optional)

## Local dev / CI
The JS SDK prints a debug token to the console on `localhost`. Register it under
**App Check → Manage debug tokens**, then set:
```
VITE_APPCHECK_DEBUG_TOKEN=<the-printed-token>
```

## Native Android (Capacitor / APK)
The web reCAPTCHA provider can't attest inside a WebView, so on native the app uses
**Play Integrity** (Android) / **App Attest** (iOS) via `@capacitor-firebase/app-check`.

### How it's wired (already done in code)
- `@capacitor-firebase/app-check` installed; native dep `firebase-appcheck-playintegrity`
  is pulled in automatically (run `npx cap sync android` after installs).
- `src/lib/appCheck.ts` detects native and:
  1. calls the plugin's `initialize()` → installs the native **Play Integrity** provider
     (or the debug provider if a debug token is supplied), then
  2. registers the **JS SDK** App Check with a `CustomProvider` that fetches the token
     from the native plugin — because our Firestore/Functions I/O runs through the JS
     SDK in the WebView, this is what actually attaches the device-attested token to
     those requests.

### Remaining steps YOU must do (console + credentials — can't be scripted)
1. **Enable the Play Integrity API** — Google Cloud Console → APIs & Services → Library
   → "Play Integrity API" → Enable (project `gen-lang-client-0893216108`).
2. **Add the app's SHA-256** — Firebase Console → Project Settings → your Android app
   (`com.fitflow.app`) → Add fingerprint. You already have the SHA-1 for sign-in;
   Play Integrity needs the **SHA-256** of the release keystore:
   ```
   keytool -list -v -keystore <release.keystore> -alias <alias>
   ```
3. **Register the provider** — Firebase Console → App Check → Apps → your Android app
   → **Play Integrity** → register.
4. **Link Google Play** — Play Integrity does full attestation only for builds
   distributed via Play (internal-testing track is enough). In Play Console, ensure the
   Play Integrity API is linked to the app. Until then, sideloaded/debug builds must use
   a **debug token** (set `VITE_APPCHECK_DEBUG_TOKEN`, register it in App Check → debug
   tokens). Release builds on Play use Play Integrity automatically.
5. **Ship a new APK/AAB** (versionCode already bumped) so users get the App-Check build.

Only AFTER web + Android verified traffic is high in the App Check dashboard should you
turn on enforcement (Firestore first, then Functions).
