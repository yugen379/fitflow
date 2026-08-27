// What the free tier can and cannot do.
//
// The entitlement engine (lib/billing.ts) has always been able to answer "is
// this user Pro?" — but until now nothing asked it except a badge on the
// Profile screen. Every feature was free to everyone, trial or not, paid or
// not. This module is the missing half: the list of what Pro actually buys.
//
// Deliberately a PURE map from feature -> entitlement, with no React, no
// Firebase and no side effects, so `npm run proof:features` can prove the
// whole matrix without a browser.
//
// ── The deal ────────────────────────────────────────────────────────────────
//
// A new account gets EVERYTHING for the length of the trial. Nothing is teased,
// nothing is stubbed — the trial has to show the real product or it cannot sell
// it. When the trial ends, four things become Pro-only and the rest of the app
// keeps working forever, free:
//
//   FREE, always            Pro-only after the trial
//   ─────────────────────   ─────────────────────────────────────────────
//   step counting           AI Coach chat
//   meal + workout logging  analytics beyond the last 7 days
//   barcode scanning        the AI weekly recap
//   AI meal plans           the 3D Biomechanics Lab
//   AI form check           unlimited streak freezes (free: 1 a month)
//   AI photo/label scan     Pro-only challenges
//   community, challenges
//   badges, missions, XP
//
// The AI meal plan, form check and label scan stay free ON PURPOSE even though
// they cost Gemini calls: they are what makes someone finish onboarding and
// come back on day two. Coach chat is the one that is both open-ended in cost
// and the clearest single reason to pay.

import type { UserProfile } from '../types';
import { getEntitlement, type Entitlement } from './billing';

export type Feature =
  | 'coach-chat'
  | 'analytics-history'
  | 'weekly-recap'
  | 'biomechanics-lab'
  | 'unlimited-streak-freeze'
  | 'pro-challenges';

export interface FeatureMeta {
  /** Shown on the lock overlay. */
  title: string;
  /** One line: what they get, phrased as the benefit, not the restriction. */
  pitch: string;
}

export const PRO_FEATURES: Record<Feature, FeatureMeta> = {
  'coach-chat': {
    title: 'AI Coach',
    pitch: 'Ask your coach anything, any time — it knows your training, food and sleep.',
  },
  'analytics-history': {
    title: 'Full history',
    pitch: 'See every week, month and year of your progress, not just the last 7 days.',
  },
  'weekly-recap': {
    title: 'Weekly recap',
    pitch: 'A written read on your week, every week, from your own numbers.',
  },
  'biomechanics-lab': {
    title: 'Biomechanics Lab',
    pitch: 'Watch the lift in 3D and see which muscles are actually doing the work.',
  },
  'unlimited-streak-freeze': {
    title: 'Unlimited streak freezes',
    pitch: 'Never lose a streak to a rest day, an illness or a flight.',
  },
  'pro-challenges': {
    title: 'Pro challenges',
    pitch: 'Compete in the challenges reserved for members.',
  },
};

/** Every feature id, for exhaustive tests and UI listings. */
export const ALL_PRO_FEATURES = Object.keys(PRO_FEATURES) as Feature[];

/** How many days of analytics history the free tier keeps. */
export const FREE_HISTORY_DAYS = 7;

/** Streak freezes a free account gets per calendar month. */
export const FREE_STREAK_FREEZES_PER_MONTH = 1;

/**
 * The one question every gate asks.
 *
 * Takes an already-computed Entitlement so callers that already have one do not
 * recompute it, and so tests can pass a synthetic entitlement without mocking
 * the clock. During the trial, and on a paid plan, and in launch-giveaway mode,
 * `isPro` is true and everything is unlocked.
 */
export const isFeatureUnlocked = (feature: Feature, ent: Entitlement): boolean => {
  // An unknown id must never silently unlock. Fail closed.
  if (!(feature in PRO_FEATURES)) return false;
  return ent.isPro === true;
};

/** Convenience for components that only hold a profile. */
export const canUse = (feature: Feature, profile?: UserProfile | null): boolean =>
  isFeatureUnlocked(feature, getEntitlement(profile));

/**
 * How many days of history this account may see.
 *
 * Free accounts keep a rolling week. Nothing is deleted — the data is theirs and
 * it is all still on the server; the chart simply stops earlier until they
 * subscribe, and fills back in the moment they do.
 */
export const historyDaysFor = (ent: Entitlement): number =>
  ent.isPro ? Number.POSITIVE_INFINITY : FREE_HISTORY_DAYS;

/** Streak freezes allowed this month. */
export const streakFreezeAllowanceFor = (ent: Entitlement): number =>
  ent.isPro ? Number.POSITIVE_INFINITY : FREE_STREAK_FREEZES_PER_MONTH;
