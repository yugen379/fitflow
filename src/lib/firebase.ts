/// <reference types="vite/client" />
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signInWithCredential,
  getRedirectResult,
  browserLocalPersistence,
  setPersistence,
} from 'firebase/auth';
import type { Messaging } from 'firebase/messaging';
import firebaseConfig from '../../firebase-applet-config.json';
import { Capacitor } from '@capacitor/core';
import { initAppCheck } from './appCheck';
import { setAuthTokenSupplier } from './authToken';

// firebase/messaging is ~25 kB and is only ever needed once the user is signed
// in and has agreed to notifications. Importing it at module scope also ran
// isSupported() during boot, which does real work on the main thread before
// anything has painted.
type MessagingModule = typeof import('firebase/messaging');
let messagingModule: Promise<MessagingModule> | null = null;
const loadMessaging = (): Promise<MessagingModule> => {
  if (!messagingModule) messagingModule = import('firebase/messaging');
  return messagingModule;
};

export const app = initializeApp(firebaseConfig);
export { firebaseConfig };
// App Check ("Google protect") — must init right after the app, before other
// services. Inert until a reCAPTCHA site key is configured (see lib/appCheck.ts).
initAppCheck(app);
export const auth = getAuth(app);

/**
 * Local emulator wiring for the UI proof harness (npm run proof:ui).
 *
 * The condition is written INLINE against import.meta.env on purpose. Vite
 * replaces that expression with a literal at build time, so a normal build
 * folds it to `false`, eliminates the branch, and never emits ./devEmulators.
 * Routing it through a helper function instead defeats dead-code elimination
 * and ships the test hook — which is exactly what the first version did.
 *
 * This is not an auth bypass: real Firebase auth still runs, against a
 * throwaway local emulator. It exists because all 22 routes sit behind
 * ProtectedRoute, so nothing could test a signed-in page.
 */
if (import.meta.env.VITE_USE_EMULATORS === 'true') {
  void import('./devEmulators').then((m) => m.connectEmulators(auth));
}
// `db` now lives in ./firestore so that importing auth does not drag ~80 kB of
// Firestore onto the boot path. This module must never import it statically.
export const googleProvider = new GoogleAuthProvider();

// The Gemini proxy rejects anonymous calls; hand it a fresh ID token per
// request. getIdToken() serves a cached token and only refreshes near expiry.
// Written into a 20-line registry rather than handed straight to
// geminiService, which statically imports @google/genai — that one edge dragged
// the whole Gemini SDK onto the boot path.
setAuthTokenSupplier(async () => (auth.currentUser ? auth.currentUser.getIdToken() : null));

// Persist auth across reloads (required for redirect flow on mobile)
setPersistence(auth, browserLocalPersistence).catch(e =>
  console.warn('Auth persistence setup failed:', e)
);

let messaging: Messaging | null = null;
let messagingReady: Promise<Messaging | null> | null = null;

/**
 * Resolve the Messaging instance, loading the SDK on first use. Returns null
 * where push is unsupported, which every caller already handles.
 */
const getMessagingInstance = async (): Promise<Messaging | null> => {
  if (messaging) return messaging;
  if (!messagingReady) {
    messagingReady = (async () => {
      try {
        const mod = await loadMessaging();
        if (!(await mod.isSupported())) return null;
        messaging = mod.getMessaging(app);
        return messaging;
      } catch (e) {
        console.warn('Messaging unavailable:', e);
        return null;
      }
    })();
  }
  return messagingReady;
};

export const requestNotificationPermission = async (userId: string) => {
  try {
    const instance = await getMessagingInstance();
    if (!instance) return;

    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      const { getToken } = await loadMessaging();
      const token = await getToken(instance, {
        vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY
      });

      if (token) {
        // Loaded on demand: this only ever runs for a signed-in user who has
        // just granted notification permission.
        const [{ db }, { doc, updateDoc, serverTimestamp }] = await Promise.all([
          import('./firestore'),
          import('firebase/firestore'),
        ]);
        await updateDoc(doc(db, 'users', userId), {
          fcmToken: token,
          notificationsEnabled: true,
          updatedAt: serverTimestamp()
        });
        return token;
      }
    }
  } catch (error) {
    console.error('Error requesting notification permission:', error);
  }
  return null;
};

