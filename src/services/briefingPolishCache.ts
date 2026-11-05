/**
 * Limits the AI rewrite of the coach briefing to one per part of the day.
 *
 * The briefing rebuilds on every Home visit and after every logged meal or glass
 * of water, and its text changes each time. Rewriting each version would use up
 * the user's daily AI allowance on wording alone. So each device gets one rewrite
 * per part of the day; if the facts change after that, the plain briefing shows,
 * because reusing an older rewrite would show out-of-date numbers.
 *
 * No Firebase and no browser APIs in the decision, so the proof can drive it.
 */
import { partOfDay, type CoachBriefing } from './coachBriefing';

export interface StoredPolish {
  slot: string;
  baseKey: string;
  polished: CoachBriefing | null;
}

export type PolishDecision = 'reuse' | 'plain' | 'call';

export const polishSlot = (now: Date, hour: number): string =>
  `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}-${partOfDay(hour)}`;

export const polishBaseKey = (base: CoachBriefing): string =>
  JSON.stringify([base.headline, base.subtitle, base.nudges.map((n) => [n.id, n.title, n.message])]);

export const decidePolish = (stored: StoredPolish | null, slot: string, baseKey: string): PolishDecision => {
  if (!stored || stored.slot !== slot) return 'call';
  return stored.baseKey === baseKey && stored.polished ? 'reuse' : 'plain';
};

const STORAGE_KEY = 'fitflow.briefingPolish';

// Storage can be missing or throw (private mode, cleared data). Without it there
// is no way to limit rewrites, so the caller must treat a failed save as "plain".
export const readPolish = (): StoredPolish | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const savePolish = (value: StoredPolish): boolean => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};
