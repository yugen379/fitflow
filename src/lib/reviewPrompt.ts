/**
 * When to ask for a Google Play review. Pure policy + a small orchestrator that
 * takes all of its side effects as arguments, so `npm run proof:reviewprompt`
 * can drive every rule with a fake clock.
 *
 * Ask only when ALL of these hold:
 *   1. the moment is a genuine win (one of WIN_TRIGGERS),
 *   2. the app has been used on >= 5 distinct local days,
 *   3. >= 3 days have passed since this install first opened,
 *   4. no previous ask in the last 120 days,
 *   5. fewer than 3 asks ever,
 *   6. no user-visible error in the last 10 minutes,
 *   7. not the first session of the day while the app is still not
 *      interactive (splash up, or the user has not touched it yet).
 *
 * "Install" is the first time this install's storage saw the app. localStorage
 * is wiped on uninstall, so that is the install date; for users who already had
 * the app before this shipped it is the update date, which only makes the
 * first ask later — never earlier.
 *
 * This module imports nothing. It is loaded at boot (to count days of use and
 * note errors); everything native lives in services/reviewService.ts, which is
 * loaded only on the first win.
 */

export const WIN_TRIGGERS = ['daily_goal', 'streak_7', 'personal_record', 'gps_activity', 'smart_target'] as const;
export type ReviewTrigger = (typeof WIN_TRIGGERS)[number];

export const DAY_MS = 86_400_000;
export const MIN_DISTINCT_DAYS = 5;
export const MIN_INSTALL_AGE_MS = 3 * DAY_MS;
export const COOLDOWN_MS = 120 * DAY_MS;
export const MAX_ASKS = 3;
export const ERROR_QUIET_MS = 10 * 60_000;
/** A pause longer than this before coming back to the app starts a new session. */
export const NEW_SESSION_AFTER_MS = 30 * 60_000;
/** Let the win's own celebration land before the review card covers it. */
export const ASK_DELAY_MS = 1800;

export const STORAGE_KEY = 'ff_review_v1';
/** Only the count matters (>= 5), so the list stays short. */
const MAX_DAYS_KEPT = 12;

export interface ReviewState {
  /** Epoch ms of the first open this install's storage has seen. */
  firstSeenAt: number | null;
  /** Distinct local days (YYYY-MM-DD) the app was opened, most recent last. */
  usedDays: string[];
  /** Epoch ms of every ask ever made, oldest first. */
  asks: number[];
  /** Epoch ms of the last error the user could see. */
  lastErrorAt: number | null;
  /** The first session of `day`, so later sessions that day can be told apart. */
  firstSession: { day: string; id: string } | null;
}

export const emptyState = (): ReviewState => ({
  firstSeenAt: null, usedDays: [], asks: [], lastErrorAt: null, firstSession: null,
});

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse stored state. Anything malformed falls back to defaults, never throws. */
export const parseState = (raw: string | null | undefined): ReviewState => {
  const s = emptyState();
  if (!raw) return s;
  let o: any;
  try { o = JSON.parse(raw); } catch { return s; }
  if (!o || typeof o !== 'object') return s;
  if (isNum(o.firstSeenAt)) s.firstSeenAt = o.firstSeenAt;
  if (Array.isArray(o.usedDays)) s.usedDays = [...new Set(o.usedDays.filter((d: unknown) => typeof d === 'string' && DAY_RE.test(d)))] as string[];
  if (Array.isArray(o.asks)) s.asks = o.asks.filter(isNum).sort((a: number, b: number) => a - b);
  if (isNum(o.lastErrorAt)) s.lastErrorAt = o.lastErrorAt;
  if (o.firstSession && typeof o.firstSession.day === 'string' && typeof o.firstSession.id === 'string') {
    s.firstSession = { day: o.firstSession.day, id: o.firstSession.id };
  }
  return s;
};

