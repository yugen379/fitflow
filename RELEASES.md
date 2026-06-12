# Releasing FitFlow

FitFlow ships two ways: the **web app / PWA** (Firebase Hosting) and the **Android APK**
(GitHub Actions). You can edit the app freely at any time — these are just the steps to
publish what you've built.

## Web / PWA (instant)

```bash
npm run lint           # tsc --noEmit
npm run build          # vite build → dist/
firebase deploy --only "hosting,firestore:rules" --project gen-lang-client-0893216108
```

Live URL: https://gen-lang-client-0893216108.web.app
(Run `firestore:rules` only when `firestore.rules` changed.)

## Android APK (GitHub Actions — no local Android SDK needed)

The workflow `.github/workflows/android-apk.yml` builds an installable APK in the cloud.
If the signing secrets below are present it builds a **signed release APK** (`com.fitflow.app`,
stable SHA-1 → native Google sign-in works); otherwise it falls back to an unsigned **debug**
APK (fine for sideloading, but Google sign-in will NOT work in it).

**Every push to `main`** → builds an APK you can download for 30 days:
GitHub → **Actions** → latest run → **Artifacts** → `fitflow-apk`.

**A version tag** → also publishes a **permanent GitHub Release**:

```bash
git tag v1.0.0
git push origin v1.0.0
```

→ Release at `github.com/<you>/fitflow/releases` containing `fitflow-v1.0.0.apk`.
Bump the number for each build (`v1.0.1`, `v1.1.0`, …).

You can also trigger a build manually: **Actions → Build Android APK → Run workflow**.

### Repo Secrets (Settings → Secrets and variables → Actions)

| Secret | Enables | Required for |
| --- | --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Signed **release** APK (stable SHA-1) | Native Google sign-in, Play Store |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore/key password | Native Google sign-in, Play Store |
| `GOOGLE_SERVICES_JSON` | Firebase config in the app (base64 of `android/app/google-services.json`) | Native Google sign-in **and** push |
| `GEMINI_API_KEY` | AI features (coach, AI label-reading, quick-add) | AI in the APK |
| `VITE_USDA_API_KEY` | Richer food lookups (else public DEMO_KEY) | optional |

The APK still builds with **none** of these (OFF/USDA scanner + one-tap settings work
out of the box) — it just falls back to a debug build with email/password sign-in only.

## Native Google sign-in (the APK-only setup)

Google **blocks** OAuth inside Android WebViews (`Error 403: disallowed_useragent`), so the
in-app "Continue with Google" uses the **native account picker** via
`@capacitor-firebase/authentication` (web/PWA keeps the Google Identity Services widget).
For Google to trust the app, three things must line up. Email/password sign-in works in the
APK without any of this.

**1. Register the app's signing SHA-1 in Firebase.**
This repo's release keystore (generated locally, gitignored at `android/fitflow-release.keystore`)
has fingerprint:

```
SHA-1:   60:61:26:8D:50:F6:C9:78:B9:6E:17:AB:9F:1C:C5:A2:DE:9D:64:F2
SHA-256: C5:58:D3:B5:AC:C3:A1:E8:65:A9:EB:85:01:3A:43:BB:BF:53:90:F0:62:E5:E9:81:85:0C:D2:83:13:D2:27:35
```

Firebase Console → Project `gen-lang-client-0893216108` → ⚙ **Project settings** → **Your apps** →
**Add app → Android** → package name **`com.fitflow.app`** → paste the **SHA-1** above → Register.
(To recompute after re-keying: `keytool -list -v -keystore android/fitflow-release.keystore -alias fitflow`.)

**2. Download the new `google-services.json`** from that same Android app card → place at
`android/app/google-services.json` (gitignored). It now contains an `oauth_client` of type 3
(the web client) which the native plugin uses as its `serverClientId`.

**3. Add the three signing/config secrets to GitHub** (values were written to gitignored files
in the repo root by the setup step — copy them, then delete the files):

| GitHub secret | Value source |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | contents of `.keystore-base64.txt` |
| `ANDROID_KEYSTORE_PASSWORD` | contents of `.keystore-password.txt` |
| `GOOGLE_SERVICES_JSON` | `base64 -w0 android/app/google-services.json` |

> ⚠️ The keystore is your app's permanent identity — back up `android/fitflow-release.keystore`
> and its password somewhere safe. Lose it and you can never update the Play Store listing.

### Quick local check before pushing
```bash
cd android && ./gradlew assembleRelease   # produces app/build/outputs/apk/release/app-release.apk
```

## Everyday editing loop

1. Edit `src/**` (or anywhere).
2. Verify: `npm run lint`, then any relevant proof — see below.
3. Web: `npm run build && firebase deploy --only hosting`.
4. Mobile (optional): `git push` (artifact) and/or `git tag vX.Y.Z && git push origin vX.Y.Z` (Release).

> If you add an npm dependency, run `npm install` so `package-lock.json` stays in sync
> (CI uses `npm ci`). Native Android changes are picked up automatically — the workflow
> runs `npx cap sync android` before building.

## Proof harnesses (the "100% / zero-error" guarantees)

```bash
npm run proof:barcode     # OFF/USDA resolver (logic + live lookups)
npm run proof:coach       # AI coach chat (live AI, 0 errors)
npm run proof:briefing    # proactive coach engine + AI polish
npm run proof:quickadd    # NL meal parsing
npm run proof:catalog     # shared food-catalog keys/validation
npm run proof:retention   # streaks + D1/D7/D30
npm run proof:scanner     # camera acquire/start/frame + EAN-13 decode (needs Python + Playwright)
```
