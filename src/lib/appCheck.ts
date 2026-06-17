// Firebase App Check — "Google protect" for the backend.
//
// App Check attests that traffic hitting Firestore, Cloud Functions, and the
// Gemini proxy comes from YOUR genuine app (via Google reCAPTCHA v3 on web), not a
// scraper, bot, or someone replaying your API keys. It's the same abuse shield the
// big fitness apps run — it stops freeloaders draining your Gemini quota and
// poisoning the shared food_catalog at scale.
//
// SAFETY-FIRST ROLLOUT (why this is env-gated and defaults to OFF):
//   1. Ship this code (no behavior change until a site key is present).
//   2. Register a reCAPTCHA v3 site key in Firebase Console → App Check, set
//      VITE_RECAPTCHA_V3_SITE_KEY, redeploy. Clients now SEND attestation tokens.
//   3. Watch the App Check "requests" dashboard until verified traffic is ~100%.
//   4. ONLY THEN flip enforcement on per-service in the console.
// Enforcing before step 3 would lock out real users — hence the staged gate.
//
// Native (Capacitor/Android): the JS reCAPTCHA provider can't attest inside a
// WebView, so we skip App Check on native here. Add the Play Integrity provider via
// a native plugin before enforcing App Check on Functions/Firestore for the APK.

import type { FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { Capacitor } from '@capacitor/core';

let initialized = false;

/**
 * Initialize App Check as early as possible (right after initializeApp, before
 * Firestore/Auth are used). No-ops safely when no site key is configured or on
 * native, and never throws — protection must never become a point of failure.
 */
export const initAppCheck = (app: FirebaseApp): void => {
  if (initialized) return;
  try {
    if (Capacitor?.isNativePlatform?.()) return; // see header note (native uses Play Integrity)
    const siteKey = (import.meta as any).env?.VITE_RECAPTCHA_V3_SITE_KEY;
    if (!siteKey) return; // not configured yet → ship inert, enable later

    // Debug token lets a dev/CI machine pass App Check without a real reCAPTCHA
    // (register the printed token in Console → App Check → Manage debug tokens).
    const debugToken = (import.meta as any).env?.VITE_APPCHECK_DEBUG_TOKEN;
    if (debugToken && typeof self !== 'undefined') {
      (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
    }

    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
    initialized = true;
  } catch (e) {
    console.warn('App Check init skipped (continuing without):', e);
  }
};
