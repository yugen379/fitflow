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
- Paid checkout currently opens Stripe in an external browser.
- The clean, compliant path for the Play build is **Google Play Billing / RevenueCat**
  (separate task — needs Play Console product setup + a real-device test). Billing is
  already behind a thin service layer so this slots in without touching entitlement logic.
