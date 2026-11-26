import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  createReviewPrompter, appIsInteractive, currentSessionId,
  type ReviewOutcome, type ReviewTrigger,
} from '../lib/reviewPrompt';

/**
 * Google Play in-app review, asked only at a genuine win.
 *
 * Callers never import this statically — it is loaded on the first win:
 *
 *   void import('../services/reviewService').then((m) => m.maybeAskForReview('gps_activity')).catch(() => {});
 *
 * so it costs nothing at cold start (scripts/perf-proof.mjs checks that).
 * The rules live in lib/reviewPrompt.ts and are proven by
 * `npm run proof:reviewprompt`.
 *
 * Android only. On the web and on iOS this is a no-op ('unsupported').
 *
 * The native flow resolves when it FINISHES. Play never says whether the card
 * was shown or whether the user rated, so nothing here branches on that.
 *
 * Capacitor trap: a plugin object is a Proxy that answers to `then`. Never
 * return `Review` from an async function and never `await Review` — that waits
 * forever. Only its methods are called (scripts/health-import-proof.mjs scans
 * for this).
 */
interface ReviewPluginShape {
  requestReview(): Promise<{ flowFinished: boolean; installerIsPlay: boolean }>;
}

const Review = registerPlugin<ReviewPluginShape>('Review');

const supported = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('Review');

const storage = () => {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
};

const prompter = createReviewPrompter({
  storage: storage(),
  now: () => Date.now(),
  sessionId: currentSessionId,
  interactive: appIsInteractive,
  visible: () => typeof document !== 'undefined' && document.visibilityState === 'visible',
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  requestReview: () => Review.requestReview(),
});

/** Ask for a Play review if, and only if, the policy allows it right now. Never throws. */
export const maybeAskForReview = async (trigger: ReviewTrigger): Promise<ReviewOutcome | 'unsupported'> => {
  if (!supported()) return 'unsupported';
  try {
    return await prompter(trigger);
  } catch {
    return 'failed';
  }
};