/** Local calendar day, YYYY-MM-DD. */
export const localDayKey = (ms: number): string => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** The app was opened (or came back after a long pause). Returns new state. */
export const noteAppOpen = (state: ReviewState, now: number, sessionId: string): ReviewState => {
  const day = localDayKey(now);
  const usedDays = state.usedDays.includes(day) ? state.usedDays : [...state.usedDays, day].slice(-MAX_DAYS_KEPT);
  const firstSession = state.firstSession?.day === day ? state.firstSession : { day, id: sessionId };
  return { ...state, firstSeenAt: state.firstSeenAt ?? now, usedDays, firstSession };
};

export const noteError = (state: ReviewState, now: number): ReviewState => ({ ...state, lastErrorAt: now });

export const recordAsk = (state: ReviewState, now: number): ReviewState => ({ ...state, asks: [...state.asks, now] });

export interface ReviewContext {
  now: number;
  trigger: string;
  sessionId: string;
  /** Splash gone AND the user has touched the app since this session began. */
  interactive: boolean;
}

export type ReviewDecision =
  | { ask: true; reason: 'ok' }
  | { ask: false; reason: 'not-a-win' | 'max-asks' | 'cooldown' | 'clock' | 'too-new' | 'few-days' | 'recent-error' | 'not-interactive' };

export const isWinTrigger = (t: string): t is ReviewTrigger => (WIN_TRIGGERS as readonly string[]).includes(t);

/** The whole policy. Pure: same state + context, same answer. */
export const decideReview = (state: ReviewState, ctx: ReviewContext): ReviewDecision => {
  const { now } = ctx;
  if (!isWinTrigger(ctx.trigger)) return { ask: false, reason: 'not-a-win' };
  if (state.asks.length >= MAX_ASKS) return { ask: false, reason: 'max-asks' };
  const lastAsk = state.asks.length ? state.asks[state.asks.length - 1] : null;
  // A clock that went backwards (time zone travel, manual change) must not
  // make an old ask look like it is in the future-and-therefore-fine.
  if (lastAsk !== null && lastAsk > now) return { ask: false, reason: 'clock' };
  if (lastAsk !== null && now - lastAsk < COOLDOWN_MS) return { ask: false, reason: 'cooldown' };
  if (state.firstSeenAt === null || state.firstSeenAt > now) return { ask: false, reason: state.firstSeenAt === null ? 'too-new' : 'clock' };
  if (now - state.firstSeenAt < MIN_INSTALL_AGE_MS) return { ask: false, reason: 'too-new' };
  if (state.usedDays.length < MIN_DISTINCT_DAYS) return { ask: false, reason: 'few-days' };
  // Negative gap (an error stamped 'in the future' after a clock change) also blocks.
  if (state.lastErrorAt !== null && now - state.lastErrorAt < ERROR_QUIET_MS) return { ask: false, reason: 'recent-error' };
  const firstSessionToday = state.firstSession?.day === localDayKey(now) && state.firstSession.id === ctx.sessionId;
  if (firstSessionToday && !ctx.interactive) return { ask: false, reason: 'not-interactive' };
  return { ask: true, reason: 'ok' };
};

// ─── Orchestration (side effects injected) ────────────────────────────────────

export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }

export const loadState = (storage: StorageLike | null): ReviewState => {
  try { return parseState(storage?.getItem(STORAGE_KEY)); } catch { return emptyState(); }
};
export const saveState = (storage: StorageLike | null, state: ReviewState): void => {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
};

export interface PrompterDeps {
  storage: StorageLike | null;
  now: () => number;
  sessionId: () => string;
  interactive: () => boolean;
  /** Page visible right now (the user is looking at the app). */
  visible: () => boolean;
  sleep: (ms: number) => Promise<void>;
  /** Launch the native flow. Resolves when it finishes; rejects if it could not start. */
  requestReview: () => Promise<unknown>;
}

export type ReviewOutcome = ReviewDecision['reason'] | 'busy' | 'asked-this-session' | 'hidden' | 'requested' | 'failed';

/**
 * One prompter per app session. At most one native request per session, and a
 * second win while the first is pending is ignored. The policy is checked
 * again after the delay (an error could have happened meanwhile). The ask is
 * stored BEFORE the native call so a crash in the flow cannot cause a loop of
 * asks; if the flow could not even start, the ask is rolled back.
 */