/**
 * Foreground push listener.
 *
 * Kept synchronous so callers can treat it like any other subscribe: the SDK is
 * fetched in the background and the real listener attaches when it lands. The
 * returned function unsubscribes, and also cancels a still-in-flight attach so
 * an unmounted component never gets a late callback.
 */
export const onMessageListener = (callback: (payload: any) => void) => {
  let cancelled = false;
  let detach: (() => void) | null = null;

  void (async () => {
    const instance = await getMessagingInstance();
    if (cancelled || !instance) return;
    const { onMessage } = await loadMessaging();
    if (cancelled) return;
    detach = onMessage(instance, (payload) => callback(payload));
  })();

  return () => {
    cancelled = true;
    if (detach) detach();
  };
};

const isMobile = () =>
  typeof navigator !== 'undefined' &&
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

const isStandalonePWA = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches ||
   (window.navigator as any).standalone === true);

export const friendlyAuthError = (code?: string): string => {
  switch (code) {
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized. Add it in Firebase Console → Authentication → Settings → Authorized domains.';
    case 'auth/popup-blocked':
      return 'Popup blocked. Allow popups for this site, or reload to use redirect sign-in.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in cancelled.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email but a different sign-in method.';
    case 'auth/operation-not-allowed':
      return 'Google sign-in is disabled. Enable it in Firebase Console → Authentication → Sign-in method.';
    case 'auth/web-storage-unsupported':
      return 'Browser storage is disabled. Enable cookies/localStorage and try again.';
    default:
      return code ? `Sign-in failed (${code}).` : 'Sign-in failed. Please try again.';
  }
};

export const signInWithGoogle = async () => {
  try {
    if (isMobile() || isStandalonePWA()) {
      // Redirect flow: completes via completeRedirectSignIn() after the page reloads
      await signInWithRedirect(auth, googleProvider);
      return null;
    }
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error: any) {
    // Popup blocked on desktop → fall back to redirect rather than dead-ending the user
    if (error?.code === 'auth/popup-blocked' || error?.code === 'auth/popup-closed-by-user') {
      try {
        await signInWithRedirect(auth, googleProvider);
        return null;
      } catch (redirectErr) {
        console.error('Redirect fallback failed:', redirectErr);
        throw redirectErr;
      }
    }
    console.error('Google sign-in failed:', error?.code, error?.message);
    throw error;
  }
};

// True only inside the Capacitor Android/iOS shell (the installed APK), not the PWA/browser.
export const isNativeApp = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

// Native (APK) Google sign-in. Google blocks OAuth inside embedded WebViews
// (Error 403: disallowed_useragent), so the GIS/popup web flow cannot work in the
// app shell. This uses the native account picker via @capacitor-firebase/authentication
// with skipNativeAuth=true (configured in capacitor.config.ts), then exchanges the
// returned Google ID token for a JS-SDK session — keeping the web SDK `auth` object
// as the single source of auth truth for the rest of the app (onAuthStateChanged, etc).
export const signInWithGoogleNative = async () => {
  const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
  const result = await FirebaseAuthentication.signInWithGoogle();
  const idToken = result.credential?.idToken;
  if (!idToken) {
    throw Object.assign(new Error('Native Google sign-in returned no ID token'), {
      code: 'auth/native-no-id-token',
    });
  }
  const credential = GoogleAuthProvider.credential(idToken);
  const res = await signInWithCredential(auth, credential);
  return res.user;
};

// Exchange a Google Identity Services ID token for a Firebase auth session.
// This is the mobile-friendly path: no redirect roundtrip, no cross-origin storage handoff.
export const signInWithGoogleCredential = async (idToken: string) => {
  try {
    const credential = GoogleAuthProvider.credential(idToken);
    const result = await signInWithCredential(auth, credential);
    return result.user;
  } catch (error: any) {
    console.error('Google credential sign-in failed:', error?.code, error?.message);
    throw error;
  }
};

