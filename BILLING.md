# FitFlow Billing — Stripe setup

This is everything needed to switch the 6-day cardless trial + paid subscriptions
from "code-complete" to "live". The code is done; only the Stripe account wiring
and a few config values remain — and those are the values you said you'd give me.

## How it works (no surprises)

- **6-day free trial, no card.** Starts automatically the moment a user signs up
  (`trialStartedAt` is written with the server clock and is immutable). When it
  ends, the account quietly drops to the free tier — it **never auto-charges**.
- **Paid plans.** Monthly **$17.99**, Yearly **$59.88** ($4.99/mo). The user only
  enters a card if/when they choose to subscribe, via Stripe Checkout.
- **Entitlement is server-trusted.** The Stripe webhook is the only thing that can
  grant Pro; the client can never write billing fields (enforced by Firestore rules).
- **Grace + cancel handled.** Failed payments keep Pro for a 3-day grace window;
  cancellations keep Pro until the paid period ends.

## What I need from you (the Stripe part)

1. A **Stripe account** (test mode is fine to start).
2. Create one **Product** "FitFlow Pro" with **two recurring Prices**:
   - Monthly — **$17.99 / month** → copy the `price_…` id
   - Yearly — **$59.88 / year** → copy the `price_…` id
3. From Stripe → Developers → **API keys**: the **Secret key** (`sk_test_…` / `sk_live_…`).
4. After the webhook endpoint is deployed (step below), the **Webhook signing
   secret** (`whsec_…`).

Send me those 4 values (2 price IDs, secret key, webhook secret) and I'll finish
the wiring. **Never paste the secret key into client code or git** — it goes only
into Firebase Secret Manager.

## Server config (Cloud Functions — Secret Manager)

```bash
firebase functions:secrets:set STRIPE_SECRET_KEY      # paste sk_…
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET  # paste whsec_…
firebase deploy --only functions:createCheckoutSession,functions:createPortalSession,functions:stripeWebhook,functions:sendTrialEndingReminders
```

## Stripe webhook endpoint

In Stripe → Developers → Webhooks → Add endpoint:

- URL: `https://us-central1-<projectId>.cloudfunctions.net/stripeWebhook`
- Events to send:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`

Then copy that endpoint's signing secret into `STRIPE_WEBHOOK_SECRET` (above).

## Client config (.env / CI secrets)

```env
VITE_STRIPE_CHECKOUT_URL=https://us-central1-<projectId>.cloudfunctions.net/createCheckoutSession
VITE_STRIPE_PORTAL_URL=https://us-central1-<projectId>.cloudfunctions.net/createPortalSession
VITE_STRIPE_PRICE_MONTHLY=price_xxx   # the $17.99/mo price id
VITE_STRIPE_PRICE_YEARLY=price_yyy    # the $59.88/yr price id
VITE_ALL_FEATURES_FREE=false          # paywall + trial ON (set true to give everything away)
```

Enable the **Stripe Billing Portal** once in Stripe → Settings → Billing → Customer
portal (so "Manage subscription" works).

## Verify before shipping

```bash
npm run proof:subscription   # 41/41 — entitlement + nutrition-targets state machine
npm run lint                 # tsc --noEmit
npm run build                # production web build
```

Use a Stripe **test card** (`4242 4242 4242 4242`) end-to-end, then flip keys to live.

## Android / Google Play note

Google Play requires **Google Play Billing** for in-app digital subscriptions —
Stripe checkout inside the Android app is a policy risk. Current state:

- Android users get the **full 6-day cardless trial** (best UX, instant access).

---

# Android in-app purchases — Google Play Billing via RevenueCat

Web sells Pro through **Stripe**; the Android APK sells through **Google Play Billing**
(Play policy requires it for digital subscriptions). RevenueCat wraps Play Billing and
verifies receipts; its webhook writes the **same** user-doc entitlement fields the Stripe
webhook writes, so `lib/billing.ts` treats a Play subscriber and a Stripe subscriber
identically. **The code is done** — `playBillingService.ts`, the branched `Pro.tsx`
(native → Play, web → Stripe), and the `revenueCatWebhook` function. Only the account
setup + config values below remain, and it must be **tested on a real device / Play track**.

## What you must set up (accounts + console — can't be scripted)

1. **Google Play Console** (one-time $25): create the app `com.fitflow.app`, then under
   **Monetize → Subscriptions** create two subscription products:
   - `fitflow_pro_monthly` — $17.99 / month
   - `fitflow_pro_yearly` — $59.88 / year
   (Product IDs can differ; RevenueCat maps them, so naming is flexible.)
2. **Play Developer API service account**: Play Console → Setup → API access → create/link
   a Google Cloud service account with the **androidpublisher** role, download its JSON.
   RevenueCat needs this to verify Play purchases.
3. **RevenueCat** (free under $2.5k/mo): create a project → add the **Play** app
   (package `com.fitflow.app`) → upload that service-account JSON. Then:
   - Create an **Entitlement** with identifier **`pro`**.
   - Create **Products** pointing at the two Play subscription IDs, attach them to the
     `pro` entitlement.
   - Create an **Offering** (the default `current`) with a **Monthly** and an **Annual**
     package mapped to those products.
4. **Keys + secret:**
   - Copy the RevenueCat **Android public SDK key** (`goog_...`) →
     set `VITE_REVENUECAT_ANDROID_KEY` (env + CI secret), rebuild the APK.
   - Pick any strong string as the webhook auth header, then:
     `firebase functions:secrets:set REVENUECAT_WEBHOOK_AUTH` (paste the same string).
   - RevenueCat → project → **Webhooks** → URL = the deployed `revenueCatWebhook` function
     URL, **Authorization header** = that same string.

## How it behaves
- **Entitlement is server-trusted.** Only the RevenueCat webhook (admin SDK) grants Pro on
  Android; the client never writes billing fields (Firestore rules enforce this).
- **Renewals / cancels / refunds / billing issues** all flow through the webhook and map to
  `premium`/`free` + `cancelAtPeriodEnd` + a 3-day `graceUntil` on billing issues — same as Stripe.
- **Restore purchases** is wired (Play requirement) on the Pro page in the app.
- **Manage subscription** on Android deep-links to the Play subscriptions screen.

## Testing (before going live)
RevenueCat/Play purchases can only be truly tested on a **real device** with the app on a
Play **internal-testing** track and your tester account added as a **license tester**
(Play Console → Setup → License testing). Sandbox purchases won't charge real money.
