# FitFlow launch playbook

Exact step-by-step list of commands and clicks to take FitFlow from local dev
to a closed-beta on Google Play Open Testing, then to a paid public launch.
Run from `C:\Users\SMKKAMPONGSELAMATGUR\Desktop\fitflow\fitflow_FINAL\fitflow_final`
unless noted.

---

## Tier 0 — pre-flight (15 minutes)

```powershell
# Install Firebase CLI globally
npm install -g firebase-tools
firebase login           # sign in with the Google account that owns the Firebase project
firebase use --add       # pick gen-lang-client-0893216108 → alias "default"
```

Create the `.env.local` file by copying `.env.example` and filling in values from
`firebase-applet-config.json`. See `SECRETS.md` for the full source list.

---

## Tier 1 — closed beta on Google Play Open Testing (1–2 days)

### 1. Deploy Firestore rules

```powershell
firebase deploy --only firestore:rules
```

The local `firestore.rules` already includes the new fields (`goalWeight`,
`tzOffsetHours`, `weightUnit`, `healthConnectConnected`, etc).

### 2. Build and deploy Cloud Functions

```powershell
cd functions
npm install
firebase functions:config:set gemini.key="YOUR_GEMINI_KEY"
# (Stripe values come in step 4)
cd ..
firebase deploy --only functions
```

After it deploys, copy the printed URLs. They look like:

```
https://us-central1-gen-lang-client-0893216108.cloudfunctions.net/geminiProxy
https://us-central1-gen-lang-client-0893216108.cloudfunctions.net/createCheckoutSession
```

Put those into `.env.local` as `VITE_GEMINI_PROXY_URL` and `VITE_STRIPE_CHECKOUT_URL`.

### 3. Set up Sentry (5 min)

1. Create a free Sentry account → New Project → **React**
2. Copy the **DSN** → paste into `.env.local` as `VITE_SENTRY_DSN`

### 4. Set up Stripe (20 min, test mode is fine for beta)

1. Create a Stripe account → switch to **Test mode** (top right)
2. **Products → Add product** → "FitFlow Pro"
3. Create two prices:
   - Recurring · $9.99 / month → copy the `price_xxx` ID
   - Recurring · $60.10 / year → copy the `price_xxx` ID
4. Paste them into `.env.local` as `VITE_STRIPE_PRICE_MONTHLY` and `VITE_STRIPE_PRICE_YEARLY`
5. **Developers → API keys** → copy the **Secret key** (test mode `sk_test_...`)
6. Configure Stripe Cloud Function:
   ```powershell
   firebase functions:config:set stripe.secret="sk_test_xxx"
   firebase deploy --only functions
   ```
7. **Developers → Webhooks → Add endpoint**
   - URL: `https://us-central1-gen-lang-client-0893216108.cloudfunctions.net/stripeWebhook`
   - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Copy the **Signing secret** (`whsec_xxx`)
8. Set it and redeploy:
   ```powershell
   firebase functions:config:set stripe.webhook="whsec_xxx"
   firebase deploy --only functions
   ```

### 5. Generate the Android release keystore

```powershell
keytool -genkey -v -keystore android\app\fitflow-release.keystore `
        -alias fitflow -keyalg RSA -keysize 2048 -validity 10000
```

It will prompt for two passwords (store + key) and your identity details.
**Back up this keystore file somewhere secure (1Password, BitWarden, etc).**
Losing it means you can never publish updates.

Then create `android/keystore.properties` by copying `android/keystore.properties.example`
and filling in the values.

### 6. Build the signed Android Bundle (AAB)

```powershell
npm run build
npx cap sync android
cd android
.\gradlew.bat bundleRelease
cd ..
# Output: android\app\build\outputs\bundle\release\app-release.aab
```

### 7. Set up Google Play Console (1 hr)

1. Create a developer account at https://play.google.com/console (one-time $25)
2. **Create app** → set name to "FitFlow", default language English, type "App", free
3. Fill in **Store listing** (short + long description, screenshots, feature graphic)
4. Fill in **Data safety** form — see `SECRETS.md` for the data inventory
5. Fill in **Health Connect declaration** (privacy URL + intended use)
6. **Testing → Internal testing → Create release**
   - Upload `app-release.aab`
   - Add testers (your friends' Gmail addresses)
   - Save → Review release → Start rollout

### 8. Host the privacy policy publicly

Either:
- Deploy this app to Firebase Hosting (`firebase deploy --only hosting`) and use `https://your-project.web.app/privacy`
- Or push `src/pages/Privacy.tsx` content to a static site like a GitHub Pages repo

