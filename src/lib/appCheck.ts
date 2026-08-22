// Firebase App Check — "Google protect" for the backend.
//
// App Check attests that traffic hitting Firestore, Cloud Functions, and the
// Gemini proxy comes from YOUR genuine app — not a scraper, bot, or someone
// replaying your public API keys.
//
// Two providers, picked by platform:
//   • Web / PWA  → reCAPTCHA ENTERPRISE (env-gated by VITE_RECAPTCHA_V3_SITE_KEY,
//     a name kept for compatibility with existing builds and CI secrets even
//     though the key it holds is an Enterprise key).
//   • Android/iOS app → Play Integrity / App Attest via @capacitor-firebase/app-check.
//
// CRITICAL ARCHITECTURE NOTE: this app does its data I/O with the Firebase JS SDK
// running INSIDE the Capacitor WebView (see firebase.ts), not the native SDK. So on
// native we still call initializeAppCheck() on the JS app, but with a CustomProvider
// that fetches the token from the NATIVE plugin (Play Integrity). That way the
// WebView's Firestore/Functions requests carry a real device-attested token. Using
// only the native provider would leave those JS-SDK requests unattested.
//
// SAFETY: never throws, and on web is inert until a site key is set. Enable
// enforcement per service in the console only after verified traffic is high — see
// APPCHECK.md. Android needs the Play Integrity API enabled + the app's SHA-256 +
// the Play Integrity provider registered in App Check before enforcement helps.

import type { FirebaseApp } from 'firebase/app';
import { Capacitor } from '@capacitor/core';

// firebase/app-check is ~57 kB and, on web, does nothing at all until a
// reCAPTCHA site key is configured. Importing it statically put that cost on
// every cold start, attested or not; it is now fetched only on the paths that
// genuinely use it.
type AppCheckModule = typeof import('firebase/app-check');
let appCheckModule: Promise<AppCheckModule> | null = null;
const loadAppCheck = (): Promise<AppCheckModule> => {
  if (!appCheckModule) appCheckModule = import('firebase/app-check');
  return appCheckModule;
};

let initialized = false;

const HOUR_MS = 60 * 60 * 1000;

export const initAppCheck = async (app: FirebaseApp): Promise<void> => {
  if (initialized) return;
  try {
    // --- Native (APK): Play Integrity on Android, App Attest/DeviceCheck on iOS ---
    if (Capacitor?.isNativePlatform?.()) {
      const { FirebaseAppCheck } = await import('@capacitor-firebase/app-check');
      const debugToken = (import.meta as any).env?.VITE_APPCHECK_DEBUG_TOKEN;
      // Initialize the NATIVE App Check provider (Play Integrity by default on
      // Android). debugToken is for emulators / unsigned dev builds only.
      await FirebaseAppCheck.initialize({
        isTokenAutoRefreshEnabled: true,
        ...(debugToken ? { debugToken } : {}),
      });
      // Bridge the native token into the JS SDK so WebView Firestore/Functions
      // requests are attested with the same Play-Integrity-backed token.
      const { initializeAppCheck, CustomProvider } = await loadAppCheck();
      initializeAppCheck(app, {
        isTokenAutoRefreshEnabled: true,
        provider: new CustomProvider({
          getToken: async () => {
            const { token, expireTimeMillis } = await FirebaseAppCheck.getToken();
            return { token, expireTimeMillis: expireTimeMillis ?? Date.now() + HOUR_MS };
          },
        }),
      });
      initialized = true;
      return;
    }

    // --- Web / PWA: reCAPTCHA Enterprise ---
    const siteKey = (import.meta as any).env?.VITE_RECAPTCHA_V3_SITE_KEY;
    if (!siteKey) return; // not configured → ship inert, enable later

    const debugToken = (import.meta as any).env?.VITE_APPCHECK_DEBUG_TOKEN;
    if (debugToken && typeof self !== 'undefined') {
      (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
    }
    // Loaded only now, after the site-key check — an unconfigured web build
    // never downloads the SDK at all.
    // ENTERPRISE, not V3.
    //
    // `6LdjDSQtAAAAA...` ("FitFlow App Check") is a reCAPTCHA ENTERPRISE key —
    // confirmed with `gcloud recaptcha keys list`, and the project carries a
    // recaptchaEnterpriseConfig for this app. The two providers hit different
    // exchange endpoints:
    //
    //   ReCaptchaV3Provider         -> :exchangeRecaptchaV3Token
    //   ReCaptchaEnterpriseProvider -> :exchangeRecaptchaEnterpriseToken
    //
    // Using the V3 provider with an Enterprise key sent an Enterprise token to
    // the V3 endpoint, which cannot verify it — so every attestation failed with
    // 403 "App attestation failed" on every page load. It went unnoticed because
    // App Check enforcement is off, so nothing broke; it only meant App Check
    // has never actually protected anything.
    const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await loadAppCheck();
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
    initialized = true;
  } catch (e) {
    console.warn('App Check init skipped (continuing without):', e);
  }
};
