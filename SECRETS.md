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
