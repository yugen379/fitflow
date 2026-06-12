import type { UserProfile } from '../types';

// Launch-mode flag: when set (default true), all features are unlocked for everyone
// and we hide all pricing/upsell UI to avoid contradicting the "everything free" promise.
export const allFeaturesFree = (): boolean =>
  ((import.meta as any).env?.VITE_ALL_FEATURES_FREE ?? 'true') !== 'false';

// True if Pro features should be treated as unlocked for this profile.
export const isProUnlocked = (profile?: UserProfile | null): boolean =>
  allFeaturesFree() || profile?.subscriptionType === 'premium';
