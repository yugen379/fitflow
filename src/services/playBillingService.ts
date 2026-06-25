// Android in-app purchases via Google Play Billing, through RevenueCat.
//
// Web sells Pro through Stripe (stripeService.ts); the Android APK MUST sell
// digital subscriptions through Google Play Billing (Play policy). RevenueCat wraps
// Play Billing and does the receipt verification + renewal/refund bookkeeping; its
// webhook (functions: revenueCatWebhook) writes the SAME user-doc entitlement fields
// the Stripe webhook does, so lib/billing.ts treats both identically.
//
// Native-only and env-gated (VITE_REVENUECAT_ANDROID_KEY): on web / when unset every
// call is an inert no-op, and nothing here ever throws to the UI. The RevenueCat
// `appUserID` is the Firebase uid, so the webhook can map a purchase back to the user.

import { Capacitor } from '@capacitor/core';
import type { Plan } from './stripeService';

const RC_ANDROID_KEY = (import.meta as any).env?.VITE_REVENUECAT_ANDROID_KEY as string | undefined;
// The entitlement identifier configured in the RevenueCat dashboard.
const ENTITLEMENT_ID = 'pro';
// com.fitflow.fitness — used only to deep-link the Play "manage subscription" screen.
const ANDROID_PACKAGE = 'com.fitflow.fitness';

let configured = false;
let configuredUid: string | null = null;

/** True only inside the Android app with a RevenueCat key configured. */
export const isPlayBillingConfigured = (): boolean =>
  !!(Capacitor?.isNativePlatform?.() && RC_ANDROID_KEY);

const loadRC = () => import('@revenuecat/purchases-capacitor');

/** Configure RevenueCat once with the Firebase uid as the app user id. Idempotent. */
export const configurePlayBilling = async (uid: string): Promise<void> => {
  if (!isPlayBillingConfigured() || !uid) return;
  try {
    const { Purchases, LOG_LEVEL } = await loadRC();
    if (!configured) {
      await Purchases.setLogLevel({ level: LOG_LEVEL.ERROR });
      await Purchases.configure({ apiKey: RC_ANDROID_KEY!, appUserID: uid });
      configured = true;
      configuredUid = uid;
    } else if (configuredUid !== uid) {
      await Purchases.logIn({ appUserID: uid });
      configuredUid = uid;
    }
  } catch (e) {
    console.warn('RevenueCat configure failed:', e);
  }
};

const hasPro = (customerInfo: any): boolean => {
  const active = customerInfo?.entitlements?.active || {};
  // Prefer the named entitlement, but treat ANY active entitlement as Pro so a
  // dashboard misconfiguration can't silently lock a paying user out.
  return !!active[ENTITLEMENT_ID] || Object.keys(active).length > 0;
};

export interface PurchaseOutcome {
  ok: boolean;
  reason?: string;     // 'cancelled' when the user backed out
  pro?: boolean;       // entitlement active immediately after the call
}

/** Launch the Play purchase sheet for the chosen plan. Never throws. */
export const startPlayPurchase = async (uid: string, plan: Plan): Promise<PurchaseOutcome> => {
  if (!isPlayBillingConfigured()) return { ok: false, reason: 'In-app purchases are not available here.' };
  try {
    await configurePlayBilling(uid);
    const { Purchases, PACKAGE_TYPE } = await loadRC();
    const offerings = await Purchases.getOfferings();
    const offering = offerings.current;
    if (!offering || !offering.availablePackages?.length) {
      return { ok: false, reason: 'No plans available right now.' };
    }
    const wantType = plan === 'yearly' ? PACKAGE_TYPE.ANNUAL : PACKAGE_TYPE.MONTHLY;
    const pkg =
      offering.availablePackages.find((p) => p.packageType === wantType) ||
      offering.availablePackages.find((p) => /annual|year/i.test(p.identifier) === (plan === 'yearly')) ||
      offering.availablePackages[0];
    const result = await Purchases.purchasePackage({ aPackage: pkg });
    return { ok: true, pro: hasPro(result.customerInfo) };
  } catch (e: any) {
    if (e?.userCancelled || e?.code === '1' || /cancel/i.test(e?.message || '')) {
      return { ok: false, reason: 'cancelled' };
    }
    return { ok: false, reason: e?.message || 'Purchase could not be completed.' };
  }
};

/** Restore a previous purchase (e.g. new device / reinstall). Never throws. */
export const restorePlayPurchases = async (uid: string): Promise<PurchaseOutcome> => {
  if (!isPlayBillingConfigured()) return { ok: false, reason: 'Not available here.' };
  try {
    await configurePlayBilling(uid);
    const { Purchases } = await loadRC();
    const { customerInfo } = await Purchases.restorePurchases();
    return { ok: true, pro: hasPro(customerInfo) };
  } catch (e: any) {
    return { ok: false, reason: e?.message || 'Could not restore purchases.' };
  }
};

/** Deep-link to the Play subscriptions screen (RevenueCat has no manage UI). */
export const openPlaySubscriptions = async (): Promise<void> => {
  const url = `https://play.google.com/store/account/subscriptions?package=${ANDROID_PACKAGE}`;
  try {
    const { openExternal } = await import('../lib/openExternal');
    await openExternal(url);
  } catch {
    /* best-effort */
  }
};