export const createReviewPrompter = (deps: PrompterDeps) => {
  let busy = false;
  let doneThisSession = false;

  const check = (trigger: string): ReviewDecision =>
    decideReview(loadState(deps.storage), {
      now: deps.now(), trigger, sessionId: deps.sessionId(), interactive: deps.interactive(),
    });

  return async (trigger: string): Promise<ReviewOutcome> => {
    if (busy) return 'busy';
    if (doneThisSession) return 'asked-this-session';
    const first = check(trigger);
    if (!first.ask) return first.reason;
    busy = true;
    try {
      await deps.sleep(ASK_DELAY_MS);
      const again = check(trigger);
      if (!again.ask) return again.reason;
      if (!deps.visible()) return 'hidden';
      const before = loadState(deps.storage);
      saveState(deps.storage, recordAsk(before, deps.now()));
      doneThisSession = true;
      try {
        await deps.requestReview();
        return 'requested';
      } catch {
        // Nothing was shown, so it must not use up one of the three asks.
        // Keep any error/day noted meanwhile; drop only this ask.
        const cur = loadState(deps.storage);
        const asks = cur.asks.slice(0, before.asks.length);
        saveState(deps.storage, { ...cur, asks });
        return 'failed';
      }
    } finally {
      busy = false;
    }
  };
};

// ─── Boot-time signals ─────────────────────────────────────────────────────────
// Cheap listeners installed once at boot: they count days of use, mark the
// start of each session, and remember when the user last interacted and when
// they last saw an error. No imports, no network, no native calls.

const signals = {
  installed: false,
  sessionId: '',
  sessionSeq: 0,
  interactedThisSession: false,
  hiddenAt: 0,
  storage: null as StorageLike | null,
};

const safeStorage = (): StorageLike | null => {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
};

const beginSession = (now: number) => {
  signals.sessionSeq += 1;
  const origin = typeof performance !== 'undefined' && performance.timeOrigin ? Math.round(performance.timeOrigin) : now;
  signals.sessionId = `${origin}:${signals.sessionSeq}`;
  signals.interactedThisSession = false;
  saveState(signals.storage, noteAppOpen(loadState(signals.storage), now, signals.sessionId));
};

/** Install the boot-time listeners. Idempotent; a no-op outside a browser. */
export const startReviewSignals = (): void => {
  if (signals.installed || typeof window === 'undefined' || typeof document === 'undefined') return;
  signals.installed = true;
  signals.storage = safeStorage();
  beginSession(Date.now());
  const touched = () => { signals.interactedThisSession = true; };
  window.addEventListener('pointerdown', touched, { capture: true, passive: true });
  window.addEventListener('keydown', touched, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => {
    const now = Date.now();
    if (document.visibilityState === 'hidden') { signals.hiddenAt = now; return; }
    if (signals.hiddenAt && now - signals.hiddenAt >= NEW_SESSION_AFTER_MS) beginSession(now);
    else saveState(signals.storage, noteAppOpen(loadState(signals.storage), now, signals.sessionId));
    signals.hiddenAt = 0;
  });
  // Uncaught exceptions. Resource-load errors (target is an element) and the
  // benign ResizeObserver notice are not errors the user saw.
  window.addEventListener('error', (e) => {
    if (e.target && e.target !== window) return;
    if (/ResizeObserver/i.test(String(e.message || ''))) return;
    noteReviewError();
  });
};

/** A user-visible error happened (error toast, error boundary, uncaught error). */
export const noteReviewError = (): void => {
  const storage = signals.storage ?? safeStorage();
  saveState(storage, noteError(loadState(storage), Date.now()));
};

export const currentSessionId = (): string => signals.sessionId;

/** Splash gone and the user has touched the app since this session started. */
export const appIsInteractive = (): boolean =>
  typeof document !== 'undefined' && !document.getElementById('ff-splash') && signals.interactedThisSession;
