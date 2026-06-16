import type { UserProfile, SubscriptionStatus, BillingPlan } from '../types';

// ---------------------------------------------------------------------------
// FitFlow billing / entitlement engine
//
// This module is intentionally PURE (no firebase, no React) so the proof
// harness can import `computeEntitlement` and exercise the full state machine
// deterministically. The React app uses the thin wrappers at the bottom.
// ---------------------------------------------------------------------------

/** Length of the cardless free trial, in days. */
export const TRIAL_DAYS = 6;
/** How long Pro stays unlocked after a payment fails (Stripe dunning window). */
export const GRACE_DAYS = 3;
const DAY_MS = 86_400_000;

/** Coerce Firestore Timestamp | Date | number | ISO string -> epoch ms (or null). */
export const toMillis = (v: any): number | null => {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  if (v instanceof Date) return v.getTime();
  if (typeof v.toMillis === 'function') {
    try { return v.toMillis(); } catch { return null; }
  }
  if (typeof v.seconds === 'number') {
    return v.seconds * 1000 + (typeof v.nanoseconds === 'number' ? Math.floor(v.nanoseconds / 1e6) : 0);
  }
  if (typeof v._seconds === 'number') {
    return v._seconds * 1000 + (typeof v._nanoseconds === 'number' ? Math.floor(v._nanoseconds / 1e6) : 0);
  }
  return null;
};

export interface Entitlement {
  /** The single source of truth for "can this user use Pro features". */
  isPro: boolean;
  /** Display status. */
  status: SubscriptionStatus;
  /** Why they're entitled (or not). */
  source: 'launch' | 'paid' | 'trial' | 'grace' | 'none';
  trialActive: boolean;
  /** Whole days remaining in the trial (ceil), 0 when not trialing. */
  trialDaysLeft: number;
  trialEndsAt: number | null;
  /** Renewal / access-until date for paid (or canceled-but-not-yet-ended) subs. */
  renewsAt: number | null;
  plan: BillingPlan | null;
  cancelAtPeriodEnd: boolean;
}

const NONE: Entitlement = {
  isPro: false,
  status: 'free',
  source: 'none',
  trialActive: false,
  trialDaysLeft: 0,
  trialEndsAt: null,
  renewsAt: null,
  plan: null,
  cancelAtPeriodEnd: false,
};

/**
 * Pure entitlement calculation. `freeForAll` is the launch-mode flag.
 * Paid access always takes precedence over the trial for display purposes.
 */
export const computeEntitlement = (
  profile: Partial<UserProfile> | null | undefined,
  nowMs: number,
  freeForAll: boolean,
): Entitlement => {
  if (freeForAll) {
    return { ...NONE, isPro: true, status: 'active', source: 'launch' };
  }
  if (!profile) return { ...NONE };

  const plan = (profile.plan ?? null) as BillingPlan | null;
  const cancelAtPeriodEnd = !!profile.cancelAtPeriodEnd;
  const periodEnd = toMillis(profile.currentPeriodEnd);
  const graceUntil = toMillis(profile.graceUntil);
  const status = profile.subscriptionStatus;

  // --- Trial window (cardless, measured from the immutable trialStartedAt) ---
  const trialStart = toMillis(profile.trialStartedAt);
  const trialEndsAt = trialStart != null ? trialStart + TRIAL_DAYS * DAY_MS : null;
  const trialActive = trialEndsAt != null && nowMs < trialEndsAt;
  const trialDaysLeft = trialActive ? Math.max(0, Math.ceil((trialEndsAt! - nowMs) / DAY_MS)) : 0;

  // --- Paid access ---
  // The webhook keeps subscriptionType === 'premium' while a sub is healthy.
  // We add defensive period/grace checks so a stale 'premium' can't outlive its window.
  let paidPro = false;
  let paidSource: Entitlement['source'] = 'none';

  if (profile.subscriptionType === 'premium') {
    if (status === 'past_due') {
      // Only entitled during the explicit grace window.
      paidPro = graceUntil != null && nowMs < graceUntil;
      paidSource = 'grace';
    } else if (status === 'canceled') {
      // Cancelled but paid through the period end.
      paidPro = periodEnd != null && nowMs < periodEnd;
      paidSource = 'paid';
    } else if (status === 'expired') {
      paidPro = false;
    } else {
      // 'active', 'trialing', undefined (legacy) -> trust the premium flag.
      paidPro = true;
      paidSource = 'paid';
    }
  }

  const isPro = paidPro || trialActive;

  // --- Resolve display status (paid precedence) ---
  let displayStatus: SubscriptionStatus;
  if (paidPro) {
    displayStatus = status ?? 'active';
  } else if (trialActive) {
    displayStatus = 'trialing';
  } else if (trialEndsAt != null) {
    displayStatus = 'expired';
  } else {
    displayStatus = status ?? 'free';
  }

  return {
    isPro,
    status: displayStatus,
    source: isPro ? (paidPro ? paidSource : 'trial') : 'none',
    trialActive,
    trialDaysLeft,
    trialEndsAt,
    renewsAt: periodEnd,
    plan,
    cancelAtPeriodEnd,
  };
};

// ---------------------------------------------------------------------------
// React-facing wrappers (read env + wall clock). Keep these out of the harness.
// ---------------------------------------------------------------------------

/**
 * Launch-mode flag. When true, every feature is unlocked for everyone and we
 * hide all pricing/upsell UI. Defaults to FALSE now that monetization is live;
 * set VITE_ALL_FEATURES_FREE=true to flip back to launch giveaway mode.
 */
export const allFeaturesFree = (): boolean =>
  ((import.meta as any).env?.VITE_ALL_FEATURES_FREE ?? 'false') === 'true';

/** Full entitlement for the current profile, evaluated against the wall clock. */
export const getEntitlement = (profile?: UserProfile | null): Entitlement =>
  computeEntitlement(profile, Date.now(), allFeaturesFree());

/** True if Pro features should be treated as unlocked for this profile. */
export const isProUnlocked = (profile?: UserProfile | null): boolean =>
  getEntitlement(profile).isPro;
