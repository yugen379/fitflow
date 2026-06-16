import { auth } from '../lib/firebase';
import { openExternal } from '../lib/openExternal';

const CHECKOUT_URL = (import.meta as any).env?.VITE_STRIPE_CHECKOUT_URL as string | undefined;
const PORTAL_URL = (import.meta as any).env?.VITE_STRIPE_PORTAL_URL as string | undefined;
const MONTHLY_PRICE = (import.meta as any).env?.VITE_STRIPE_PRICE_MONTHLY as string | undefined;
const YEARLY_PRICE = (import.meta as any).env?.VITE_STRIPE_PRICE_YEARLY as string | undefined;

export const isStripeConfigured = () => !!(CHECKOUT_URL && (MONTHLY_PRICE || YEARLY_PRICE));
export const isPortalConfigured = () => !!PORTAL_URL;

export type Plan = 'monthly' | 'yearly';

/**
 * Starts a Stripe Checkout session via the Cloud Function and opens the
 * hosted Checkout page. The Firebase ID token is passed so the function
 * can verify and tag the right user.
 */
export const startCheckout = async (plan: Plan): Promise<{ ok: boolean; reason?: string }> => {
  if (!CHECKOUT_URL) return { ok: false, reason: 'Billing is not configured yet.' };
  const priceId = plan === 'monthly' ? MONTHLY_PRICE : YEARLY_PRICE;
  if (!priceId) return { ok: false, reason: 'Selected plan is not configured.' };

  const user = auth.currentUser;
  if (!user) return { ok: false, reason: 'Please sign in first.' };
  const idToken = await user.getIdToken();

  const successUrl = `${window.location.origin}/pro?status=success`;
  const cancelUrl = `${window.location.origin}/pro?status=cancelled`;

  let res: Response;
  try {
    res = await fetch(CHECKOUT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ priceId, plan, successUrl, cancelUrl }),
    });
  } catch {
    return { ok: false, reason: 'Network error reaching billing.' };
  }
  if (!res.ok) {
    return { ok: false, reason: `Billing returned ${res.status}.` };
  }
  const data = await res.json().catch(() => ({}));
  if (!data?.url) return { ok: false, reason: 'No checkout URL returned.' };

  await openExternal(data.url);
  return { ok: true };
};

/**
 * Opens the Stripe Billing Portal so a paying user can update or cancel their
 * subscription. Requires VITE_STRIPE_PORTAL_URL (the createPortalSession fn).
 */
export const openBillingPortal = async (): Promise<{ ok: boolean; reason?: string }> => {
  if (!PORTAL_URL) return { ok: false, reason: 'Billing portal is not configured yet.' };
  const user = auth.currentUser;
  if (!user) return { ok: false, reason: 'Please sign in first.' };
  const idToken = await user.getIdToken();
  const returnUrl = `${window.location.origin}/settings`;

  let res: Response;
  try {
    res = await fetch(PORTAL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ returnUrl }),
    });
  } catch {
    return { ok: false, reason: 'Network error reaching billing.' };
  }
  if (!res.ok) return { ok: false, reason: `Billing returned ${res.status}.` };
  const data = await res.json().catch(() => ({}));
  if (!data?.url) return { ok: false, reason: 'No portal URL returned.' };

  await openExternal(data.url);
  return { ok: true };
};
