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
import { isPlayStoreBuild } from '../lib/billing';
import type { Plan } from './stripeService';

const RC_ANDROID_KEY = (import.meta as any).env?.VITE_REVENUECAT_ANDROID_KEY as string | undefined;
const RC_IOS_KEY = (import.meta as any).env?.VITE_REVENUECAT_IOS_KEY as string | undefined;
// The entitlement identifier configured in the RevenueCat dashboard.
const ENTITLEMENT_ID = 'pro';
// com.fitflow.fitness — used only to deep-link the Play "manage subscription" screen.
const ANDROID_PACKAGE = 'com.fitflow.fitness';

let configured = false;
let configuredUid: string | null = null;

const platform = (): string => Capacitor?.getPlatform?.() ?? 'web';

/**
 * The RevenueCat key for the store this build ships through. Passing the
 * Android key to a StoreKit build (or vice versa) makes RevenueCat fail to
 * configure, so the platform picks the key — never the caller.
 */
const storeKey = (): string | undefined => {
  if (!Capacitor?.isNativePlatform?.()) return undefined;
  return platform() === 'ios' ? RC_IOS_KEY : RC_ANDROID_KEY;
};

/** True inside a native app that has a RevenueCat key for ITS OWN store. */
export const isStoreBillingConfigured = (): boolean => !!storeKey();

/** @deprecated Use isStoreBillingConfigured — this covers StoreKit too now. */
export const isPlayBillingConfigured = isStoreBillingConfigured;

/**
 * Whether this build may show purchase UI (pricing, plans, checkout entry
 * points).
 *
 * Android: false only in a Play Store build without Play Billing configured —
 * there the sole path would be external checkout, which Play policy forbids.
 *
 * iOS: there is no sideload channel, so EVERY iOS build is a store build. App
 * Store Guideline 3.1.1 forbids sending users to external checkout for digital
 * goods, so without a StoreKit key there is no purchase path at all — the app
 * shows what Pro includes and nothing more. VITE_PLAY_STORE_BUILD is not
 * consulted on iOS; it cannot be relied on to be set for an Xcode archive.
 */
export const purchaseUiAllowed = (): boolean => {
  if (isStoreBillingConfigured()) return true;
  if (platform() === 'ios') return false;
  return !(Capacitor?.isNativePlatform?.() && isPlayStoreBuild());
};

const loadRC = () => import('@revenuecat/purchases-capacitor');

/** Configure RevenueCat once with the Firebase uid as the app user id. Idempotent. */
export const configurePlayBilling = async (uid: string): Promise<void> => {
  if (!isPlayBillingConfigured() || !uid) return;
  try {
    const { Purchases, LOG_LEVEL } = await loadRC();
    if (!configured) {
      await Purchases.setLogLevel({ level: LOG_LEVEL.ERROR });
      await Purchases.configure({ apiKey: storeKey()!, appUserID: uid });
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

export interface StorePlanPrice {
  /** Localized, store-formatted price, e.g. "RM 253.00" / "$59.88". */
  priceString: string;
  price: number;
  currency: string;
  /** For yearly plans: the localized per-month equivalent (price / 12). */
  perMonthString?: string;
}

/**
 * Real, localized plan prices straight from Google Play — what the purchase
 * sheet will actually charge. Returns null off-Android / before configuration,
 * so callers fall back to the USD display prices. Never throws.
 */
export const getPlayPlanPrices = async (
  uid: string,
): Promise<{ monthly?: StorePlanPrice; yearly?: StorePlanPrice } | null> => {
  if (!isPlayBillingConfigured() || !uid) return null;
  try {
    await configurePlayBilling(uid);
    const { Purchases, PACKAGE_TYPE } = await loadRC();
    const offerings = await Purchases.getOfferings();
    const offering = offerings.current;
    if (!offering?.availablePackages?.length) return null;

    const pick = (type: any, re: RegExp) =>
      offering.availablePackages.find((p) => p.packageType === type) ||
      offering.availablePackages.find((p) => re.test(p.identifier));

    const toPrice = (pkg: any, perMonthDivisor = 1): StorePlanPrice | undefined => {
      const prod = pkg?.product;
      if (!prod?.priceString) return undefined;
      const out: StorePlanPrice = {
        priceString: prod.priceString,
        price: Number(prod.price) || 0,
        currency: prod.currencyCode || '',
      };
      if (perMonthDivisor > 1 && out.price > 0 && out.currency) {
        try {
          out.perMonthString = new Intl.NumberFormat(undefined, {
            style: 'currency', currency: out.currency,
          }).format(out.price / perMonthDivisor);
        } catch { /* unknown currency code — skip the equivalence line */ }
      }
      return out;
    };

    return {
      monthly: toPrice(pick(PACKAGE_TYPE.MONTHLY, /month/i)),
      yearly: toPrice(pick(PACKAGE_TYPE.ANNUAL, /annual|year/i), 12),
    };
  } catch {
    return null;
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

/**
 * Deep-link to the store's own subscriptions screen (RevenueCat has no manage
 * UI). iOS must point at Apple's page — sending an App Store subscriber to a
 * Play URL leaves them with no way to cancel, which Apple treats as a defect.
 */
export const openPlaySubscriptions = async (): Promise<void> => {
  const url = platform() === 'ios'
    ? 'https://apps.apple.com/account/subscriptions'
    : `https://play.google.com/store/account/subscriptions?package=${ANDROID_PACKAGE}`;
  try {
    const { openExternal } = await import('../lib/openExternal');
    await openExternal(url);
  } catch {
    /* best-effort */
  }
};
