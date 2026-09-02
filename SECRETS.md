# FitFlow secrets reference

Quick reference for what goes where. Never commit any actual values.

## Client (Vite — public bundle)

These ship in the browser. They're safe to expose because they're either:
- Public identifiers (Firebase config, Sentry DSN, PostHog key)
- URLs that point to authenticated server endpoints (Gemini/Stripe proxies)

| Variable | Source | Set in |
|---|---|---|
| `VITE_GEMINI_PROXY_URL` | Cloud Function URL after deploy | `.env.local`, GH secret |
| `VITE_STRIPE_CHECKOUT_URL` | Cloud Function URL after deploy | `.env.local`, GH secret |
| `VITE_STRIPE_PRICE_MONTHLY` | Stripe Dashboard → Products | `.env.local`, GH secret |
| `VITE_STRIPE_PRICE_YEARLY` | Stripe Dashboard → Products | `.env.local`, GH secret |
| `VITE_SENTRY_DSN` | sentry.io → Project Settings → Client Keys | `.env.local`, GH secret |
| `VITE_POSTHOG_KEY` | posthog.com → Project Settings → API Keys | `.env.local`, GH secret |
| `VITE_POSTHOG_HOST` | usually `https://us.i.posthog.com` | `.env.local`, GH secret |
| `VITE_FIREBASE_VAPID_KEY` | Firebase Console → Cloud Messaging → Web Push certs | `.env.local`, GH secret |

## Server (Firebase Functions config)

Set with `firebase functions:config:set`. These are NEVER in the client.

```bash
firebase functions:config:set \
  gemini.key="sk-xxx-your-gemini-key" \
  stripe.secret="sk_live_..." \
  stripe.webhook="whsec_..."
```

| Key | Source |
|---|---|
| `gemini.key` | Google AI Studio → API Keys |
| `stripe.secret` | Stripe Dashboard → Developers → API Keys → Secret |
| `stripe.webhook` | Stripe Dashboard → Developers → Webhooks → endpoint signing secret |

## Android signing (kept out of git)

| File | Where to keep it |
|---|---|
| `fitflow-release.keystore` | OFFLINE secure backup + local machine only |
| `android/keystore.properties` | Local machine only, gitignored |
| GH secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Repo Settings → Secrets and variables → Actions |
| `PLAY_SERVICE_ACCOUNT` (JSON) | Repo Settings → Secrets and variables → Actions |

## Firebase Hosting deploy

| GH Secret | Source |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Console → Project Settings → Service accounts → Generate new private key (JSON) |
| `FIREBASE_PROJECT_ID` | Firebase Console → Project Settings → General |

## Play Console upload (`PLAY_SERVICE_ACCOUNT`)

This is the one release secret that has never been set, so the "Upload to Play
Console closed-testing (alpha) track" step in `.github/workflows/deploy.yml` has
been **skipped on every tag so far** — v1.5.0 through v1.5.3 built and signed a
correct AAB, published it to the GitHub Release, and stopped there. Nothing
failed loudly, because the step is guarded by `if: env.PLAY_SA != ''`. Until
this is set, every Play upload is a manual drag-and-drop.

Create it once:

1. **Play Console → Setup → API access → Choose a project** — link the Play
   developer account to a Google Cloud project (the existing
   `gen-lang-client-0893216108` is fine).
2. In that Cloud project: **IAM & Admin → Service Accounts → Create**, name it
   e.g. `play-publisher`. It needs **no** Cloud IAM role — Play grants its own.
3. On the new account: **Keys → Add key → Create new key → JSON**. Download it.
4. Back in **Play Console → Users and permissions → Invite new user**, paste the
   service account's email (`play-publisher@…iam.gserviceaccount.com`), scope it
   to the **FitFlow** app, and grant **Release → Release apps to testing tracks**
   (add *Release to production* only when you leave closed testing).
5. Set the secret from the downloaded JSON:

```bash
gh secret set PLAY_SERVICE_ACCOUNT --repo yugen379/fitflow < ~/Downloads/play-publisher-*.json
```

Then delete the local JSON — it is a publishing credential.

From the next `v*` tag on, the alpha-track upload happens automatically. Note the
workflow uploads `packageName: com.fitflow.fitness` (the `applicationId`), not
the `com.fitflow.app` namespace.

### Uploading by hand in the meantime

Play Console → FitFlow → Testing → **Closed testing** → alpha → **Create new
release** → upload `fitflow-vX.Y.Z-play.aab` from the GitHub Release (the
`-play` bundle, **not** the `.apk` — the APK carries the Stripe checkout that
Play payments policy forbids).
