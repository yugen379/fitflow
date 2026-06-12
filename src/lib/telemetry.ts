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

export const captureError: AnyFn = (err: unknown, context?: Record<string, any>) => {
  if (!sentry) {
    if (typeof console !== 'undefined') console.error('Error:', err, context);
    return;
  }
  try {
    if (context) sentry.withScope((s: any) => { s.setExtras(context); sentry.captureException(err); });
    else sentry.captureException(err);
  } catch {}
};

export const isTelemetryConfigured = () => !!(SENTRY_DSN || POSTHOG_KEY);
