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

The workflow `.github/workflows/android-apk.yml` builds an installable **debug APK** in the cloud.

**Every push to `main`** → builds an APK you can download for 30 days:
GitHub → **Actions** → latest run → **Artifacts** → `fitflow-debug-apk`.

**A version tag** → also publishes a **permanent GitHub Release**:

```bash
git tag v1.0.0
git push origin v1.0.0
```

→ Release at `github.com/<you>/fitflow/releases` containing `fitflow-v1.0.0.apk`.
Bump the number for each build (`v1.0.1`, `v1.1.0`, …).

You can also trigger a build manually: **Actions → Build Android APK → Run workflow**.

### Optional repo Secrets (Settings → Secrets and variables → Actions)
The APK builds fine **without** these (OFF/USDA barcode scanner + the native
one-tap "Open settings" button work out of the box). Add them to enable more:

| Secret | Enables |
| --- | --- |
| `GEMINI_API_KEY` | AI features in the APK (coach, AI label-reading, quick-add) |
| `VITE_USDA_API_KEY` | Richer food lookups (else the public DEMO_KEY) |
| `GOOGLE_SERVICES_JSON` | Push notifications (base64 of `android/app/google-services.json`) |

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
