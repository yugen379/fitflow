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
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDocFromServer, updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { getMessaging, getToken, onMessage, Messaging } from 'firebase/messaging';
import firebaseConfig from '../../firebase-applet-config.json';
import { isSupported } from 'firebase/messaging';
import { Capacitor } from '@capacitor/core';
import { initAppCheck } from './appCheck';
import { setGeminiAuthTokenSupplier } from '../services/geminiService';

const app = initializeApp(firebaseConfig);
// App Check ("Google protect") — must init right after the app, before other
// services. Inert until a reCAPTCHA site key is configured (see lib/appCheck.ts).
initAppCheck(app);
export const auth = getAuth(app);
// Persistent (IndexedDB) cache: profile/meals/workouts render instantly from
// disk on reopen and sync in the background — the app stays usable offline and
// cold starts stop waiting on the network. Multi-tab manager keeps the PWA
// safe when open in more than one tab; falls back gracefully where unsupported.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
}, firebaseConfig.firestoreDatabaseId);
export const googleProvider = new GoogleAuthProvider();

// The Gemini proxy rejects anonymous calls; hand it a fresh ID token per
// request. getIdToken() serves a cached token and only refreshes near expiry.
setGeminiAuthTokenSupplier(async () => auth.currentUser ? auth.currentUser.getIdToken() : null);

// Persist auth across reloads (required for redirect flow on mobile)
setPersistence(auth, browserLocalPersistence).catch(e =>
  console.warn('Auth persistence setup failed:', e)
);

let messaging: Messaging | null = null;
isSupported().then(supported => {
  if (supported) {
    messaging = getMessaging(app);
  }
});

export const requestNotificationPermission = async (userId: string) => {
  try {
    if (!messaging) return;
    
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      const token = await getToken(messaging, {
        vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY
      });
      
      if (token) {
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

export const onMessageListener = (callback: (payload: any) => void) => {
  if (!messaging) return null;
  return onMessage(messaging!, (payload) => {
    callback(payload);
  });
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

// Logs Firestore failures for diagnostics but never throws to the caller — the calling
// code (logMeal / logWorkout / createPost) handles the failure by routing to the offline
// queue, so the customer never sees a raw error toast for save operations.
export const handleFirestoreError = (error: any, operationType: FirestoreErrorInfo['operationType'], path: string | null = null) => {
  const user = auth.currentUser;
  if (error?.code === 'permission-denied') {
    console.warn(`Firestore ${operationType} permission-denied on ${path}`, {
      userId: user?.uid,
      email: user?.email,
    });
  } else {
    console.warn(`Firestore ${operationType} failed on ${path}:`, error?.code || error?.message || error);
  }
  return null;
};

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error: any) {
    if (error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}

testConnection();