// OAuth Web Client ID for Google Identity Services. This is the same client
// Firebase Auth uses; safe to embed (it's a public identifier, not a secret).
export const GOOGLE_OAUTH_CLIENT_ID =
  '715686253437-i5ofh0bsif3eqopn5l8k0ujkd4qbkib0.apps.googleusercontent.com';

// Call once on app mount to finish the redirect-based sign-in
export const completeRedirectSignIn = async () => {
  try {
    const result = await getRedirectResult(auth);
    return result?.user ?? null;
  } catch (error: any) {
    console.error('Redirect sign-in callback failed:', error?.code, error?.message);
    throw error;
  }
};

export interface FirestoreErrorInfo {
  error: string;
  operationType: 'create' | 'update' | 'delete' | 'list' | 'get' | 'write';
  path: string | null;
  authInfo: {
    userId: string;
    email: string;
    emailVerified: boolean;
    isAnonymous: boolean;
    providerInfo: { providerId: string; displayName: string; email: string; }[];
  }
}

/**
 * Every Firestore failure in the app funnels through here.
 *
 * It still never throws — the callers (logMeal / logWorkout / createPost)
 * recover by routing to the offline queue, and the customer must not see a raw
 * error toast for a save that will be retried. What changed is that it no
 * longer stops at `console.warn`.
 *
 * A console warning in a shipped PWA reaches nobody. Sentry was installed,
 * initialised and never called from this function, so the single busiest error
 * path in the product was invisible in production — which is exactly how
 * fourteen of fifteen required composite indexes stayed missing for months
 * while the affected screens quietly rendered nothing.
 *
 * `failed-precondition` is escalated deliberately: from Firestore it almost
 * always means "this query has no index", it is invisible by construction
 * (every caller swallows it), and it does not self-heal. It is the one error
 * class here that is a standing outage rather than a transient.
 *
 * The user's EMAIL used to be attached to permission-denied reports. That is
 * PII in a diagnostic channel, and it bought nothing: `identify()` already
 * associates the Sentry user, and uid is the only key anything is queried by.
 */
export const handleFirestoreError = (error: any, operationType: FirestoreErrorInfo['operationType'], path: string | null = null) => {
  const code: string = error?.code || 'unknown';
  const user = auth.currentUser;

  // Collection name only — a full document path can carry a uid or a food name.
  const collection = (path || 'unknown').split('/')[0];
  const missingIndex = code === 'failed-precondition';

  console.warn(`Firestore ${operationType} ${code} on ${path}`, { userId: user?.uid });

  if (missingIndex) {
    // The Firestore SDK puts the console link to create the index in the
    // message. Keep it — in dev it is the whole fix.
    console.error(
      `[firestore] MISSING INDEX: ${operationType} on ${collection} — this query ` +
      `returns nothing until an index exists. Add it to firestore.indexes.json ` +
      `(not just the console) so a deploy reproduces it:\n${error?.message || ''}`,
    );
  }

  void import('./telemetry')
    .then(({ captureError }) =>
      captureError(error, {
        operationType,
        path,
        code,
        userId: user?.uid ?? null,
        emailVerified: user?.emailVerified ?? null,
      }, {
        // Grouped by shape, not by document — one issue per broken query, not
        // one per user who hit it.
        signature: `firestore:${code}:${operationType}:${collection}`,
        level: missingIndex || code === 'permission-denied' ? 'error' : 'warning',
        tags: { firestoreCode: code, operation: operationType, collection },
      }),
    )
    .catch(() => { /* telemetry must never break a data path */ });

  return null;
};

// A boot-time `getDocFromServer(doc(db, 'test', 'connection'))` used to run
// here. It fired a Firestore round trip on every single cold start purely to
// log a hint on failure, and it was one of the two reasons Firestore could not
// leave the boot path. Removed: it provided no behaviour, and the real data
// paths already report connectivity problems through handleFirestoreError.
