/**
 * Cheap, synchronous "is there a signed-in user?" signal.
 *
 * Firebase Auth's browserLocalPersistence writes a `firebase:authUser:*` key to
 * localStorage. Reading it takes microseconds and — crucially — is available
 * from the very first frame, long before the auth SDK has loaded, let alone
 * resolved `onAuthStateChanged`.
 *
 * That makes it the right signal for deciding what to warm at boot: a signed-in
 * user is going to need Firestore, a signed-out user is going to need the Google
 * sign-in widget, and neither should pay for the other's download.
 *
 * It is a heuristic, never an authorisation decision. A wrong answer costs one
 * speculative fetch (or the lack of one); nothing reads it to decide what a user
 * is allowed to see.
 */

const AUTH_KEY_PREFIX = 'firebase:authUser:';

export const hasPersistedAuthSession = (): boolean => {
  try {
    if (typeof localStorage === 'undefined') return false;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(AUTH_KEY_PREFIX)) return true;
    }
    return false;
  } catch {
    // Storage blocked (private mode, embedded webview) — assume signed out.
    return false;
  }
};
