// Firebase App Check — "Google protect" for the backend.
//
// App Check attests that traffic hitting Firestore, Cloud Functions, and the
// Gemini proxy comes from YOUR genuine app — not a scraper, bot, or someone
// replaying your public API keys.
//
// Two providers, picked by platform:
//   • Web / PWA  → reCAPTCHA v3 (env-gated by VITE_RECAPTCHA_V3_SITE_KEY).
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
import { initializeAppCheck, ReCaptchaV3Provider, CustomProvider } from 'firebase/app-check';
import { Capacitor } from '@capacitor/core';

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

    // --- Web / PWA: reCAPTCHA v3 ---
    const siteKey = (import.meta as any).env?.VITE_RECAPTCHA_V3_SITE_KEY;
    if (!siteKey) return; // not configured → ship inert, enable later

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