Replace `[REPLACE WITH REGISTERED BUSINESS ADDRESS]` in `src/pages/Privacy.tsx`
and `src/pages/Terms.tsx` with your real entity info.

### 9. Smoke-test on a real Android device

- Install via the internal testing link
- Sign in, finish onboarding, log a meal (barcode + AI), do a workout, try Form Check
- Subscribe to Pro (test card `4242 4242 4242 4242`, any future date, any CVC)
- Confirm `subscriptionType` flips to `premium` in Firestore via the webhook

---

## Tier 2 — public launch (2–4 weeks)

### 10. Switch Stripe to live mode

1. Stripe Dashboard → toggle **Live mode** (top right)
2. Create the same products + prices in live mode → copy new `price_xxx` IDs
3. Get new live `sk_live_xxx` secret key and `whsec_xxx` webhook secret
4. Update Cloud Functions config:
   ```powershell
   firebase functions:config:set stripe.secret="sk_live_xxx" stripe.webhook="whsec_xxx"
   firebase deploy --only functions
   ```
5. Update `.env.local` (and GitHub secrets) with live price IDs

### 11. Legal review

- Send `src/pages/Privacy.tsx` and `src/pages/Terms.tsx` to a lawyer who has
  reviewed B2C consumer apps that handle health data
- Get a Data Processing Agreement template if you'll have EU users
- Apply for the Google Health Connect data-handling review (1–3 weeks)

### 12. Promote to production track

After 1–2 weeks of internal testing with no critical bugs:

1. Play Console → **Production → Create release** → upload signed AAB
2. Rollout to 1% first → monitor Sentry → expand to 10% → 100%

### 13. Set up monitoring alerts

- Sentry: alert on error rate > 1% over 1h
- PostHog: dashboards for activation (% who finish onboarding), retention (D1/D7/D30), Pro conversion
- Firebase Console → Performance Monitoring → enable

---

## Tier 3 — iOS

1. Get an Apple Developer account ($99/year) at https://developer.apple.com
2. Need a Mac with Xcode 15+
3. Follow `ios/README.md` in this repo for the exact steps

---

## What I will need from you to finish the automation

After you have these I can finish the wiring without further input:

| Need | Where to get it | What I do with it |
|---|---|---|
| `gemini.key` value | https://aistudio.google.com/app/apikey | `firebase functions:config:set gemini.key=` |
| `VITE_GEMINI_PROXY_URL` | Printed after `firebase deploy --only functions` | Add to `.env.local` |
| Stripe **test** secret key | https://dashboard.stripe.com/test/apikeys | `firebase functions:config:set stripe.secret=` |
| Stripe test `price_xxx` monthly + yearly | Stripe Dashboard → Products | Add to `.env.local` |
| Stripe webhook signing secret | Stripe Dashboard → Developers → Webhooks | `firebase functions:config:set stripe.webhook=` |
| Sentry DSN | https://sentry.io | Add to `.env.local` |
| Real domain or Firebase Hosting URL for privacy policy | Your call | Update Privacy/Terms + Play Console listing |
| Keystore passwords + store path | You choose when running `keytool` | Add to `android/keystore.properties` |
| Registered business entity name + address | Your call | Replace `[REPLACE WITH ...]` placeholders in Privacy/Terms |
| Google Play developer account email | Your call | Used to create the Play Console listing |

Paste those values back when you have them and I'll finish wiring everything.
