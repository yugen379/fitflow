import { Capacitor } from '@capacitor/core';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, requestNotificationPermission } from './firebase';

export type PushPermResult = 'granted' | 'denied';

/** True when running inside the packaged Android/iOS app (Capacitor WebView). */
export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

/**
 * The Android WebView has no Web Speech API, so the mic can't power the AI
 * Coach voice input there — only prompt for it where it actually works (web).
 */
export const micSupported = (): boolean =>
  !isNativeApp() && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

const saveToken = async (uid: string, token: string) => {
  try {
    await updateDoc(doc(db, 'users', uid), {
      fcmToken: token,
      notificationsEnabled: true,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Profile doc may not be writable yet (mid-onboarding) — the next
    // Settings/Home prompt re-saves it; the permission itself is granted.
  }
};

/**
 * Cross-platform "enable notifications".
 * - Native: OS runtime prompt (Android 13+) via @capacitor/push-notifications,
 *   then registers for FCM and saves the DEVICE token to users/{uid}.fcmToken —
 *   the same field every Cloud Function push (reminders, weekly recap,
 *   engagement nudges, trial alerts) already sends to, so they all work on
 *   Android with no server changes.
 * - Web: Notification API + FCM web token via the existing firebase.ts path.
 */
export const requestPushPermission = async (uid?: string): Promise<PushPermResult> => {
  if (!isNativeApp()) {
    if (typeof Notification === 'undefined') return 'denied';
    try {
      const r = await Notification.requestPermission();
      if (r !== 'granted') return 'denied';
      if (uid) { try { await requestNotificationPermission(uid); } catch { /* token save is best-effort */ } }
      return 'granted';
    } catch {
      return 'denied';
    }
  }

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive !== 'granted') perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') return 'denied';

    let regHandle: { remove(): Promise<void> } | undefined;
    let errHandle: { remove(): Promise<void> } | undefined;
    const token = await new Promise<string | null>(resolve => {
      const timer = setTimeout(() => resolve(null), 10000);
      PushNotifications.addListener('registration', t => { clearTimeout(timer); resolve(t.value); })
        .then(h => { regHandle = h; });
      PushNotifications.addListener('registrationError', () => { clearTimeout(timer); resolve(null); })
        .then(h => { errHandle = h; });
      PushNotifications.register();
    });
    regHandle?.remove().catch(() => {});
    errHandle?.remove().catch(() => {});

    if (token && uid) await saveToken(uid, token);
    return 'granted';
  } catch {
    return 'denied';
  }
};
