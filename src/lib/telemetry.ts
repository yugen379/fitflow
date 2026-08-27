// Initialized lazily so the SDK only loads if the user has the env vars set.
// Keeps the dev / un-configured build slim and avoids fingerprinting requests
// to third-party domains until billing is wired.

const SENTRY_DSN = (import.meta as any).env?.VITE_SENTRY_DSN as string | undefined;
const POSTHOG_KEY = (import.meta as any).env?.VITE_POSTHOG_KEY as string | undefined;
const POSTHOG_HOST = (import.meta as any).env?.VITE_POSTHOG_HOST as string | undefined;
const ENV = ((import.meta as any).env?.VITE_APP_ENV as string | undefined) || 'production';
const RELEASE = ((import.meta as any).env?.VITE_APP_VERSION as string | undefined) || '1.0.0';

type AnyFn = (...args: any[]) => any;

let sentry: any = null;
let posthog: any = null;
let initialized = false;

export const initTelemetry = async () => {
  if (initialized) return;
  initialized = true;

  if (SENTRY_DSN) {
    try {
      const mod: any = await import('@sentry/react');
      mod.init({
        dsn: SENTRY_DSN,
        environment: ENV,
        release: RELEASE,
        tracesSampleRate: 0.1,
        replaysSessionSampleRate: 0.05,
        replaysOnErrorSampleRate: 1.0,
      });
      sentry = mod;
    } catch (e) {
      console.warn('Sentry init skipped:', e);
    }
  }

  if (POSTHOG_KEY) {
    try {
      const mod: any = await import('posthog-js');
      mod.default.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST || 'https://us.i.posthog.com',
        capture_pageview: true,
        capture_pageleave: true,
        persistence: 'localStorage',
        autocapture: false, // explicit tracking only
      });
      posthog = mod.default;
    } catch (e) {
      console.warn('PostHog init skipped:', e);
    }
  }
};

export const identify = (uid: string, traits?: Record<string, any>) => {
  try { sentry?.setUser({ id: uid, ...traits }); } catch {}
  try { posthog?.identify(uid, traits); } catch {}
};

export const trackEvent = (name: string, props?: Record<string, any>) => {
  try { posthog?.capture(name, props); } catch {}
};

/**
 * Per-signature send budget.
 *
 * The errors most worth knowing about are the ones that repeat: a missing
 * index fires on every render of every affected screen, for every user, for as
 * long as it is missing. Unthrottled that is a quota bill and an unreadable
 * issue feed; throttled to nothing it is the silence this whole change exists
 * to end. So: the first few of any signature go up in full, then one per
 * cooldown window, and the report carries how many were suppressed — the count
 * is the severity signal.
 */
const BURST = 3;
const COOLDOWN_MS = 5 * 60 * 1000;
const seen = new Map<string, { sent: number; suppressed: number; last: number }>();

/** Bounded so a pathological signature space cannot grow this without limit. */
const MAX_SIGNATURES = 200;

const budget = (signature: string): { send: boolean; suppressed: number } => {
  const now = Date.now();
  let e = seen.get(signature);
  if (!e) {
    if (seen.size >= MAX_SIGNATURES) seen.clear();
    e = { sent: 0, suppressed: 0, last: 0 };
    seen.set(signature, e);
  }
  if (e.sent < BURST || now - e.last >= COOLDOWN_MS) {
    const suppressed = e.suppressed;
    e.sent++; e.suppressed = 0; e.last = now;
    return { send: true, suppressed };
  }
  e.suppressed++;
  return { send: false, suppressed: e.suppressed };
};

export interface CaptureOptions {
  /** Groups repeats. Defaults to the error's own message. */
  signature?: string;
  /** Sentry level; defaults to 'error'. */
  level?: 'fatal' | 'error' | 'warning' | 'info';
  /** Searchable key/value pairs. Keep these low-cardinality and PII-free. */
  tags?: Record<string, string>;
}

export const captureError: AnyFn = (
  err: unknown,
  context?: Record<string, any>,
  options: CaptureOptions = {},
) => {
  const message = err instanceof Error ? err.message : String(err);
  const signature = options.signature || message;
  const { send, suppressed } = budget(signature);
  if (!send) return;

  const extras = suppressed > 0 ? { ...context, suppressedSinceLastReport: suppressed } : context;

  // Un-configured builds (dev, and any environment where VITE_SENTRY_DSN is
  // unset) still surface the problem on the console. A swallowed failure must
  // be visible SOMEWHERE or it does not exist.
  if (!sentry) {
    if (typeof console !== 'undefined') {
      const log = options.level === 'warning' ? console.warn : console.error;
      log.call(console, `[${options.level || 'error'}] ${signature}`, err, extras || '');
    }
    return;
  }
  try {
    sentry.withScope((s: any) => {
      if (extras) s.setExtras(extras);
      if (options.tags) s.setTags(options.tags);
      if (options.level) s.setLevel(options.level);
      s.setFingerprint([signature]);
      sentry.captureException(err instanceof Error ? err : new Error(message));
    });
  } catch { /* telemetry must never be the thing that breaks the app */ }
};

/**
 * Report a failure the app deliberately recovers from.
 *
 * The app is full of `catch {}` — most of them correct, because a badge lookup
 * or a denormalisation must never break a meal log. What was missing is that
 * "recovered" was indistinguishable from "fine": nothing counted how often the
 * recovery path ran. Swallowing the effect on the user is right; swallowing the
 * signal is what let ten unreachable badges, a fake-workout write and fourteen
 * missing indexes live in production unnoticed.
 *
 * Use this in place of a bare `catch {}` wherever the failure means something.
 */
export const reportSwallowed = (
  where: string,
  err: unknown,
  context?: Record<string, any>,
) => {
  captureError(err, { ...context, where }, {
    signature: `swallowed:${where}`,
    level: 'warning',
    tags: { swallowed: 'true', where },
  });
};

export const isTelemetryConfigured = () => !!(SENTRY_DSN || POSTHOG_KEY);

/** Test seam: lets the proof harness exercise the throttle deterministically. */
export const __resetTelemetryThrottle = () => seen.clear();
