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
The web reCAPTCHA provider can't attest inside a WebView, so App Check is **skipped on
native** in `appCheck.ts`. Before enforcing App Check on Functions/Firestore for the
APK, add the **Play Integrity** provider via a native App Check plugin — otherwise the
installed app would be rejected. Until then, keep enforcement to web or leave it in
monitoring mode.
