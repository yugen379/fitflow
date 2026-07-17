# Make subscriptions purchasable in the Play Store build

**Why the Play build says "Subscriptions are coming to Google Play soon":**
Google Play **payments policy** forbids selling digital subscriptions through an
external checkout (Stripe) inside an app installed from Play — apps get rejected
or removed for it. So the Play AAB deliberately hides all purchase UI until
**Google Play Billing** is wired. The web app and the sideload APK
(github.com/yugen379/fitflow/releases) sell via Stripe today and are unaffected.

**The code is 100% ready.** RevenueCat purchase flow (`playBillingService.ts`),
the entitlement webhook (`revenueCatWebhook` — deployed), the Pro-page purchase
UI, and the CI wiring (`VITE_REVENUECAT_ANDROID_KEY` is already read by both
workflows) all exist. The moment the key below is set and a new tag is pushed,
the Play build shows the plan picker and sells through Google's own sheet.

The remaining steps are all dashboard clicks that only the account owner can do:

## 1. Google Play Console (~10 min)

1. **Merchant account**: Play Console → Settings → Payments profile. If you have
   never set one up, create it (required before Play can sell anything).
2. **Create the two subscriptions**: Play Console → FitFlow → Monetize →
   Products → Subscriptions → Create:
   - ID `fitflow_pro_monthly` — base plan `monthly-autorenew`, price **$4.99/month**
   - ID `fitflow_pro_yearly` — base plan `yearly-autorenew`, price **$60.10/year**
   - Activate both base plans.

## 2. RevenueCat (~10 min, free account)

1. Sign up at revenuecat.com → create project **FitFlow**.
2. Add an **Android (Play Store)** app: package `com.fitflow.fitness`.
3. Connect Play: RevenueCat asks for **Play service credentials** — follow their
   wizard (it walks you through creating/linking a Google Cloud service account
   and granting it access in Play Console → Users and permissions).
4. **Products**: import/add `fitflow_pro_monthly` and `fitflow_pro_yearly`.
5. **Entitlement**: create one with identifier exactly **`pro`**, attach both products.
6. **Offering**: in the `default` offering add two packages —
   **Monthly** → `fitflow_pro_monthly`, **Annual** → `fitflow_pro_yearly`.
7. **Webhook** (grants Pro in the app after purchase): Project → Integrations →
   Webhooks →
   - URL: `https://us-central1-gen-lang-client-0893216108.cloudfunctions.net/revenueCatWebhook`
   - Authorization header value: paste the contents of the local file
     `.revenuecat-webhook-auth.txt` (repo root, gitignored — already deployed
     to the server side).
8. Copy the **public Android SDK key** (starts with `goog_`) from
   Project settings → API keys.

## 3. Hand over one value (~1 min)

Set the key as a GitHub secret (it's a public/client key — safe in the client bundle):

```bash
gh secret set VITE_REVENUECAT_ANDROID_KEY --repo yugen379/fitflow
# paste the goog_… key
```

…or just paste the `goog_` key in chat.

## 4. Release

Push a new tag (or ask Claude to). CI rebuilds the Play AAB with the key baked
in → `purchaseUiAllowed()` flips true → the Play build shows the full plan
picker and sells through the native Google Play sheet. Upload the new
`fitflow-vX.Y.Z-play.aab` to the closed track.

**Testing tip:** add your Google account as a **license tester** (Play Console →
Settings → License testing) so test purchases don't charge real money.
